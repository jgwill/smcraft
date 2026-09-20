/**
 * Pure edits to an ERDF definition — the one vocabulary the MCP tools and the
 * canvas both speak, so an entity added by an agent and one added by a hand on
 * the canvas are the same edit.
 *
 * Every function returns a new definition and leaves its input untouched. An
 * edit that cannot be made (a duplicate name, an entity that is not there)
 * throws an `Error` whose message says what to do instead; callers turn that
 * into a tool error or a toast.
 *
 * Pure — no I/O.
 */
import {
  ERD_CARDINALITIES,
  type EntityRelationshipDefinition,
  type ErdAttribute,
  type ErdEntity,
  type ErdRelationship,
} from "./definition.js";

const clone = (def: EntityRelationshipDefinition): EntityRelationshipDefinition => ({
  settings: { ...def.settings },
  entities: (def.entities ?? []).map((e) => ({ ...e, attributes: (e.attributes ?? []).map((a) => ({ ...a })) })),
  relationships: (def.relationships ?? []).map((r) => ({ ...r })),
});

function entityIn(def: EntityRelationshipDefinition, name: string): ErdEntity {
  const entity = def.entities.find((e) => e.name === name);
  if (!entity) {
    const known = def.entities.map((e) => e.name).join(", ") || "none";
    throw new Error(`Entity '${name}' not found. Entities: ${known}.`);
  }
  return entity;
}

/** Drop the keys whose value is `undefined`, so they never reach the JSON. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function addEntity(def: EntityRelationshipDefinition, entity: ErdEntity): EntityRelationshipDefinition {
  if (!entity.name?.trim()) throw new Error("An entity needs a name.");
  const next = clone(def);
  if (next.entities.some((e) => e.name === entity.name)) throw new Error(`Entity '${entity.name}' already exists.`);
  next.entities.push(compact({ ...entity, attributes: entity.attributes ?? [] }));
  return next;
}

/** Change what an entity says about itself. `undefined` leaves a field alone; `""` / `false` clears it. */
export function updateEntity(
  def: EntityRelationshipDefinition,
  name: string,
  patch: { description?: string; weak?: boolean; notes?: string },
): EntityRelationshipDefinition {
  const next = clone(def);
  const entity = entityIn(next, name);
  if (patch.notes !== undefined) {
    if (patch.notes.trim()) entity.notes = patch.notes;
    else delete entity.notes;
  }
  if (patch.description !== undefined) {
    if (patch.description) entity.description = patch.description;
    else delete entity.description;
  }
  if (patch.weak !== undefined) {
    if (patch.weak) entity.weak = true;
    else delete entity.weak;
  }
  return next;
}

/** Change what the diagram says about itself. `undefined` leaves a field alone; `""` clears it. */
export function updateErdSettings(
  def: EntityRelationshipDefinition,
  patch: { description?: string; notes?: string },
): EntityRelationshipDefinition {
  const next = clone(def);
  for (const key of ["description", "notes"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value.trim()) next.settings[key] = value;
    else delete next.settings[key];
  }
  return next;
}

/** Remove an entity and every relationship that touches it. */
export function removeEntity(def: EntityRelationshipDefinition, name: string): EntityRelationshipDefinition {
  const next = clone(def);
  entityIn(next, name);
  next.entities = next.entities.filter((e) => e.name !== name);
  next.relationships = next.relationships.filter((r) => r.from !== name && r.to !== name);
  return next;
}

export function addAttribute(
  def: EntityRelationshipDefinition,
  entityName: string,
  attribute: ErdAttribute,
): EntityRelationshipDefinition {
  if (!attribute.name?.trim()) throw new Error("An attribute needs a name.");
  const next = clone(def);
  const entity = entityIn(next, entityName);
  entity.attributes ??= [];
  if (entity.attributes.some((a) => a.name === attribute.name)) {
    throw new Error(`Attribute '${entityName}.${attribute.name}' already exists.`);
  }
  entity.attributes.push(compact({ ...attribute }));
  return next;
}

export function removeAttribute(
  def: EntityRelationshipDefinition,
  entityName: string,
  attributeName: string,
): EntityRelationshipDefinition {
  const next = clone(def);
  const entity = entityIn(next, entityName);
  const before = entity.attributes?.length ?? 0;
  entity.attributes = (entity.attributes ?? []).filter((a) => a.name !== attributeName);
  if (entity.attributes.length === before) throw new Error(`Attribute '${entityName}.${attributeName}' not found.`);
  return next;
}

export function addRelationship(
  def: EntityRelationshipDefinition,
  relationship: ErdRelationship,
): EntityRelationshipDefinition {
  const next = clone(def);
  entityIn(next, relationship.from);
  entityIn(next, relationship.to);
  if (!ERD_CARDINALITIES.includes(relationship.cardinality)) {
    throw new Error(`Cardinality '${relationship.cardinality}' is not one of ${ERD_CARDINALITIES.join(", ")}.`);
  }
  next.relationships.push(compact({ ...relationship }));
  return next;
}

/**
 * Remove the relationships between `from` and `to` — only those carrying
 * `label` when one is given. Direction matters: `from` is the entity the
 * relationship was written from.
 */
export function removeRelationship(
  def: EntityRelationshipDefinition,
  from: string,
  to: string,
  label?: string,
): EntityRelationshipDefinition {
  const next = clone(def);
  const before = next.relationships.length;
  next.relationships = next.relationships.filter(
    (r) => !(r.from === from && r.to === to && (label === undefined || r.label === label)),
  );
  if (next.relationships.length === before) {
    throw new Error(`No relationship from '${from}' to '${to}'${label === undefined ? "" : ` labelled '${label}'`}.`);
  }
  return next;
}

/** One line per entity and per relationship — what a tool shows after an edit. */
export function summarizeErd(def: EntityRelationshipDefinition): string {
  const lines: string[] = [];
  for (const e of def.entities ?? []) lines.push(`${e.name} — ${(e.attributes ?? []).length} attribute(s)`);
  for (const r of def.relationships ?? []) {
    lines.push(`${r.from} ${r.cardinality} ${r.to}${r.label ? ` : ${r.label}` : ""}`);
  }
  return lines.join("\n");
}
