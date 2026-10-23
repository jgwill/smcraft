/**
 * Pure, deterministic Mermaid `erDiagram` rendering of an ERDF definition.
 *
 * Relationships first, then one block per entity that has attributes, then a
 * bare line for any entity neither of those mentioned — an entity mermaid never
 * hears about is one it never draws, the same rule the state renderer learned.
 *
 * Mermaid's attribute grammar is `type name [PK|FK|UK[, …]] ["comment"]` and
 * both `type` and `name` must be a single token, so anything else in them
 * (`dict[str, int]`, a space) is folded to `_`. Entity names that are not plain
 * identifiers are quoted. A relationship label is mandatory in the grammar, so
 * a missing one renders as `""`.
 *
 * Pure — no randomness, no clock, no I/O.
 */
import {
  stateOfList,
  type EntityRelationshipDefinition,
  type ErdAttribute,
  type ErdCardinality,
} from "../erd/definition.js";

const CONNECTOR: Record<ErdCardinality, string> = {
  "1:1": "||--||",
  "1:N": "||--o{",
  "N:1": "}o--||",
  "N:M": "}o--o{",
};

const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const entityToken = (name: string): string =>
  PLAIN_NAME.test(name) ? name : `"${name.replace(/"/g, "'")}"`;

const token = (text: string, fallback: string): string => {
  const folded = text.trim().replace(/[^A-Za-z0-9_()[\]-]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Za-z_]/.test(folded) ? folded : folded ? `_${folded}` : fallback;
};

const quoted = (text: string): string => `"${text.replace(/"/g, "'")}"`;

function attributeLine(attr: ErdAttribute): string {
  const keys: string[] = [];
  if (attr.key === "pk") keys.push("PK");
  if (attr.key === "uk") keys.push("UK");
  if (attr.references) keys.push("FK");

  const notes: string[] = [];
  const machines = stateOfList(attr);
  if (machines.length) notes.push(`stateOf ${machines.join(", ")}`);
  if (attr.description) notes.push(attr.description);

  const parts = [token(attr.type ?? "", "unknown"), token(attr.name, "unnamed")];
  if (keys.length) parts.push(keys.join(", "));
  if (notes.length) parts.push(quoted(notes.join(" — ")));
  return parts.join(" ");
}

/** Render `def` as a Mermaid `erDiagram` string. */
export function renderMermaidEr(def: EntityRelationshipDefinition): string {
  const lines: string[] = ["erDiagram"];
  const pad = "    ";
  const mentioned = new Set<string>();

  for (const rel of def.relationships ?? []) {
    if (!rel?.from || !rel?.to) continue;
    const connector = CONNECTOR[rel.cardinality] ?? CONNECTOR["1:N"];
    lines.push(`${pad}${entityToken(rel.from)} ${connector} ${entityToken(rel.to)} : ${quoted(rel.label ?? "")}`);
    mentioned.add(rel.from);
    mentioned.add(rel.to);
  }

  const seen = new Set<string>();
  for (const entity of def.entities ?? []) {
    if (!entity?.name || seen.has(entity.name)) continue;
    seen.add(entity.name);
    const attributes = (entity.attributes ?? []).filter((a) => a?.name);
    if (attributes.length === 0) {
      if (!mentioned.has(entity.name)) lines.push(`${pad}${entityToken(entity.name)}`);
      continue;
    }
    lines.push(`${pad}${entityToken(entity.name)} {`);
    for (const attr of attributes) lines.push(`${pad}${pad}${attributeLine(attr)}`);
    lines.push(`${pad}}`);
  }

  return lines.join("\n");
}
