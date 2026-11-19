/**
 * Pure, deterministic Mermaid `flowchart` rendering of a DMDF definition
 * (Spec 85), in the shapes of DMN's decision requirements diagram.
 *
 * Read from the bottom up (`flowchart BT`): what a decision reads is below it.
 *
 * - an input is a stadium;
 * - a decision is a rectangle, with its logic under its name. The three kinds
 *   of logic are told apart by their border as well as their words, never by
 *   colour: a question (a judgment) is dashed, a table (code decides) is plain,
 *   a person's decision is heavy;
 * - a `model` is a subroutine box, a `source` or an `authority` an asymmetric box;
 * - information is a solid arrow, knowledge a dotted arrow, authority a dotted
 *   line ending in a circle;
 * - a group of questions (one request to the engine: the same snapshot,
 *   answered independently) is a box around them. It is never an arrow.
 *
 * Names become identifiers (`i1`, `k1`, `d1`), with the name as the label, so a
 * name with spaces or punctuation never breaks the grammar.
 *
 * Pure — no randomness, no clock, no I/O.
 */
import { requestGroups, safeModel, type DecisionModelDefinition, type DmdDecision } from "../decision/definition.js";

const clean = (text: unknown): string =>
  String(text ?? "")
    .replace(/["`<>{}|\\]/g, "'")
    .replace(/[\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function logicLine(d: DmdDecision): string {
  const logic = d.logic;
  if (logic?.kind === "question") {
    if (logic.type === "choice") return `question · choice: ${clip(Object.keys(logic.options ?? {}).map(clean).join(", "), 60)}`;
    if (logic.type === "score") return `question · score, ${(logic.levels ?? []).length} levels`;
    return `question · ${clean(logic.type)}`;
  }
  if (logic?.kind === "table") {
    const n = (logic.rules ?? []).length;
    return `table · ${clean(logic.hit ?? "no hit policy")} · ${n} rule${n === 1 ? "" : "s"}`;
  }
  if (logic?.kind === "person") return `person · ${clip(clean(logic.who), 60)}`;
  return "no logic";
}

function firesLine(d: DmdDecision): string {
  const events = [...new Set([...Object.values(d.events ?? {}), ...(d.event ? [d.event] : [])].map(clean).filter(Boolean))];
  if (!events.length) return "";
  return `fires ${clip(events.join(", "), 50)}${d.machine ? ` of ${clean(d.machine)}` : ""}`;
}

/** Render `def` as a Mermaid `flowchart BT` string. */
export function renderMermaidDecisions(model: DecisionModelDefinition): string {
  const def = safeModel(model);
  const lines: string[] = ["flowchart BT"];
  const ids = new Map<string, string>();
  const pad = "  ";

  (def.inputs ?? []).filter((i) => i?.name).forEach((input, n) => {
    if (ids.has(input.name)) return;
    const id = `i${n + 1}`;
    ids.set(input.name, id);
    lines.push(`${pad}${id}(["${clean(input.name)}"])`);
  });

  const knowledge = new Map<string, string>();
  (def.knowledge ?? []).filter((k) => k?.name).forEach((k, n) => {
    if (knowledge.has(k.name)) return;
    const id = `k${n + 1}`;
    knowledge.set(k.name, id);
    lines.push(k.kind === "model" ? `${pad}${id}[["${clean(k.name)}"]]` : `${pad}${id}>"${clean(k.name)}${k.kind === "authority" ? "<br/><i>authority</i>" : ""}"]`);
  });

  const decisions = (def.decisions ?? []).filter((d) => d?.name);
  decisions.forEach((d, n) => {
    if (!ids.has(d.name)) ids.set(d.name, `d${n + 1}`);
  });
  const node = (d: DmdDecision, indent: string): string => {
    const fires = firesLine(d);
    const label = [clean(d.name), `<i>${logicLine(d)}</i>`, ...(fires ? [`<i>${fires}</i>`] : [])].join("<br/>");
    const kind = d.logic?.kind === "question" || d.logic?.kind === "person" ? `:::${d.logic.kind}` : "";
    return `${indent}${ids.get(d.name)}["${label}"]${kind}`;
  };

  // Only the groups a document writes are boxed: a box the loom made up would say more than the document does.
  const boxed = new Set<string>();
  requestGroups(def)
    .filter((g) => g.declared && g.questions.length)
    .forEach((g, n) => {
      lines.push(`${pad}subgraph g${n + 1}["${clean(g.name)}: one request"]`);
      for (const q of g.questions) {
        const d = decisions.find((x) => x.name === q);
        if (!d || boxed.has(q)) continue;
        boxed.add(q);
        lines.push(node(d, pad + pad));
      }
      lines.push(`${pad}end`);
    });
  for (const d of decisions) if (!boxed.has(d.name) && ids.get(d.name)?.startsWith("d")) lines.push(node(d, pad));

  for (const d of decisions) {
    const to = ids.get(d.name);
    for (const r of d.requires ?? []) if (ids.has(r)) lines.push(`${pad}${ids.get(r)} --> ${to}`);
  }
  for (const d of decisions) {
    const to = ids.get(d.name);
    for (const k of d.knowledge ?? []) if (knowledge.has(k)) lines.push(`${pad}${knowledge.get(k)} -.-> ${to}`);
  }
  for (const d of decisions) {
    const to = ids.get(d.name);
    for (const a of d.authority ?? []) if (knowledge.has(a)) lines.push(`${pad}${knowledge.get(a)} -.-o ${to}`);
  }

  lines.push(`${pad}classDef question stroke-dasharray: 6 4`);
  lines.push(`${pad}classDef person stroke-width: 3px`);
  return lines.join("\n") + "\n";
}
