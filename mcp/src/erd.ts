/**
 * The ERD half of the MCP server (Spec 80).
 *
 * The loom weaves one active document at a time, and the document's type is
 * its extension: `.smdf.json` is a state machine, `.erdf.json` an
 * entity-relationship definition. The tools here act on the active document
 * when it is an ERDF; `create_erd` is the one that also moves the active
 * document, because naming an ERD is how its first version is written.
 *
 * An ERD travels to the live canvas as a whole document (`emitFull`) — the
 * granular PatchOp vocabulary is SMDF's, and an ERD is small enough that the
 * whole of it is a reasonable unit of change.
 *
 * Everything that touches the server's own state comes in through `ErdHost`,
 * so a test can register these tools on a bare McpServer over a temp directory.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  addAttribute,
  addEntity,
  addRelationship,
  checkLinks,
  checkStateOf,
  emptyErd,
  ERD_CARDINALITIES,
  isErdDefinition,
  isErdfPath,
  removeAttribute,
  removeEntity,
  removeRelationship,
  renderMermaidEr,
  updateEntity,
  summarizeErd,
  validateErd,
  type EntityRelationshipDefinition,
  type ErdCardinality,
  type ErdValidationError,
  type StateMachineDefinition,
} from "@miadi/stateloom-protocol";
import { stampedOutputPath } from "@miadi/stateloom-cli/render";

export interface ErdHost {
  /** The active document's absolute path. */
  projectFile(): string;
  /** Re-point the active document under set_project_file's guards. Returns the refusal, if any. */
  switchTo(path: string): string | undefined;
  /** Mirror the whole document to the live bridge room. Best-effort. */
  emitFull(def: EntityRelationshipDefinition): void;
  /** The refusal for a path outside the permitted document root, if any. */
  outsideRoot(path: string): string | undefined;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

export function readErd(path: string): EntityRelationshipDefinition | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isErdDefinition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeErd(path: string, def: EntityRelationshipDefinition): void {
  writeFileSync(path, JSON.stringify(def, null, 2) + "\n", "utf8");
}

/** One line for set_project_file / get_project_file when the active document is an ERDF. */
export function erdSummary(path: string): string {
  const def = readErd(path);
  if (def) {
    return `existing ERD '${def.settings?.name ?? ""}' (${def.entities.length} entities, ${(def.relationships ?? []).length} relationships)`;
  }
  return existsSync(path)
    ? "file exists but is not a readable ERD definition"
    : "no file yet — create_erd or load_definition will write it";
}

const NOT_ERD = (path: string): string =>
  `The active document ${path} is not an ERD. Use create_erd, or set_project_file to a .erdf.json document.`;

/** Read the active ERD, apply `edit`, persist, mirror, and report. Errors become tool errors. */
function mutate(
  host: ErdHost,
  edit: (def: EntityRelationshipDefinition) => EntityRelationshipDefinition,
  report: (def: EntityRelationshipDefinition) => string,
): ToolResult {
  const path = host.projectFile();
  if (!isErdfPath(path)) return fail(NOT_ERD(path));
  const def = readErd(path);
  if (!def) return fail(`No ERD at ${path}. Use create_erd first.`);
  try {
    const next = edit(def);
    writeErd(path, next);
    host.emitFull(next);
    return ok(report(next));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

// ─── The tools that answer by extension (called from server.ts) ──────

export function erdGetDefinition(host: ErdHost): ToolResult {
  const def = readErd(host.projectFile());
  return def ? ok(JSON.stringify(def, null, 2)) : fail(`No ERD at ${host.projectFile()}.`);
}

export function erdLoadDefinition(host: ErdHost, json: string): ToolResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return fail(`Invalid JSON: ${e}`);
  }
  if (!isErdDefinition(parsed)) {
    return fail(
      `The active document ${host.projectFile()} is an ERD, and this JSON is not one (it needs an "entities" array and no "state"). ` +
        `To load a state machine, set_project_file to a .smdf.json document first.`,
    );
  }
  const def: EntityRelationshipDefinition = { ...parsed, relationships: parsed.relationships ?? [] };
  writeErd(host.projectFile(), def);
  host.emitFull(def);
  const errors = validateErd(def);
  return ok(
    `Loaded ERD → ${host.projectFile()}: ${def.settings?.name ?? ""} (${def.entities.length} entities, ${def.relationships.length} relationships)` +
      (errors.length ? `\n${formatErrors(errors)}` : ""),
  );
}

export function erdRender(
  host: ErdHost,
  opts: { format?: string; path?: string; stamp?: boolean },
): ToolResult {
  const doc = host.projectFile();
  const def = readErd(doc);
  if (!def) return fail(`No ERD at ${doc}.`);
  const format = opts.format ?? "mermaid";
  if (format !== "mermaid") {
    return fail(
      `An ERD renders as mermaid only (asked for ${format}); svg and png are not drawn for an ERD yet.`,
    );
  }
  if (opts.path) {
    const denial = host.outsideRoot(opts.path);
    if (denial) return fail(denial);
  }
  // `.erd.mmd`, so a machine and an ERD that share a basename never overwrite each other.
  const out = opts.path
    ? resolve(opts.path)
    : opts.stamp
      ? stampedOutputPath(doc, def.settings?.name, "mermaid", new Date())
      : resolve(doc).replace(/\.erdf\.json$/i, "") + ".erd.mmd";
  const text = renderMermaidEr(def);
  writeFileSync(out, text + "\n", "utf8");
  return {
    content: [
      { type: "text", text: `Rendered ERD '${def.settings?.name ?? ""}' → ${out} (${text.length} bytes)` },
      { type: "text", text },
    ],
  };
}

const formatErrors = (errors: ErdValidationError[]): string =>
  errors.map((e) => `[${e.ruleId}] ${e.message}`).join("\n");

function readSmdf(path: string): StateMachineDefinition | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const def = parsed.stateMachine ?? parsed.StateMachine ?? parsed;
    return def && typeof def === "object" && def.state ? (def as StateMachineDefinition) : null;
  } catch {
    return null;
  }
}

// ─── Tool registration ───────────────────────────────────────────────

export function registerErdTools(server: McpServer, host: ErdHost): void {
  server.tool(
    "create_erd",
    "Create a new entity-relationship definition (.erdf.json) and make it the active document. An ERD is the sibling of a state machine: it describes the data the machines act on, once, for every machine that touches it. Without `path` it lands next to the active document as <name>.erdf.json. Refuses to replace an ERD that already has entities unless overwrite is true.",
    {
      namespace: z.string(),
      name: z.string(),
      description: z.string().optional(),
      path: z.string().optional(),
      overwrite: z.boolean().optional(),
    },
    async ({ namespace, name, description, path, overwrite }) => {
      const active = host.projectFile();
      const target = resolve(
        path ?? (isErdfPath(active) ? active : join(dirname(active), `${name}.erdf.json`)),
      );
      if (!isErdfPath(target)) return fail(`An ERD document ends in .erdf.json (got '${target}').`);
      const existing = readErd(target);
      if (existing && existing.entities.length > 0 && !overwrite) {
        return fail(
          `${target} already holds ERD '${existing.settings?.name ?? ""}' with ${existing.entities.length} entities. ` +
            `Pass overwrite: true to replace it, or set_project_file to it to keep working on it.`,
        );
      }
      if (target !== active) {
        const denial = host.switchTo(target);
        if (denial) return fail(denial);
      }
      const def = emptyErd(namespace, name, description);
      writeErd(target, def);
      host.emitFull(def);
      return ok(`Created ERD '${name}' in namespace '${namespace}' → ${target}. It is now the active document. Add entities next.`);
    },
  );

  server.tool(
    "add_entity",
    "Add an entity to the active ERD. `weak` marks an entity that exists only through another one (an order line, without its order); Chen notation draws it as a double rectangle.",
    { name: z.string(), description: z.string().optional(), weak: z.boolean().optional() },
    async ({ name, description, weak }) =>
      mutate(
        host,
        (def) => addEntity(def, { name, description, weak: weak || undefined }),
        () => `Added ${weak ? "weak " : ""}entity '${name}'.`,
      ),
  );

  server.tool(
    "update_entity",
    "Change an entity's description or whether it is weak, keeping its attributes and relationships. Omit a field to leave it alone; an empty description or weak:false clears it.",
    { name: z.string(), description: z.string().optional(), weak: z.boolean().optional() },
    async ({ name, description, weak }) =>
      mutate(host, (def) => updateEntity(def, name, { description, weak }), () => `Updated entity '${name}'.`),
  );

  server.tool(
    "add_attribute",
    "Add an attribute to an entity of the active ERD. `key` is pk or uk; a foreign key is stated by `references` ('Entity' or 'Entity.attribute'), so one attribute can be both. `stateOf` names the state machine(s) whose current state this attribute stores — the link between the two diagrams.",
    {
      entity: z.string(),
      name: z.string(),
      type: z.string(),
      key: z.enum(["pk", "uk"]).optional(),
      references: z.string().optional(),
      nullable: z.boolean().optional(),
      stateOf: z.union([z.string(), z.array(z.string())]).optional(),
      description: z.string().optional(),
    },
    async ({ entity, ...attribute }) =>
      mutate(
        host,
        (def) => addAttribute(def, entity, attribute),
        () => `Added attribute '${entity}.${attribute.name}' (${attribute.type}).`,
      ),
  );

  server.tool(
    "add_relationship",
    "Add a relationship between two entities of the active ERD. Cardinality reads left to right: one `from` has many `to` is 1:N.",
    {
      from: z.string(),
      to: z.string(),
      cardinality: z.enum(ERD_CARDINALITIES as [ErdCardinality, ...ErdCardinality[]]),
      label: z.string().optional(),
      description: z.string().optional(),
    },
    async (rel) =>
      mutate(
        host,
        (def) => addRelationship(def, rel),
        () => `Added relationship ${rel.from} ${rel.cardinality} ${rel.to}${rel.label ? ` : ${rel.label}` : ""}.`,
      ),
  );

  server.tool(
    "remove_entity",
    "Remove an entity from the active ERD, with every relationship that touches it. Attributes elsewhere that reference it are left in place; validate_erd names them.",
    { name: z.string() },
    async ({ name }) =>
      mutate(host, (def) => removeEntity(def, name), () => `Removed entity '${name}' and its relationships.`),
  );

  server.tool(
    "remove_attribute",
    "Remove an attribute from an entity of the active ERD",
    { entity: z.string(), name: z.string() },
    async ({ entity, name }) =>
      mutate(host, (def) => removeAttribute(def, entity, name), () => `Removed attribute '${entity}.${name}'.`),
  );

  server.tool(
    "remove_relationship",
    "Remove the relationship(s) written from one entity to another in the active ERD — only the one carrying `label` when a label is given.",
    { from: z.string(), to: z.string(), label: z.string().optional() },
    async ({ from, to, label }) =>
      mutate(
        host,
        (def) => removeRelationship(def, from, to, label),
        () => `Removed relationship ${from} → ${to}${label ? ` : ${label}` : ""}.`,
      ),
  );

  server.tool(
    "validate_erd",
    "Validate the active ERD against rules E001–E005 (unique names, relationship ends, cardinality, references) and list what it holds",
    {},
    async () => {
      const path = host.projectFile();
      if (!isErdfPath(path)) return fail(NOT_ERD(path));
      const def = readErd(path);
      if (!def) return fail(`No ERD at ${path}. Use create_erd first.`);
      const errors = validateErd(def);
      const body = summarizeErd(def) || "(empty)";
      return errors.length
        ? fail(`${errors.length} problem(s) in '${def.settings?.name ?? ""}':\n${formatErrors(errors)}\n\n${body}`)
        : ok(`ERD '${def.settings?.name ?? ""}' is valid.\n${body}`);
    },
  );

  server.tool(
    "check_links",
    "Check the names a state machine uses for its data against an ERD (rules L001–L004): the class of each object a guard reads a field of must be an entity, each <instance>.<field> in a guard must be an attribute of it, and an attribute's stateOf must point at a machine built with that entity. With no arguments: when the active document is an ERD, every .smdf.json beside it is checked; when it is a state machine, pass erd_path.",
    { erd_path: z.string().optional(), smdf_paths: z.array(z.string()).optional() },
    async ({ erd_path, smdf_paths }) => {
      const active = host.projectFile();
      const erdPath = erd_path ? resolve(erd_path) : isErdfPath(active) ? active : undefined;
      if (!erdPath) {
        return fail(`The active document ${active} is a state machine — pass erd_path, the .erdf.json to check it against.`);
      }

      // The single active machine is one of possibly several, so its ERD's other
      // stateOf names are not held against it; any other set is "the machines at hand".
      let machinesAreTheSet = true;
      let smdfPaths: string[];
      if (smdf_paths?.length) {
        smdfPaths = smdf_paths.map((p) => resolve(p));
      } else if (!isErdfPath(active)) {
        smdfPaths = [active];
        machinesAreTheSet = false;
      } else {
        const dir = dirname(erdPath);
        smdfPaths = readdirSync(dir)
          .filter((f) => f.toLowerCase().endsWith(".smdf.json"))
          .sort()
          .map((f) => join(dir, f));
        if (smdfPaths.length === 0) return fail(`No .smdf.json beside ${erdPath} — pass smdf_paths.`);
      }

      for (const p of [erdPath, ...smdfPaths]) {
        const denial = host.outsideRoot(p);
        if (denial) return fail(denial);
      }

      const erd = readErd(erdPath);
      if (!erd) return fail(`No readable ERD at ${erdPath}.`);

      const lines: string[] = [];
      const names: string[] = [];
      let problems = 0;
      for (const p of smdfPaths) {
        const smdf = readSmdf(p);
        if (!smdf) {
          lines.push(`${p}: not a readable state machine`);
          problems += 1;
          continue;
        }
        const name = smdf.settings?.name ?? p;
        names.push(name);
        const errors = checkLinks(smdf, erd);
        problems += errors.length;
        lines.push(errors.length ? `${name} (${p}):\n${formatErrors(errors)}` : `${name}: every name resolves`);
      }
      if (machinesAreTheSet) {
        const errors = checkStateOf(erd, names);
        problems += errors.length;
        if (errors.length) lines.push(formatErrors(errors));
      }

      const head = `Checked ${smdfPaths.length} machine(s) against ERD '${erd.settings?.name ?? ""}' (${erdPath}): ${problems} problem(s).`;
      const text = `${head}\n${lines.join("\n")}`;
      return problems ? fail(text) : ok(text);
    },
  );
}
