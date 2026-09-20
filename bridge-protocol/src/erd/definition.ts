/**
 * ERDF — the Entity-Relationship Definition Format (Spec 80).
 *
 * The sibling of SMDF: where a `.smdf.json` describes one behaviour, a
 * `.erdf.json` describes the data every behaviour acts on. It is a separate
 * document on purpose — an entity is shared by each machine that touches it,
 * so writing it inside one of them would mean writing it again in the next.
 *
 * The link to SMDF is by name only (see `links.ts`); neither document holds a
 * path to the other.
 */

export interface ErdSettings {
  namespace: string;
  name: string;
  description?: string;
}

/** Primary or unique. A foreign key is stated by `references`, so one attribute can be both. */
export type ErdKey = "pk" | "uk";

export interface ErdAttribute {
  name: string;
  /** Free string, as SMDF's `ParameterDef.type` is. */
  type: string;
  key?: ErdKey;
  /** `"Entity"` or `"Entity.attribute"` — makes this attribute a foreign key. */
  references?: string;
  nullable?: boolean;
  /**
   * `settings.name` of the SMDF machine whose current state this attribute
   * stores. A list when one column serves several machines — a `state` column
   * read by whichever strategy type the row carries.
   */
  stateOf?: string | string[];
  description?: string;
}

/** The machines an attribute stores the state of, always as a list. */
export function stateOfList(attribute: ErdAttribute): string[] {
  if (!attribute.stateOf) return [];
  return Array.isArray(attribute.stateOf) ? attribute.stateOf : [attribute.stateOf];
}

export interface ErdEntity {
  name: string;
  description?: string;
  attributes?: ErdAttribute[];
}

/** Read left to right: one `from` has many `to` is `1:N`. */
export type ErdCardinality = "1:1" | "1:N" | "N:1" | "N:M";

export const ERD_CARDINALITIES: readonly ErdCardinality[] = ["1:1", "1:N", "N:1", "N:M"];

export interface ErdRelationship {
  from: string;
  to: string;
  cardinality: ErdCardinality;
  label?: string;
  description?: string;
}

export interface EntityRelationshipDefinition {
  settings: ErdSettings;
  entities: ErdEntity[];
  relationships: ErdRelationship[];
}

/** The canonical extension; tools pick the document type from it. */
export const ERDF_EXTENSION = ".erdf.json";

export function isErdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(ERDF_EXTENSION);
}

/**
 * Tell an ERDF document from an SMDF one when only content is at hand: an ERDF
 * carries `entities` and never a `state` tree.
 */
export function isErdDefinition(doc: unknown): doc is EntityRelationshipDefinition {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as Record<string, unknown>;
  return Array.isArray(d.entities) && !("state" in d);
}

export function emptyErd(namespace: string, name: string, description?: string): EntityRelationshipDefinition {
  return {
    settings: description ? { namespace, name, description } : { namespace, name },
    entities: [],
    relationships: [],
  };
}

/** Split `"Entity.attribute"` (or a bare `"Entity"`) into its parts. */
export function parseReference(references: string): { entity: string; attribute?: string } {
  const dot = references.indexOf(".");
  if (dot < 0) return { entity: references };
  return { entity: references.slice(0, dot), attribute: references.slice(dot + 1) };
}
