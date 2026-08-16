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
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  /**
   * Which options the caller actually typed.
   *
   * Every field above has a default, and a default is indistinguishable from a
   * choice once it is sitting in the struct. That distinction is load-bearing
   * twice over: `stateloom docker status` must not overwrite the recorded
   * document directory with `./looms` merely by having one, and an explicitly
   * requested port must never be silently moved while an implicit one may be.
   */
  given: Set<keyof DockerFlags>;
}

const DEFAULT_PORT = 4598;

/** Keys of the env file, and the flag each one records. */
const ENV_KEYS = {
  port: "STATELOOM_PORT",
  bind: "STATELOOM_BIND",
  dir: "STATELOOM_DOC_DIR",
  doc: "STATELOOM_DOC",
  token: "STATELOOM_MCP_TOKEN",
  image: "STATELOOM_IMAGE",
} as const;

/** The mirrored copy of the repository's docker assets, inside this package. */
export function dockerAssetsRoot(): string {
  const override = process.env.STATELOOM_DOCKER_SOURCE;
  if (override) return resolve(override);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "docker");
}

export function parseDockerFlags(argv: string[]): DockerFlags {
  const f: DockerFlags = {
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
    given: new Set(),
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
        f.given.add("port");
        if (!Number.isInteger(f.port) || f.port < 1 || f.port > 65535) {
          throw new Error(`--port is not a port number: ${argv[i]}`);
        }
        break;
      case "--dir":
      case "-d":
        f.dir = need(++i, "--dir");
        f.given.add("dir");
        break;
      case "--doc":
        f.doc = need(++i, "--doc");
        f.given.add("doc");
        break;
      case "--bind":
        f.bind = need(++i, "--bind");
        f.given.add("bind");
        break;
      case "--image":
        f.image = need(++i, "--image");
        f.given.add("image");
        break;
      case "--token":
        f.token = need(++i, "--token");
        f.given.add("token");
        break;
      case "--project":
      case "-p":
        f.project = need(++i, "--project");
        f.given.add("project");
        break;
      case "--workspace":
        f.workspace = need(++i, "--workspace");
        f.given.add("workspace");
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

/** Is the thing listening on this port one of our own gateways? */
async function ourGateway(port: number, bind: string): Promise<boolean> {
  const host = bind === "0.0.0.0" ? "127.0.0.1" : bind;
  try {
    const r = await fetch(`http://${host}:${port}/healthz`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok && r.status !== 503) return false;
    const body = (await r.json()) as { gateway?: boolean };
    // 503 counts: a gateway with an upstream still starting is still OUR port.
    return body.gateway === true;
  } catch {
    return false;
  }
}

/**
 * The port the human will open — and, on a re-run, the port they are ALREADY
 * looking at.
 *
 * A port that is busy because our own gateway is on it is not a conflict, it is
 * the answer: `up` is idempotent, and the second run must land on the same URL
 * as the first. Walking away from it instead kills the open tab and breaks every
 * MCP client registered against it — silently, which is the failure class this
 * whole design exists to delete. (Found in review: two identical `up` commands
 * returned :4600 and then :4601.)
 *
 * So the order is: what you asked for, then what this project recorded, then a
 * walk from 4598 — and the walk announces itself, because a moved port is
 * information.
 */
async function choosePort(f: DockerFlags, recorded?: number): Promise<number> {
  const usable = async (port: number) =>
    (await portFree(port, f.bind)) || (await ourGateway(port, f.bind));

  if (f.given.has("port")) {
    const port = f.port!;
    if (await usable(port)) return port;
    throw new Error(
      `port ${port} is already in use on ${f.bind} by something that is not a stateloom gateway.\n` +
        `  Pick another with --port, or omit --port to take the first free one from ${DEFAULT_PORT}.`,
    );
  }

  if (recorded && Number.isInteger(recorded)) {
    if (await usable(recorded)) return recorded;
    console.error(
      `note: this project's recorded port ${recorded} is held by something else — choosing a new one.`,
    );
  }

  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 100; port++) {
    if (await portFree(port, f.bind)) {
      if (recorded && port !== recorded) {
        console.error(`note: the loom will be at :${port}, not the previous :${recorded}.`);
      }
      return port;
    }
  }
  throw new Error(`no free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + 99} on ${f.bind}.`);
}

/**
 * Turn `--doc` into a path RELATIVE TO THE MOUNT, or refuse.
 *
 * `STATELOOM_DOC` is interpolated by compose as `/data/${STATELOOM_DOC}`, so an
 * unvalidated value composes silent nonsense. The dangerous one is not `..` —
 * that fails visibly — it is an absolute host path, because it WORKS:
 * `/data//b/trading/diagrams/x.smdf.json` gets created inside the mount, seeded
 * empty, and the human's real diagram sits untouched one directory up while the
 * canvas shows a blank machine. (Found in review.)
 *
 * An absolute path is also the natural thing to type. So it is accepted and
 * translated rather than rejected: under the documents directory it becomes the
 * relative remainder, and with no `--dir` given it *chooses* the directory —
 * which is almost always what the person meant.
 */
export function resolveDocument(
  doc: string,
  dir: string,
  dirWasGiven: boolean,
): { doc: string; dir: string; note?: string } {
  const clean = doc.trim();
  if (!clean) throw new Error("--doc needs a document name");
  if (!clean.endsWith(".json")) {
    throw new Error(
      `--doc must name a .json document (convention: .smdf.json) — got "${clean}"`,
    );
  }

  if (isAbsolute(clean)) {
    const docDir = dirname(resolve(clean));
    const name = basename(clean);
    if (!dirWasGiven) {
      return {
        doc: name,
        dir: docDir,
        note: `--doc is an absolute path, so ${docDir} is the documents directory (mounted at /data).`,
      };
    }
    const root = resolve(dir);
    const rel = relative(root, resolve(clean));
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(
        `--doc ${clean} is not inside --dir ${root}.\n` +
          `  Only the documents directory is mounted, so a path outside it is not reachable\n` +
          `  from the container. Name one or the other, not both.`,
      );
    }
    return { doc: rel, dir: root };
  }

  // Relative: a plain name, or a subdirectory of the mount. Never upward.
  const normalized = clean.replace(/^\.\//, "");
  if (normalized.split("/").includes("..")) {
    throw new Error(
      `--doc must stay inside the documents directory — "${clean}" climbs out of it.`,
    );
  }
  return { doc: normalized, dir: dirWasGiven ? resolve(dir) : resolve(dir) };
}

interface Project {
  workspace: string;
  composeFile: string;
  envFile: string;
  docDir: string;
  doc: string;
  bind: string;
  image: string;
  port: number;
  token: string;
  url: string;
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
 * Read the project's settings without writing anything.
 *
 * `status`, `logs`, `down` and `mcp-config` are QUESTIONS. Before review they
 * all went through the writer below, which composed the file out of flag
 * defaults — so `stateloom docker status` discarded the recorded documents
 * directory, document and bind address, and the next bare `up` mounted an empty
 * ./looms with the human's diagrams nowhere on the board. A question must not
 * change the answer.
 */
function readProject(f: DockerFlags): Project & { pinned: Set<keyof typeof ENV_KEYS> } {
  const workspace = resolve(f.workspace);
  const envFile = join(workspace, ".env");
  const e = readEnvFile(envFile);

  // A setting is PINNED when somebody chose it — on this command line, or on an
  // earlier one that wrote it here. Only an unpinned setting may fall back to a
  // default, and only a pinned documents directory constrains an absolute --doc.
  const pinned = new Set<keyof typeof ENV_KEYS>();

  // Precedence: what you typed now > what this project recorded > the default.
  const pick = <K extends keyof typeof ENV_KEYS>(key: K, fallback: string): string => {
    if (f.given.has(key as keyof DockerFlags)) {
      pinned.add(key);
      return String(f[key as keyof DockerFlags] ?? fallback);
    }
    const recorded = e[ENV_KEYS[key]];
    if (recorded !== undefined && recorded !== "") {
      pinned.add(key);
      return recorded;
    }
    return fallback;
  };

  const bind = pick("bind", f.bind);
  const port = Number(pick("port", String(f.port ?? DEFAULT_PORT)));
  const docDir = resolve(pick("dir", f.dir));
  const host = bind === "0.0.0.0" ? "127.0.0.1" : bind;

  return {
    workspace,
    composeFile: join(workspace, "docker-compose.yml"),
    envFile,
    docDir,
    doc: pick("doc", f.doc),
    bind,
    image: pick("image", f.image),
    port,
    token: pick("token", ""),
    url: `http://${host}:${port}`,
    pinned,
  };
}

/**
 * Write (or refresh) the compose project on disk.
 *
 * Settings are the MERGE of what the caller typed over what the project already
 * recorded — never the flag defaults alone. The token in particular is generated
 * exactly once and re-read forever after: that is the difference between a loom
 * an MCP client can stay registered against and one whose registration breaks
 * every time somebody restarts it.
 */
async function materialize(f: DockerFlags, opts: { port?: number } = {}): Promise<Project> {
  const base = readProject(f);

  const assets = dockerAssetsRoot();
  const source = join(assets, "docker-compose.yml");
  if (!existsSync(source)) {
    throw new Error(
      `the bundled compose file is missing (${source}).\n` +
        `  Only a broken install can produce this. Reinstall @miadi/stateloom-skills.`,
    );
  }

  const resolved = resolveDocument(base.doc, base.docDir, base.pinned.has("dir"));
  if (resolved.note) console.error(`note: ${resolved.note}`);

  const docDir = resolved.dir;
  const port = opts.port ?? base.port;
  const host = base.bind === "0.0.0.0" ? "127.0.0.1" : base.bind;
  const url = `http://${host}:${port}`;
  const token = base.token || randomBytes(24).toString("hex");

  mkdirSync(base.workspace, { recursive: true });
  // The mount source must exist before compose starts, or the daemon creates it
  // as root and every document written afterwards belongs to root.
  mkdirSync(docDir, { recursive: true });
  copyFileSync(source, base.composeFile);

  const env = [
    "# Written by `stateloom docker`. Edit freely — every value here is read back",
    "# on the next command and only overridden by a flag you actually pass.",
    `STATELOOM_PORT=${port}`,
    `STATELOOM_BIND=${base.bind}`,
    `STATELOOM_DOC_DIR=${docDir}`,
    `STATELOOM_DOC=${resolved.doc}`,
    `STATELOOM_UID=${typeof process.getuid === "function" ? process.getuid() : 1000}`,
    `STATELOOM_GID=${typeof process.getgid === "function" ? process.getgid() : 1000}`,
    `STATELOOM_MCP_TOKEN=${token}`,
    `STATELOOM_IMAGE=${base.image}`,
    "",
    "# The address the MCP server puts in the canvas links it hands an agent.",
    "# Without it the link names the container's INTERNAL port (4598), which on a",
    "# host already running a loom opens somebody else's diagram. Serving the",
    "# network (STATELOOM_BIND=0.0.0.0)? Change 127.0.0.1 here to the hostname",
    "# your humans actually type — this value is resolved by their browser.",
    `STATELOOM_CANVAS_URL=${url}`,
    "",
  ].join("\n");
  writeFileSync(base.envFile, env);

  return { ...base, docDir, doc: resolved.doc, port, token, url };
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
  // The recorded port is an input to the choice, not an output of it. Reading
  // the project first is what makes a second `up` land on the same URL as the
  // first instead of walking past its own live gateway.
  const previous = readProject(f);
  const port = await choosePort(f, previous.pinned.has("port") ? previous.port : undefined);
  const project = await materialize(f, { port });
  const url = project.url;

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
    document: join(project.docDir, project.doc),
    documentsDir: project.docDir,
    canvasUrl: project.url,
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
   Open first       ${project.doc}

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
  // readProject, not materialize: stopping a loom must not rewrite its settings.
  const project = readProject(f);
  if (!existsSync(project.composeFile)) {
    console.error(`no compose project at ${project.composeFile} — nothing to stop.`);
    return 1;
  }
  return compose(project, f.project, ["down", "--remove-orphans"]);
}

async function cmdStatus(f: DockerFlags): Promise<number> {
  requireDocker();
  const project = readProject(f);
  const url = project.url;
  if (!existsSync(project.composeFile)) {
    console.error(`no compose project at ${project.composeFile} — start one with \`stateloom docker up\`.`);
    return 1;
  }

  let health: unknown = null;
  try {
    const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(4000) });
    health = await r.json();
  } catch {
    health = { ok: false, reason: "the gateway is not answering" };
  }

  if (f.json) {
    console.log(
      JSON.stringify(
        {
          url,
          mcp: `${url}/mcp`,
          document: join(project.docDir, project.doc),
          documentsDir: project.docDir,
          health,
        },
        null,
        2,
      ),
    );
  } else {
    compose(project, f.project, ["ps"]);
    console.log(`\n${url}  →  ${JSON.stringify(health)}`);
    console.log(`${join(project.docDir, project.doc)}`);
  }
  return (health as { ok?: boolean }).ok ? 0 : 1;
}

async function cmdLogs(f: DockerFlags): Promise<number> {
  requireDocker();
  const project = readProject(f);
  if (!existsSync(project.composeFile)) {
    console.error(`no compose project at ${project.composeFile} — nothing to follow.`);
    return 1;
  }
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
  // Same rule as `up`: an explicit port, else the one this project recorded,
  // else the convention. `print` used to reset a running project to 4598.
  const previous = readProject(f);
  const port = f.given.has("port") ? f.port! : previous.port;
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
  const project = readProject(f);
  if (!project.token) {
    console.error(
      `no MCP token recorded in ${project.envFile}.\n` +
        `  Start the loom first (\`stateloom docker up\`), which generates and keeps one.`,
    );
    return 1;
  }
  console.log(JSON.stringify(mcpRegistration(project.url, project.token), null, 2));
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
