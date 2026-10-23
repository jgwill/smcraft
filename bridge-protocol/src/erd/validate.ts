/**
 * ERDF validation — rules E001–E005 (Spec 80).
 *
 * The IDs carry their own prefix so a report is never mistaken for the SMDF
 * `V` rules. The document usually arrives from an agent or from disk, so every
 * field is read defensively: a missing array is an empty one, not a throw.
 *
 * Pure — no I/O.
 */
import {
  ERD_CARDINALITIES,
  parseReference,
  type EntityRelationshipDefinition,
  type ErdEntity,
} from "./definition.js";

export interface ErdValidationError {
  ruleId: string;
  message: string;
  element?: string;
}

function entityMap(def: EntityRelationshipDefinition): Map<string, ErdEntity> {
  const map = new Map<string, ErdEntity>();
  for (const e of def.entities ?? []) if (e?.name && !map.has(e.name)) map.set(e.name, e);
  return map;
}

export function validateErd(def: EntityRelationshipDefinition): ErdValidationError[] {
  const errors: ErdValidationError[] = [];
  const entities = entityMap(def);

  const seenEntities = new Set<string>();
  for (const [i, entity] of (def.entities ?? []).entries()) {
    if (!entity?.name) {
      errors.push({ ruleId: "E001", message: `Entity at index ${i} has no name`, element: `entities[${i}]` });
      continue;
    }
    if (seenEntities.has(entity.name)) {
      errors.push({ ruleId: "E001", message: `Duplicate entity name "${entity.name}"`, element: entity.name });
    }
    seenEntities.add(entity.name);

    const seenAttributes = new Set<string>();
    for (const [j, attr] of (entity.attributes ?? []).entries()) {
      if (!attr?.name) {
        errors.push({
          ruleId: "E002",
          message: `Attribute at index ${j} of "${entity.name}" has no name`,
          element: `${entity.name}[${j}]`,
        });
        continue;
      }
      const element = `${entity.name}.${attr.name}`;
      if (seenAttributes.has(attr.name)) {
        errors.push({ ruleId: "E002", message: `Duplicate attribute "${element}"`, element });
      }
      seenAttributes.add(attr.name);

      if (attr.references) {
        const ref = parseReference(attr.references);
        const target = entities.get(ref.entity);
        if (!target) {
          errors.push({
            ruleId: "E005",
            message: `"${element}" references undefined entity "${ref.entity}"`,
            element,
          });
        } else if (ref.attribute && !(target.attributes ?? []).some((a) => a?.name === ref.attribute)) {
          errors.push({
            ruleId: "E005",
            message: `"${element}" references undefined attribute "${attr.references}"`,
            element,
          });
        }
      }
    }
  }

  for (const [i, rel] of (def.relationships ?? []).entries()) {
    const element = `relationships[${i}]`;
    for (const end of ["from", "to"] as const) {
      const name = rel?.[end];
      if (!name || !entities.has(name)) {
        errors.push({
          ruleId: "E003",
          message: `Relationship ${i} ${end} names undefined entity "${name ?? ""}"`,
          element,
        });
      }
    }
    if (!ERD_CARDINALITIES.includes(rel?.cardinality)) {
      errors.push({
        ruleId: "E004",
        message: `Relationship ${i} cardinality "${rel?.cardinality ?? ""}" is not one of ${ERD_CARDINALITIES.join(", ")}`,
        element,
      });
    }
  }

  return errors;
}
