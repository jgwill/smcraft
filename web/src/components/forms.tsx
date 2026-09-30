"use client";

/**
 * A small form for the panels of the sequence and system workspaces: text,
 * select and checkbox fields, each with an initial value, and one submit.
 *
 * Used both to add (`reset` clears the text fields after a submit, keeping the
 * selects, as the ERD panel's form does) and to edit (the host keys the form
 * by the element it edits, so a changed element re-seeds it).
 */
import { useState } from "react";

export const panelInput =
  "w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200 placeholder:text-gray-600";
export const panelButton = "rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700";
export const panelHeading = "mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500";

export interface FormField {
  name: string;
  label?: string;
  placeholder?: string;
  /** A select. `""` is shown as `(label)`. */
  options?: readonly string[];
  /** A text field that suggests these (a datalist); any text is still accepted. */
  suggest?: readonly string[];
  checkbox?: boolean;
  initial?: string | boolean;
  /** Takes the whole row. */
  wide?: boolean;
}

export type FormValues = Record<string, string | boolean>;

export function FieldForm({
  id,
  fields,
  submit,
  onSubmit,
  reset = false,
  required,
}: {
  /** Prefix for datalist ids — unique per form on the page. */
  id: string;
  fields: FormField[];
  submit: string;
  onSubmit: (values: FormValues) => void;
  reset?: boolean;
  /** Fields that must not be empty for the submit to go through. */
  required?: string[];
}) {
  const initial = (): FormValues =>
    Object.fromEntries(
      fields.map((f) => [f.name, f.initial ?? (f.checkbox ? false : f.options ? (f.options[0] ?? "") : "")]),
    );
  const [values, setValues] = useState<FormValues>(initial);
  const set = (name: string, value: string | boolean) => setValues((v) => ({ ...v, [name]: value }));
  return (
    <form
      className="mt-1 grid grid-cols-2 gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const merged = { ...initial(), ...values };
        if ((required ?? []).some((n) => !String(merged[n] ?? "").trim())) return;
        onSubmit(merged);
        if (reset) {
          setValues((prev) =>
            Object.fromEntries(
              fields.map((f) => [f.name, f.options || f.checkbox ? (prev[f.name] ?? "") : (f.initial ?? "")]),
            ),
          );
        }
      }}
    >
      {fields.map((f) => {
        const title = f.label ?? f.name;
        if (f.checkbox) {
          return (
            <label key={f.name} className="flex items-center gap-2 text-[11px] text-gray-400">
              <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
              {title}
            </label>
          );
        }
        if (f.options) {
          return (
            <select
              key={f.name}
              className={`${panelInput} ${f.wide ? "col-span-2" : ""}`}
              aria-label={title}
              title={title}
              value={String(values[f.name] ?? "")}
              onChange={(e) => set(f.name, e.target.value)}
            >
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o || `(${title})`}
                </option>
              ))}
            </select>
          );
        }
        const listId = f.suggest?.length ? `${id}-${f.name}` : undefined;
        return (
          <span key={f.name} className={f.wide ? "col-span-2" : ""}>
            <input
              className={panelInput}
              aria-label={title}
              title={title}
              placeholder={f.placeholder ?? title}
              list={listId}
              value={String(values[f.name] ?? "")}
              onChange={(e) => set(f.name, e.target.value)}
            />
            {listId && (
              <datalist id={listId}>
                {f.suggest!.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </span>
        );
      })}
      <button type="submit" className={`${panelButton} col-span-2`}>
        {submit}
      </button>
    </form>
  );
}
