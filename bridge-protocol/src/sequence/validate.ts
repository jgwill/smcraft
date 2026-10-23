/**
 * SQDF validation — rules S001–S006 (Spec 81).
 *
 * The document's own shape only. Whether an event, an object or an entity it
 * names exists is a question about the SYSTEM, answered by `checkSystem`
 * (L005–L008). Every field is read defensively: the document usually arrives
 * from an agent or from disk.
 *
 * Pure — no I/O.
 */
import { SQD_FRAGMENT_KINDS, messageRef, type SequenceDefinition, type SqdMessage } from "./definition.js";
import type { ErdValidationError } from "../erd/validate.js";

export type SqdValidationError = ErdValidationError;

export function validateSequence(def: SequenceDefinition): SqdValidationError[] {
  const errors: SqdValidationError[] = [];

  if (!def?.settings?.name) {
    errors.push({ ruleId: "S001", message: "The sequence has no settings.name", element: "settings" });
  }

  const names = new Set<string>();
  for (const [i, p] of (def.participants ?? []).entries()) {
    if (!p?.name) {
      errors.push({ ruleId: "S002", message: `Participant at index ${i} has no name`, element: `participants[${i}]` });
      continue;
    }
    if (names.has(p.name)) {
      errors.push({ ruleId: "S002", message: `Duplicate participant "${p.name}"`, element: p.name });
    }
    names.add(p.name);
  }

  const checkMessage = (m: SqdMessage | undefined, ref: string): void => {
    if (!m) {
      errors.push({ ruleId: "S003", message: `Message ${ref} is empty`, element: `message:${ref}` });
      return;
    }
    for (const end of ["from", "to"] as const) {
      if (!m[end] || !names.has(m[end])) {
        errors.push({
          ruleId: "S003",
          message: `Message ${ref} ${end === "from" ? "comes from" : "goes to"} "${m[end] ?? ""}", which is not a participant`,
          element: `message:${ref}`,
        });
      }
    }
    if (!m.label?.trim()) {
      errors.push({ ruleId: "S004", message: `Message ${ref} has no label`, element: `message:${ref}` });
    }
  };

  (def.messages ?? []).forEach((m, i) => checkMessage(m, messageRef(null, i)));

  const count = (def.messages ?? []).length;
  for (const [fi, f] of (def.fragments ?? []).entries()) {
    const element = `fragment:${fi + 1}`;
    if (!f || !SQD_FRAGMENT_KINDS.includes(f.kind)) {
      errors.push({
        ruleId: "S005",
        message: `Fragment ${fi + 1} has kind "${f?.kind ?? ""}"; expected one of ${SQD_FRAGMENT_KINDS.join(", ")}`,
        element,
      });
      continue;
    }
    if (!Number.isInteger(f.after) || f.after < 0 || f.after > count) {
      errors.push({
        ruleId: "S005",
        message: `Fragment ${fi + 1} branches after message ${f.after}, but the main sequence has messages 1 to ${count}`,
        element,
      });
    }
    if (!f.messages?.length) {
      errors.push({ ruleId: "S006", message: `Fragment ${fi + 1} (${f.kind}) holds no message`, element });
    }
    (f.messages ?? []).forEach((m, i) => checkMessage(m, messageRef(fi, i)));
  }

  return errors;
}
