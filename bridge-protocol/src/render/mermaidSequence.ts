/**
 * Pure, deterministic Mermaid `sequenceDiagram` rendering of an SQDF definition.
 *
 * A participant that names an actor is declared `actor`, every other one
 * `participant`, in document order. Participant names become identifiers
 * (`p1`, `p2`, …) with the name as alias, so a name with spaces or punctuation
 * never breaks the grammar. A message that fires an event shows it after the
 * label (`authorizes · Authorize`); an optional message is wrapped in its own
 * `opt`; a reply is drawn dashed.
 *
 * Fragments are drawn where they branch: an `alt` fragment after main message N
 * becomes an `alt` block right after message N whose `else` holds the main
 * messages it replaces, so the reader sees both paths from the branch point on.
 * `opt` and `loop` fragments sit at their branch point and the main messages
 * continue after them.
 *
 * Pure — no randomness, no clock, no I/O.
 */
import type { SequenceDefinition, SqdFragment, SqdMessage } from "../sequence/definition.js";

const clean = (text: string): string => text.replace(/[;#\n\r]+/g, " ").replace(/\s+/g, " ").trim();

export function renderMermaidSequence(def: SequenceDefinition): string {
  const lines: string[] = ["sequenceDiagram"];
  const ids = new Map<string, string>();
  (def.participants ?? []).forEach((p, i) => {
    const id = `p${i + 1}`;
    ids.set(p.name, id);
    lines.push(`  ${p.actor ? "actor" : "participant"} ${id} as ${clean(p.name)}`);
  });
  const idOf = (name: string): string => ids.get(name) ?? clean(name).replace(/\W+/g, "_");

  const messageLine = (m: SqdMessage, n: string, indent: string): string[] => {
    const arrow = m.reply ? "-->>" : "->>";
    const text = [`${n} ${clean(m.label ?? "")}`, m.event ? clean(m.event) : ""].filter(Boolean).join(" · ");
    const line = `${indent}${idOf(m.from)}${arrow}${idOf(m.to)}: ${text}`;
    return m.optional ? [`${indent}opt optional`, `  ${line}`, `${indent}end`] : [line];
  };

  const main = def.messages ?? [];
  const fragments = def.fragments ?? [];
  const at = (after: number): SqdFragment[] => fragments.filter((f) => f?.after === after);
  const block = (f: SqdFragment, indent: string): void =>
    (f.messages ?? []).forEach((m, k) => lines.push(...messageLine(m, `f${fragments.indexOf(f) + 1}.${k + 1}`, indent + "  ")));

  // Walk the main messages. At each branch point, `opt` and `loop` fragments are
  // drawn in place; every `alt` there becomes one block — each alternative an
  // operand, and `else as written` holding the main path from that point on,
  // which is walked the same way (a later branch point nests inside it).
  const emit = (from: number, indent: string, skipFragmentsAt: number | null): void => {
    for (let i = from; i <= main.length; i++) {
      const here = i === skipFragmentsAt ? [] : at(i);
      for (const f of here.filter((x) => x.kind !== "alt")) {
        lines.push(`${indent}${f.kind} ${clean(f.label ?? "")}`);
        block(f, indent);
        lines.push(`${indent}end`);
      }
      const alts = here.filter((x) => x.kind === "alt");
      if (alts.length) {
        alts.forEach((f, k) => {
          lines.push(`${indent}${k === 0 ? "alt" : "else"} ${clean(f.label ?? "")}`);
          block(f, indent);
        });
        if (i < main.length) {
          lines.push(`${indent}else as written`);
          emit(i, indent + "  ", i);
        }
        lines.push(`${indent}end`);
        return;
      }
      if (i < main.length) lines.push(...messageLine(main[i], String(i + 1), indent));
    }
  };

  emit(0, "  ", null);
  return lines.join("\n") + "\n";
}
