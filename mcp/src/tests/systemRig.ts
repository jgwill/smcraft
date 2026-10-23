/**
 * A rig for the system tools (Spec 82) on a copy of the worked example
 * (examples/wave-count): a real McpServer and Client over an in-memory
 * transport, the sequence and system tools registered on it, and a host that
 * stands in for server.ts. Its `live` records what would go to the hub unless a
 * real one is passed. Shared by system.test.ts and live.test.ts.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { PatchOp, ViewEnvelope } from "@miadi/stateloom-protocol";
import { registerSequenceTools, type SequenceHost } from "../sequence.js";
import { reconcileAfterEdit, registerSystemTools, type SystemHost } from "../system.js";
import type { Live } from "../live.js";

export const EXAMPLE = fileURLToPath(new URL("../../../examples/wave-count", import.meta.url));
export const SYSTEM = "elliott_wave_count.sysdf.json";
export const MACHINE = "elliott_wave_count.smdf.json";
export const SEQUENCE = "wave_count_to_entry.sqdf.json";

/** The message the tests add: a new event and a new state after the main path's last move. */
export const NEW_MESSAGE = {
  from: "Strategy",
  to: "Analysis",
  label: "the entry fills; the count is fulfilled",
  event: "CountFulfilled",
  state: "Fulfilled",
};

export interface Pushes {
  patch: { docId: string; ops: PatchOp[] }[];
  full: { docId: string; def: unknown }[];
  view: Omit<ViewEnvelope, "origin">[];
}

export interface SysRig {
  dir: string;
  pushes: Pushes;
  sequenceHost: SequenceHost;
  systemHost: SystemHost;
  /** A name inside the rig's folder, or an absolute path. */
  setActive(name: string): void;
  call(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  json<T = unknown>(name: string): T;
  close(): Promise<void>;
}

export interface SysRigOptions {
  live?: Live;
  reconcile?: string;
  validate?: SystemHost["validateMachine"];
  /** Confine documents to the rig's folder, as STATELOOM_MCP_ROOT does. */
  root?: boolean;
  /** The last system this server used, before any call. */
  last?: string;
}

export async function sysRig(opts: SysRigOptions = {}): Promise<SysRig> {
  const dir = mkdtempSync(join(tmpdir(), "loom-sys-"));
  cpSync(EXAMPLE, dir, { recursive: true });
  let active = join(dir, SEQUENCE);
  let last: string | undefined = opts.last;
  const outsideRoot = (p: string): string | undefined =>
    opts.root && p !== dir && !resolve(p).startsWith(dir + "/") ? `Refused: ${p} is outside ${dir}` : undefined;
  const pushes: Pushes = { patch: [], full: [], view: [] };
  const live: Live = opts.live ?? {
    patch: async (docId, ops) => {
      pushes.patch.push({ docId, ops });
      return { ok: true, text: "patch sent live (seq 1)" };
    },
    full: async (docId, def) => {
      pushes.full.push({ docId, def });
      return { ok: true, text: "document sent live (seq 1)" };
    },
    view: async (view) => {
      pushes.view.push(view);
      return { ok: true, text: "view sent to the hub" };
    },
  };
  const systemHost: SystemHost = {
    projectFile: () => active,
    outsideRoot,
    emitFull: () => {},
    live,
    reconcileOverride: () => opts.reconcile,
    validateMachine: opts.validate ?? (() => []),
    machineSpec: (def, level) => [`${"#".repeat(level)} States`, "", ...(def.state?.states ?? []).map((s) => `- ${s.name}`), ""],
    lastSystem: () => last,
    rememberSystem: (p) => {
      last = p;
    },
  };
  const sequenceHost: SequenceHost = {
    projectFile: () => active,
    switchTo: (p) => {
      active = p;
      return undefined;
    },
    emitFull: () => {},
    outsideRoot,
    afterEdit: (p) => reconcileAfterEdit(systemHost, p),
  };
  const server = new McpServer({ name: "sys-test", version: "0.0.0" });
  registerSequenceTools(server, sequenceHost);
  registerSystemTools(server, systemHost);
  const client = new Client({ name: "sys-test-client", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    dir,
    pushes,
    sequenceHost,
    systemHost,
    setActive: (name) => {
      active = resolve(dir, name);
    },
    call: async (name, args = {}) => {
      const r = await client.callTool({ name, arguments: args });
      const content = r.content as { type: string; text?: string }[];
      return { text: content.map((c) => c.text ?? "").join("\n"), isError: r.isError === true };
    },
    json: (name) => JSON.parse(readFileSync(join(dir, name), "utf8")),
    close: async () => {
      await client.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
