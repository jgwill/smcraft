/**
 * The decision half of the MCP server (Spec 85).
 *
 * A decision model (`.dmdf.json`) says how a decision is made: what it reads,
 * what a decision engine is asked, the table that combines the answers, and
 * the person who rules. The tools here read it, check it, draw it, build the
 * request it makes of its engine, and run it from recorded answers.
 *
 * Nothing here asks an engine. `decision_request` returns the request and sends
 * nothing; `simulate_decision` and `replay_decision_ledger` evaluate recorded
 * answers with the protocol's evaluator, the same one every other caller uses,
 * so the outcome and the rule trace are the same wherever they are computed.
 *
 * A decision model travels to the live canvas as a whole document (`emitFull`),
 * as an ERD and a sequence do.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, resolve } from "path";
import {
  docKindOfPath,
  evaluateDecisions,
  formatDecisionRun,
  formatLedgerReplay,
  isDecisionModelDefinition,
  isDmdfPath,
  normalizeNotes,
  renderMermaidDecisions,
  replayLedger,
  requestGroups,
  toEngineRequest,
  validateDecisionModel,
  type DecisionModelDefinition,
  type DmdValidationError,
} from "@miadi/stateloom-protocol";
import { stampedOutputPath } from "@miadi/stateloom-cli/render";
import { formatNotes } from "./erd.js";
import { writeFileAtomic } from "./atomicWrite.js";

export interface DecisionHost {
  /** The active document's absolute path. */
  projectFile(): string;
  /** Mirror the whole document to the live bridge room. Best-effort. */
  emitFull(def: DecisionModelDefinition): void;
  /** The refusal for a path outside the permitted document root, if any. */
  outsideRoot(path: string): string | undefined;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const KIND_WORDS = {
  machine: "a state machine",
  erd: "an ERD",
  sequence: "a sequence",
  system: "a system",
  decision: "a decision model",
} as const;

export function readDecisionModel(path: string): DecisionModelDefinition | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = normalizeNotes(JSON.parse(readFileSync(path, "utf8")));
    return isDecisionModelDefinition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeDecisionModel(path: string, def: DecisionModelDefinition): void {
  writeFileAtomic(path, JSON.stringify(def, null, 2) + "\n");
}

const NOT_DECISION = (path: string): string =>
  `The active document ${path} is ${KIND_WORDS[docKindOfPath(path)]}, not a decision model. Use set_project_file to a .dmdf.json document.`;

/** The active decision model, or the refusal that says why there is none. */
function active(host: DecisionHost): DecisionModelDefinition | ToolResult {
  const path = host.projectFile();
  if (!isDmdfPath(path)) return fail(NOT_DECISION(path));
  const def = readDecisionModel(path);
  return def ?? fail(`No decision model at ${path}. Write one with load_definition.`);
}

const isRefusal = (x: DecisionModelDefinition | ToolResult): x is ToolResult => "content" in x;

function counts(def: DecisionModelDefinition): string {
  const of = (kind: string) => (def.decisions ?? []).filter((d) => d?.logic?.kind === kind).length;
  const n = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
  return `${n((def.inputs ?? []).length, "input")}, ${n(of("question"), "question")}, ${n(of("table"), "table")}, ${of("person")} ruled by a person`;
}

/** One line for set_project_file / get_project_file when the active document is a DMDF. */
export function decisionSummary(path: string): string {
  const def = readDecisionModel(path);
  if (def) return `existing decision model '${def.settings?.name ?? ""}' ${def.settings?.version ?? "(no version)"} (${counts(def)})`;
  return existsSync(path)
    ? "file exists but is not a readable decision model"
    : "no file yet — load_definition will write it";
}

const formatIssues = (issues: DmdValidationError[]): string =>
  issues.map((e) => `[${e.ruleId}]${e.severity === "warning" ? " (warning)" : ""} ${e.message}`).join("\n");

/** One line per input, knowledge and decision — what validate_decision_model shows under its verdict. */
export function summarizeDecisionModel(def: DecisionModelDefinition): string {
  const lines: string[] = [];
  for (const i of def.inputs ?? []) lines.push(`input ${i.name}${i.entity ? ` (the entity ${i.entity})` : ""}`);
  for (const k of def.knowledge ?? []) lines.push(`${k.kind} ${k.name}`);
  for (const b of def.bars ?? []) lines.push(`bar ${b.name} = ${b.value}${b.set_by ? `, set by ${b.set_by}` : ""}`);
  for (const g of requestGroups(def)) lines.push(`request ${g.name}: ${g.questions.join(", ")}`);
  for (const d of def.decisions ?? []) {
    const logic = d.logic;
    const what =
      logic?.kind === "question"
        ? `question, ${logic.type}`
        : logic?.kind === "table"
          ? `table, ${logic.hit}, ${(logic.rules ?? []).length} rule(s)`
          : logic?.kind === "person"
            ? `person: ${logic.who}`
            : "no logic";
    lines.push(`${d.name} — ${what}${d.requires?.length ? `; reads ${d.requires.join(", ")}` : ""}`);
  }
  return lines.join("\n");
}

// ─── The tools that answer by extension (called from server.ts) ──────

export function decisionGetDefinition(host: DecisionHost): ToolResult {
  const def = readDecisionModel(host.projectFile());
  return def ? ok(JSON.stringify(def, null, 2)) : fail(`No decision model at ${host.projectFile()}.`);
}

export function decisionLoadDefinition(host: DecisionHost, json: string): ToolResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return fail(`Invalid JSON: ${e}`);
  }
  if (!isDecisionModelDefinition(parsed)) {
    return fail(
      `The active document ${host.projectFile()} is a decision model, and this JSON is not one (it needs a "decisions" array, and no "state", "entities", "participants" or "members"). ` +
        `To load another kind of document, set_project_file to a document of that kind first.`,
    );
  }
  const path = host.projectFile();
  const denial = host.outsideRoot(path);
  if (denial) return fail(denial);
  writeDecisionModel(path, parsed);
  host.emitFull(parsed);
  const issues = validateDecisionModel(parsed);
  return ok(
    `Loaded decision model → ${path}: ${parsed.settings?.name ?? ""} ${parsed.settings?.version ?? "(no version)"} (${counts(parsed)})` +
      (issues.length ? `\n${formatIssues(issues)}` : ""),
  );
}

export function decisionRender(host: DecisionHost, opts: { format?: string; path?: string; stamp?: boolean }): ToolResult {
  const doc = host.projectFile();
  const def = readDecisionModel(doc);
  if (!def) return fail(`No decision model at ${doc}.`);
  const format = opts.format ?? "mermaid";
  if (format !== "mermaid") {
    return fail(`A decision model renders as mermaid only (asked for ${format}); svg and png are not drawn for a decision model yet.`);
  }
  if (opts.path) {
    const denial = host.outsideRoot(opts.path);
    if (denial) return fail(denial);
  }
  // `.dmd.mmd`, so the drawings of documents that share a basename never overwrite each other.
  const out = opts.path
    ? resolve(opts.path)
    : opts.stamp
      ? stampedOutputPath(doc, def.settings?.name, "mermaid", new Date())
      : resolve(doc).replace(/\.dmdf\.json$/i, "") + ".dmd.mmd";
  const text = renderMermaidDecisions(def);
  writeFileSync(out, text, "utf8");
  return {
    content: [
      { type: "text", text: `Rendered decision model '${def.settings?.name ?? ""}' → ${out} (${text.length} bytes)` },
      { type: "text", text },
    ],
  };
}

function decisionNotes(def: DecisionModelDefinition): { target: string | null; notes: string }[] {
  const out: { target: string | null; notes: string }[] = [];
  if (def.settings?.notes?.trim()) out.push({ target: null, notes: def.settings.notes });
  for (const list of [def.inputs ?? [], def.knowledge ?? [], def.decisions ?? []]) {
    for (const item of list) if (item?.notes?.trim()) out.push({ target: item.name, notes: item.notes });
  }
  return out;
}

export function decisionGetNotes(host: DecisionHost): ToolResult {
  const def = readDecisionModel(host.projectFile());
  if (!def) return fail(`No decision model at ${host.projectFile()}.`);
  return ok(formatNotes(def.settings?.name ?? "", host.projectFile(), decisionNotes(def)));
}

/** `target` is the name of an input, a knowledge or a decision. Omitted: the whole model. */
export function decisionSetNotes(host: DecisionHost, target: string | undefined, notes: string): ToolResult {
  const def = active(host);
  if (isRefusal(def)) return def;
  const set = (holder: { notes?: string }): void => {
    if (notes.trim()) holder.notes = notes;
    else delete holder.notes;
  };
  let what = "the decision model";
  if (!target) set(def.settings);
  else {
    const holder =
      (def.decisions ?? []).find((d) => d?.name === target) ??
      (def.inputs ?? []).find((i) => i?.name === target) ??
      (def.knowledge ?? []).find((k) => k?.name === target);
    if (!holder) return fail(`'${target}' is not an input, a knowledge or a decision of '${def.settings?.name ?? ""}'.`);
    set(holder);
    what = `'${target}'`;
  }
  writeDecisionModel(host.projectFile(), def);
  host.emitFull(def);
  return ok(`${notes.trim() ? "Saved" : "Cleared"} the notes on ${what}.`);
}

// ─── The ledger ──────────────────────────────────────────────────────

/** Where a model's ledger is read from: the path given, else its snapshot beside the document, else its ledger. */
function ledgerPath(doc: string, def: DecisionModelDefinition, given?: string): string | null {
  const named = given ?? def.rulings?.snapshot ?? def.rulings?.ledger;
  if (!named) return null;
  const home = named === "~" || named.startsWith("~/") ? join(homedir(), named.slice(1)) : named;
  return isAbsolute(home) ? home : resolve(dirname(doc), home);
}

function readLines(path: string): { lines: unknown[]; unreadable: number[] } {
  const lines: unknown[] = [];
  const unreadable: number[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((raw, i) => {
      if (!raw.trim()) return;
      try {
        lines.push(JSON.parse(raw));
      } catch {
        // Kept in its place so line numbers stay the file's, and counted as neither a run nor a ruling.
        lines.push({ kind: "unreadable" });
        unreadable.push(i + 1);
      }
    });
  return { lines, unreadable };
}

// ─── Tool registration ───────────────────────────────────────────────

const rulingShape = z.object({
  outcome: z.string().describe("What was ruled: one of the person decision's outcomes"),
  by: z.string().describe("Who ruled. A ruling is a person's, never a computed step"),
  words: z.string().optional().describe("Their words, verbatim"),
  at: z.string().optional(),
});

export function registerDecisionTools(server: McpServer, host: DecisionHost): void {
  server.tool(
    "validate_decision_model",
    "Validate the active decision model (.dmdf.json) against rules D001–D007 and D009–D022 (names, requirements, questions and their criteria, tables and their hit policy, the rule language, the failure route, the person's decision, the binding, the bars, the rulings) and list what it holds. An issue marked (warning) is a model the loom reads and draws and does less with: a table written in words only is drawn and not run. Whether the events and entities it names exist is a question about the system: check_system answers it (D008).",
    {},
    async () => {
      const def = active(host);
      if (isRefusal(def)) return def;
      const issues = validateDecisionModel(def);
      const errors = issues.filter((e) => e.severity !== "warning");
      const name = def.settings?.name ?? "";
      const body = summarizeDecisionModel(def) || "(empty)";
      if (errors.length) {
        return fail(`${errors.length} problem(s) in '${name}'${issues.length > errors.length ? `, ${issues.length - errors.length} warning(s)` : ""}:\n${formatIssues(issues)}\n\n${body}`);
      }
      return ok(`Decision model '${name}' ${def.settings?.version ?? ""} is valid${issues.length ? `, with ${issues.length} warning(s):\n${formatIssues(issues)}` : "."}\n${body}`);
    },
  );

  server.tool(
    "decision_request",
    "Build the request the active decision model makes of its decision engine, and send nothing: `state` holds the inputs the questions of one group require, `questions` holds those questions with their type, instructions and criteria. `values` gives each input's value by name. `group` names which request (the model's first when omitted): the questions of one group see the same state and are answered independently, and a question that needs another's answer is a later request whose `values` carry that answer. `rotation` turns the options of each question that rotates (pass the count of earlier runs); `option_order` gives a recorded order per question instead. `model` overrides the document's binding. A table and a person's decision are never in a request.",
    {
      values: z.record(z.string(), z.unknown()).optional(),
      group: z.string().optional(),
      model: z.string().optional(),
      rotation: z.number().int().optional(),
      option_order: z.record(z.string(), z.array(z.string())).optional(),
    },
    async ({ values, group, model, rotation, option_order }) => {
      const def = active(host);
      if (isRefusal(def)) return def;
      try {
        const request = toEngineRequest(def, values ?? {}, { group, model, rotation, optionOrder: option_order });
        const size = JSON.stringify(request).length;
        return {
          content: [
            {
              type: "text" as const,
              text: `Request of '${def.settings?.name ?? ""}' ${def.settings?.version ?? "(no version)"}: ${Object.keys(request.questions).length} question(s), ${size} characters. Nothing was sent.`,
            },
            { type: "text" as const, text: JSON.stringify(request, null, 2) },
          ],
        };
      } catch (e) {
        return fail(message(e));
      }
    },
  );

  server.tool(
    "simulate_decision",
    "Run the active decision model from recorded answers, asking no engine. `answers` gives each question's answer by name, in the engine's own shape: a noul { type: 'noul', noul: 0.74 }, a choice { type: 'choice', choice, confidence, probabilities }, a score { type: 'score', score, confidence, probabilities }. `values` gives the inputs a table reads. `rulings` gives a person's recorded ruling by decision name; without one the person's decision is awaiting_owner, and nothing computed stands in for it. `bars` tries other bar values without changing the document. Returns each decision's result as text, then the same run as JSON: for a table its outcome, the rule that decided it and what each rule read. A question with no answer sends the tables that read it to their failure route.",
    {
      answers: z.record(z.string(), z.unknown()).optional(),
      values: z.record(z.string(), z.unknown()).optional(),
      rulings: z.record(z.string(), rulingShape).optional(),
      bars: z.record(z.string(), z.number()).optional(),
    },
    async ({ answers, values, rulings, bars }) => {
      const def = active(host);
      if (isRefusal(def)) return def;
      const run = evaluateDecisions(def, { answers, values, rulings, bars });
      return {
        content: [
          { type: "text" as const, text: formatDecisionRun(run) },
          { type: "text" as const, text: JSON.stringify(run, null, 2) },
        ],
      };
    },
  );

  server.tool(
    "replay_decision_ledger",
    "Replay the recorded runs of the active decision model's ledger through the model, asking no engine, and say for each whether the tables give the outcome the line recorded, with the rule that decided it and the ruling in force. `ledger` is a .jsonl path (relative to the document, absolute, or under ~); omitted, the document's rulings.snapshot beside it, else its rulings.ledger. A line that lacks what the replay needs is reported as not replayable with the field it lacks, and nothing is put in its place. The count of rulings in force is given against rulings.bar_after, with how many rulings agreed with what they answered. `bars` tries other bar values on the same recorded answers; the document is never changed, and setting a bar stays a person's act. `json: true` adds the whole replay, every run with its rule trace.",
    {
      ledger: z.string().optional(),
      bars: z.record(z.string(), z.number()).optional(),
      json: z.boolean().optional(),
    },
    async ({ ledger, bars, json }) => {
      const def = active(host);
      if (isRefusal(def)) return def;
      const path = ledgerPath(host.projectFile(), def, ledger);
      if (!path) return fail(`'${def.settings?.name ?? ""}' names no ledger (rulings.snapshot or rulings.ledger): pass \`ledger\`.`);
      const denial = host.outsideRoot(path);
      if (denial) return fail(denial);
      if (!existsSync(path)) return fail(`No ledger at ${path}.`);
      let read: { lines: unknown[]; unreadable: number[] };
      try {
        read = readLines(path);
      } catch (e) {
        return fail(`The ledger ${path} cannot be read: ${message(e)}`);
      }
      const replay = replayLedger(def, read.lines, { bars });
      const text =
        `Ledger ${path}\n${formatLedgerReplay(replay)}` +
        (read.unreadable.length ? `\n${read.unreadable.length} line(s) are not JSON and were not read: ${read.unreadable.join(", ")}` : "");
      return {
        content: [
          { type: "text" as const, text },
          ...(json ? [{ type: "text" as const, text: JSON.stringify(replay, null, 2) }] : []),
        ],
        // Trying other bars is a question, and a different outcome is its answer, not a failure.
        ...(replay.different > 0 && !bars ? { isError: true } : {}),
      };
    },
  );
}
