/**
 * The link between an SMDF document and an ERDF one — rules L001–L004 (Spec 80).
 *
 * SMDF names its data in free strings nothing else reads: the class of each
 * object the context is built with, and the `<instance>.<field>` inside a
 * guard. These checks resolve those names against the entities and attributes
 * an ERDF document declares, so a machine that reads a field the data does not
 * have is reported while it is still a drawing.
 *
 * A guard is free text in whatever language the generated code will be, so
 * only the `<instance>.<field>` shape is read, only for instances declared in
 * `settings.objects[]`, and a method call (`strategy.validate_mpr(...)`) is
 * skipped. A field on an instance whose class is not an entity is not reported
 * twice: L001 already says why it cannot be resolved. An object no guard reads
 * a field of is left alone — it is usually a service, not data.
 *
 * Pure — no I/O.
 */
import type { StateDef, StateMachineDefinition } from "../definition.js";
import { stateOfList, type EntityRelationshipDefinition, type ErdEntity } from "./definition.js";
import type { ErdValidationError } from "./validate.js";

/** Every state, parallel regions included. */
function allStates(root: StateDef): StateDef[] {
  const out = [root];
  for (const child of root.states ?? []) out.push(...allStates(child));
  for (const region of root.parallel?.states ?? []) out.push(...allStates(region));
  return out;
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The `<field>` of each `<instance>.<field>` in `condition` that is not a call. */
export function guardFields(condition: string, instance: string): string[] {
  const re = new RegExp(`(?<![\\w.])${escapeRe(instance)}\\.([A-Za-z_]\\w*)\\b(?!\\s*\\()`, "g");
  const fields: string[] = [];
  for (const match of condition.matchAll(re)) {
    if (!fields.includes(match[1])) fields.push(match[1]);
  }
  return fields;
}

export function checkLinks(
  smdf: StateMachineDefinition,
  erdf: EntityRelationshipDefinition,
): ErdValidationError[] {
  const errors: ErdValidationError[] = [];
  const entities = new Map<string, ErdEntity>();
  for (const e of erdf.entities ?? []) if (e?.name && !entities.has(e.name)) entities.set(e.name, e);

  const machine = smdf.settings?.name ?? "";
  const objects = smdf.settings?.objects ?? [];
  const states = smdf.state ? allStates(smdf.state) : [];
  const conditions = states.flatMap((s) => (s.transitions ?? []).map((t) => t.condition ?? ""));
  const entityOf = new Map<string, ErdEntity>();

  for (const obj of objects) {
    const entity = entities.get(obj.class);
    if (entity) {
      entityOf.set(obj.instance, entity);
      continue;
    }
    // An object is often a service (a broker, a data provider), not data. It is
    // held to being an entity only once a guard reads a field of it.
    if (!conditions.some((c) => guardFields(c, obj.instance).length > 0)) continue;
    errors.push({
      ruleId: "L001",
      message: `Object "${obj.instance}" has class "${obj.class}", which is not an entity in "${erdf.settings?.name ?? ""}", and a guard reads its fields`,
      element: obj.instance,
    });
  }

  for (const state of states) {
    for (const t of state.transitions ?? []) {
      if (!t.condition) continue;
      for (const [instance, entity] of entityOf) {
        for (const field of guardFields(t.condition, instance)) {
          if ((entity.attributes ?? []).some((a) => a?.name === field)) continue;
          errors.push({
            ruleId: "L002",
            message: `Guard on ${state.name} [${t.event}] reads "${instance}.${field}", which is not an attribute of "${entity.name}"`,
            element: state.name,
          });
        }
      }
    }
  }

  if (machine) {
    const objectEntities = new Set([...entityOf.values()].map((e) => e.name));
    for (const entity of erdf.entities ?? []) {
      for (const attr of entity?.attributes ?? []) {
        if (!attr || !stateOfList(attr).includes(machine)) continue;
        if (objectEntities.has(entity.name)) continue;
        errors.push({
          ruleId: "L003",
          message: `"${entity.name}.${attr.name}" stores the state of "${machine}", but "${entity.name}" is not the class of any of that machine's objects`,
          element: `${entity.name}.${attr.name}`,
        });
      }
    }
  }

  return errors;
}

/** L004 — each `stateOf` names one of the machines at hand. */
export function checkStateOf(
  erdf: EntityRelationshipDefinition,
  machineNames: readonly string[],
): ErdValidationError[] {
  const errors: ErdValidationError[] = [];
  for (const entity of erdf.entities ?? []) {
    for (const attr of entity?.attributes ?? []) {
      if (!attr) continue;
      for (const machine of stateOfList(attr)) {
        if (machineNames.includes(machine)) continue;
        errors.push({
          ruleId: "L004",
          message: `"${entity.name}.${attr.name}" stores the state of "${machine}", which is not among the machines checked (${machineNames.join(", ") || "none"})`,
          element: `${entity.name}.${attr.name}`,
        });
      }
    }
  }
  return errors;
}
