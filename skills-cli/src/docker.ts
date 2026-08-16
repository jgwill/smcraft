/**
 * docker.ts — `stateloom docker up` and the rest of the container front door.
 *
 * The problem this solves is not "how do I run a container". It is that a loom
 * is four processes that must agree on a document, a hub, a port and a token,
 * and every one of those agreements has a silent failure mode. An agent asked
 * to "start stateloom for my human" should not have to learn any of them.
 *
 *     npx -y @miadi/stateloom-skills docker up --port 5599
 *
 * That writes a compose project, starts it, waits until the gateway says every
 * upstream is reachable, and prints the two things the caller actually needs:
 * the URL for the human, and the MCP registration for itself.
 *
 * The compose file is NOT generated here. It is the same `docker-compose.yml`
 * that lives at the root of the smcraft repository, mirrored into this package
 * at build time — one canonical file, so the thing an agent runs and the thing
 * a contributor reads cannot drift apart.
 *
 * No runtime dependencies, like the rest of this package: it is run through
 * `npx` by someone who has installed nothing.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DOCKER_USAGE = `stateloom docker — run the whole loom in containers

Usage
  stateloom docker up [options]        start the loom, wait for health, print the URL
  stateloom docker down [options]      stop it
  stateloom docker status [options]    what is running, and is it healthy
  stateloom docker logs [service]      follow the logs (hub | mcp | canvas | gateway)
  stateloom docker print [options]     write the compose project, start nothing
  stateloom docker mcp-config          print the MCP registration for a running loom

Options
  --port <n>        host port for the human's browser (default: the first free
                    port from 4598 up; an explicit port that is busy is an error)
  --dir <path>      directory holding the .smdf.json documents (default: ./looms)
  --doc <name>      document to open first (default: statemachine.smdf.json)
  --bind <addr>     interface to publish on (default: 127.0.0.1)
  --image <ref>     image to run (default: jgwill/stateloom:latest)
  --token <t>       MCP bearer token (default: generated once and kept in the env file)
  --project <name>  compose project name (default: stateloom)
  --workspace <p>   where the compose project is written (default: ./.stateloom)
  --pull            pull the image before starting
  --json            machine-readable result (up, status, mcp-config)
  --no-wait         do not wait for the loom to become healthy

Examples
  stateloom docker up
  stateloom docker up --port 5599 --dir ~/machines --doc orders.smdf.json
  stateloom docker up --json
  stateloom docker down
`;

export interface DockerFlags {
  port?: number;
  portExplicit: boolean;
  dir: string;
  doc: string;
  bind: string;
  image: string;
  token?: string;
  project: string;
  workspace: string;
  pull: boolean;
  json: boolean;
  wait: boolean;
  positional: string[];
}

const DEFAULT_PORT = 4598;

/** The mirrored copy of the repository's docker assets, inside this package. */
export function dockerAssetsRoot(): string {
  const override = process.env.STATELOOM_DOCKER_SOURCE;
  if (override) return resolve(override);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "docker");
}

export function parseDockerFlags(argv: string[]): DockerFlags {
  const f: DockerFlags = {
    portExplicit: false,
    dir: "./looms",
    doc: "statemachine.smdf.json",
    bind: "127.0.0.1",
    image: "jgwill/stateloom:latest",
    project: "stateloom",
    workspace: "./.stateloom",
    pull: false,
    json: false,
    wait: true,
    positional: [],
  };
  const need = (i: number, name: string): string => {
    const v = argv[i];
    if (!v) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--port":
        f.port = Number(need(++i, "--port"));
        f.portExplicit = true;
        if (!Number.isInteger(f.port) || f.port < 1 || f.port > 65535) {
          throw new Error(`--port is not a port number: ${argv[i]}`);
        }
        break;
      case "--dir":
      case "-d":
        f.dir = need(++i, "--dir");
        break;
      case "--doc":
        f.doc = need(++i, "--doc");
        break;
      case "--bind":
        f.bind = need(++i, "--bind");
        break;
      case "--image":
        f.image = need(++i, "--image");
        break;
      case "--token":
        f.token = need(++i, "--token");
        break;
      case "--project":
      case "-p":
        f.project = need(++i, "--project");
        break;
      case "--workspace":
        f.workspace = need(++i, "--workspace");
        break;
      case "--pull":
        f.pull = true;
        break;
      case "--json":
        f.json = true;
        break;
      case "--no-wait":
        f.wait = false;
        break;
      case "--help":
      case "-h":
        f.positional.push("--help");
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
        f.positional.push(arg);
    }
  }
  return f;
}

/** `docker compose` (plugin) or `docker-compose` (standalone), whichever exists. */
function composeCommand(): { cmd: string; pre: string[] } {
  const plugin = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
  if (plugin.status === 0) return { cmd: "docker", pre: ["compose"] };
  const standalone = spawnSync("docker-compose", ["version"], { stdio: "ignore" });
  if (standalone.status === 0) return { cmd: "docker-compose", pre: [] };
  throw new Error(
    "docker compose is not available.\n" +
      "  Install Docker Desktop, or the compose plugin:  https://docs.docker.com/compose/install/",
  );
}

function requireDocker(): void {
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (r.error) throw new Error("docker is not installed, or not on PATH.");
  if (r.status !== 0) {
    throw new Error("the docker daemon is not responding — is Docker running?");
  }
}

/** Can this port be bound on this interface right now? */
function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.once("listening", () => server.close(() => done(true)));
    server.listen(port, host === "0.0.0.0" ? "0.0.0.0" : host);
  });
}

/**
 * The port the human will open. Asked for explicitly, it must be free — quietly
 * moving somebody's chosen port produces a URL they did not ask for. Not asked
 * for, we walk up from 4598, which is the convention and nothing more.
 */
async function choosePort(f: DockerFlags): Promise<number> {
  if (f.portExplicit) {
    const port = f.port!;
    if (await portFree(port, f.bind)) return port;
    throw new Error(
      `port ${port} is already in use on ${f.bind}.\n` +
        `  Pick another with --port, or omit --port to take the first free one from ${DEFAULT_PORT}.`,
    );
  }
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 100; port++) {
    if (await portFree(port, f.bind)) return port;
  }
  throw new Error(`no free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + 99} on ${f.bind}.`);
}

interface Project {
  workspace: string;
  composeFile: string;
  envFile: string;
  docDir: string;
  port: number;
  token: string;
}

/** Read `KEY=value` pairs out of an existing env file, so `up` is re-runnable. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at === -1) continue;
    out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return out;
}

/**
 * Write (or refresh) the compose project on disk.
 *
 * The token is generated once and then re-read from the env file on every later
 * `up`. That is the difference between a loom an MCP client can stay registered
 * against and one whose registration breaks every time somebody restarts it.
 */
async function materialize(f: DockerFlags, opts: { port?: number } = {}): Promise<Project> {
  const workspace = resolve(f.workspace);
  const composeFile = join(workspace, "docker-compose.yml");
  const envFile = join(workspace, ".env");
  const docDir = resolve(f.dir);

  const assets = dockerAssetsRoot();
  const source = join(assets, "docker-compose.yml");
  if (!existsSync(source)) {
    throw new Error(
      `the bundled compose file is missing (${source}).\n` +
        `  Only a broken install can produce this. Reinstall @miadi/stateloom-skills.`,
    );
  }

  mkdirSync(workspace, { recursive: true });
  // The mount source must exist before compose starts, or the daemon creates it
  // as root and every document written afterwards belongs to root.
  mkdirSync(docDir, { recursive: true });
  copyFileSync(source, composeFile);

  const existing = readEnvFile(envFile);
  const port = opts.port ?? Number(existing.STATELOOM_PORT ?? DEFAULT_PORT);
  const token = f.token ?? existing.STATELOOM_MCP_TOKEN ?? randomBytes(24).toString("hex");

  const env = [
    "# Written by `stateloom docker`. Edit freely — it is read on every up.",
    `STATELOOM_PORT=${port}`,
    `STATELOOM_BIND=${f.bind}`,
    `STATELOOM_DOC_DIR=${docDir}`,
    `STATELOOM_DOC=${f.doc}`,
    `STATELOOM_UID=${typeof process.getuid === "function" ? process.getuid() : 1000}`,
    `STATELOOM_GID=${typeof process.getgid === "function" ? process.getgid() : 1000}`,
    `STATELOOM_MCP_TOKEN=${token}`,
    `STATELOOM_IMAGE=${f.image}`,
    "",
  ].join("\n");
  writeFileSync(envFile, env);

  return { workspace, composeFile, envFile, docDir, port, token };
}

function compose(project: Project, name: string, args: string[], inherit = true): number {
  const { cmd, pre } = composeCommand();
  const full = [
    ...pre,
    "-p",
    name,
    "--env-file",
    project.envFile,
    "-f",
    project.composeFile,
    ...args,
  ];
  const r = spawnSync(cmd, full, { stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
  return r.status ?? 1;
}

/** Poll the gateway until it reports every upstream reachable. */
async function waitHealthy(port: number, bind: string, seconds = 120): Promise<boolean> {
  const host = bind === "0.0.0.0" ? "127.0.0.1" : bind;
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://${host}:${port}/healthz`, {
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const body = (await r.json()) as { ok?: boolean };
        if (body.ok) return true;
      }
    } catch {
      // Not up yet. The whole point of this loop.
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function mcpRegistration(url: string, token: string): unknown {
  return {
    mcpServers: {
      stateloom: {
        type: "http",
        url: `${url}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
}

async function cmdUp(f: DockerFlags): Promise<number> {
  requireDocker();
  const port = await choosePort(f);
  const project = await materialize(f, { port });
  const host = f.bind === "0.0.0.0" ? "127.0.0.1" : f.bind;
  const url = `http://${host}:${port}`;

  if (f.pull) compose(project, f.project, ["pull", "--quiet"]);

  const code = compose(project, f.project, ["up", "-d", "--remove-orphans"]);
  if (code !== 0) {
    console.error(`\ndocker compose up failed (exit ${code}).`);
    console.error(`  Project: ${project.composeFile}`);
    console.error(`  Logs:    stateloom docker logs`);
    return code;
  }

  let healthy = true;
  if (f.wait) {
    process.stderr.write("waiting for the loom");
    const ticker = setInterval(() => process.stderr.write("."), 1500);
    healthy = await waitHealthy(port, f.bind);
    clearInterval(ticker);
    process.stderr.write("\n");
  }

  const result = {
    ok: healthy,
    url,
    canvas: url,
    mcp: `${url}/mcp`,
    token: project.token,
    document: join(project.docDir, f.doc),
    documentsDir: project.docDir,
    project: f.project,
    composeFile: project.composeFile,
    envFile: project.envFile,
    mcpConfig: mcpRegistration(url, project.token),
  };

  if (f.json) {
    console.log(JSON.stringify(result, null, 2));
    return healthy ? 0 : 1;
  }

  if (!healthy) {
    console.error(
      `\nThe containers started but the loom never reported healthy.\n` +
        `  stateloom docker status\n` +
        `  stateloom docker logs\n`,
    );
    return 1;
  }

  console.log(`
🧵 stateloom is live

   For your human   ${url}
   For you (MCP)    ${url}/mcp
   Bearer token     ${project.token}
   Documents        ${project.docDir}
   Open first       ${f.doc}

Register the MCP server (Claude Code):

  claude mcp add --transport http stateloom ${url}/mcp \\
    --header "Authorization: Bearer ${project.token}"

Or as JSON:

${JSON.stringify(mcpRegistration(url, project.token), null, 2)}

  stateloom docker status     is it healthy
  stateloom docker logs       follow all four services
  stateloom docker down       stop it
`);
  return 0;
}

async function cmdDown(f: DockerFlags): Promise<number> {
  requireDocker();
  const project = await materialize(f);
  return compose(project, f.project, ["down", "--remove-orphans"]);
}

async function cmdStatus(f: DockerFlags): Promise<number> {
  requireDocker();
  const project = await materialize(f);
  const host = f.bind === "0.0.0.0" ? "127.0.0.1" : f.bind;
  const url = `http://${host}:${project.port}`;

  let health: unknown = null;
  try {
    const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(4000) });
    health = await r.json();
  } catch {
    health = { ok: false, reason: "the gateway is not answering" };
  }

  if (f.json) {
    console.log(JSON.stringify({ url, mcp: `${url}/mcp`, health }, null, 2));
  } else {
    compose(project, f.project, ["ps"]);
    console.log(`\n${url}  →  ${JSON.stringify(health)}`);
  }
  return (health as { ok?: boolean }).ok ? 0 : 1;
}

async function cmdLogs(f: DockerFlags): Promise<number> {
  requireDocker();
  const project = await materialize(f);
  const service = f.positional[0];
  const { cmd, pre } = composeCommand();
  const args = [
    ...pre,
    "-p",
    f.project,
    "--env-file",
    project.envFile,
    "-f",
    project.composeFile,
    "logs",
    "-f",
    "--tail",
    "100",
    ...(service ? [service] : []),
  ];
  // Streaming, so this one is spawned rather than spawnSync'd: Ctrl-C must
  // reach docker and not be swallowed by a synchronous child.
  return await new Promise<number>((done) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => done(code ?? 0));
  });
}

async function cmdPrint(f: DockerFlags): Promise<number> {
  const port = f.portExplicit ? f.port! : DEFAULT_PORT;
  const project = await materialize(f, { port });
  if (f.json) {
    console.log(JSON.stringify(project, null, 2));
    return 0;
  }
  console.log(`compose project written — nothing started

  compose file  ${project.composeFile}
  env file      ${project.envFile}
  documents     ${project.docDir}
  port          ${project.port}
  mcp token     ${project.token}

  cd ${project.workspace} && docker compose up -d
`);
  return 0;
}

async function cmdMcpConfig(f: DockerFlags): Promise<number> {
  const project = await materialize(f);
  const host = f.bind === "0.0.0.0" ? "127.0.0.1" : f.bind;
  const url = `http://${host}:${project.port}`;
  console.log(JSON.stringify(mcpRegistration(url, project.token), null, 2));
  return 0;
}

export async function runDocker(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(DOCKER_USAGE);
    return sub ? 0 : 1;
  }

  const flags = parseDockerFlags(rest);
  if (flags.positional.includes("--help")) {
    console.log(DOCKER_USAGE);
    return 0;
  }

  switch (sub) {
    case "up":
    case "start":
      return cmdUp(flags);
    case "down":
    case "stop":
      return cmdDown(flags);
    case "status":
    case "ps":
      return cmdStatus(flags);
    case "logs":
      return cmdLogs(flags);
    case "print":
    case "write":
      return cmdPrint(flags);
    case "mcp-config":
      return cmdMcpConfig(flags);
    default:
      console.error(`unknown 'docker' command: ${sub}\n`);
      console.error(DOCKER_USAGE);
      return 1;
  }
}

/** Absolute-path helper kept exported for the tests. */
export function absolute(path: string): string {
  return isAbsolute(path) ? path : resolve(path);
}
