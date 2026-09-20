"use client";

/**
 * The designer, when the document is an ERD (`.erdf.json`, Spec 80).
 *
 * It is a separate workspace rather than a mode of the state designer because
 * nothing in `useDesignerStore` applies: no state tree, no events, no PatchOps.
 * What it shares is everything underneath — the same `?doc=` parameter and file
 * API, the same hub room keyed by the resolved path, the same canvas package.
 *
 * Every edit is written to disk and then pushed to the room whole. Disk first,
 * because the agent's MCP tools read the file before each of their own edits:
 * a change that lived only in the browser would be overwritten by the next
 * `add_entity`. The edits are the protocol's pure functions, the same ones the
 * MCP tools call, so a hand and an agent make identical changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EntityRelationshipCanvas } from "@miadi/stateloom-canvas";
import { createBridgeSession, type BridgeSession } from "@miadi/stateloom-react";
import {
  IDENTITY_VIEWPORT,
  ERD_CARDINALITIES,
  addAttribute,
  addEntity,
  addRelationship,
  checkLinks,
  checkStateOf,
  emptyErd,
  erdAutoLayout,
  isErdDefinition,
  removeAttribute,
  removeEntity,
  removeRelationship,
  renderMermaidEr,
  updateEntity,
  validateErd,
  type EntityRelationshipDefinition,
  type ErdCardinality,
  type ErdNotation,
  type ErdValidationError,
  type LayoutBox,
  type StateMachineDefinition,
  type Viewport,
} from "@miadi/stateloom-protocol";
import DocSwitcher from "@/components/DocSwitcher";
import { docQuery, navigateToDoc, useRequestedDoc } from "@/lib/docParam";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";

type Moved = Record<string, { x: number; y: number }>;
type Edit = (def: EntityRelationshipDefinition) => EntityRelationshipDefinition;

// The two notations give an entity different footprints, so each keeps its own
// dragged arrangement. Crow's foot keeps the key it has always had.
const layoutKey = (docPath: string, notation: ErdNotation): string =>
  notation === "chen" ? `stateloom:erd-layout:chen:${docPath}` : `stateloom:erd-layout:${docPath}`;

const NOTATION_KEY = "stateloom:erd-notation";

function readMoved(docPath: string, notation: ErdNotation): Moved {
  try {
    return JSON.parse(localStorage.getItem(layoutKey(docPath, notation)) ?? "{}") as Moved;
  } catch {
    return {};
  }
}

/** The viewer's own preference — kept in this browser, never in the document. */
function readNotation(): ErdNotation {
  try {
    return localStorage.getItem(NOTATION_KEY) === "chen" ? "chen" : "crowsfoot";
  } catch {
    return "crowsfoot";
  }
}

interface Machine {
  path: string;
  def: StateMachineDefinition;
}

/** The state machines in the same directory as `docPath` — the ERD's siblings. */
async function siblingMachines(docPath: string): Promise<Machine[]> {
  const dir = docPath.slice(0, docPath.lastIndexOf("/"));
  const listing = (await (await fetch("/api/docs", { cache: "no-store" })).json()) as { docs?: { path: string }[] };
  const paths = (listing.docs ?? [])
    .map((d) => d.path)
    .filter((p) => p.endsWith(".smdf.json") && p.slice(0, p.lastIndexOf("/")) === dir);
  const machines: Machine[] = [];
  for (const path of paths) {
    try {
      const body = await (await fetch(`/api/file${docQuery(path)}`, { cache: "no-store" })).json();
      const parsed = JSON.parse(body.content ?? "null");
      const def = parsed?.stateMachine ?? parsed?.StateMachine ?? parsed;
      if (def?.state) machines.push({ path, def });
    } catch {
      // An unreadable sibling is skipped; it is not this document's problem.
    }
  }
  return machines;
}

const input =
  "w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200 placeholder:text-gray-600";
const button = "rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700";
const heading = "mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500";

export default function ErdWorkspace() {
  const requested = useRequestedDoc();
  const [docPath, setDocPath] = useState("");
  const [def, setDef] = useState<EntityRelationshipDefinition | null>(null);
  const [moved, setMoved] = useState<Moved>({});
  const [notation, setNotation] = useState<ErdNotation>("crowsfoot");
  const [viewport, setViewport] = useState<Viewport>({ ...IDENTITY_VIEWPORT });
  const [fitKey, setFitKey] = useState(0);
  const [selection, setSelection] = useState<string | null>(null);
  const [status, setStatus] = useState("loading…");
  const [peers, setPeers] = useState(0);
  const [linkReport, setLinkReport] = useState<ErdValidationError[] | null>(null);
  const sessionRef = useRef<BridgeSession | null>(null);

  // Load the document, then join its room.
  useEffect(() => {
    let cancelled = false;
    let session: BridgeSession | null = null;
    (async () => {
      const body = await (await fetch(`/api/file${docQuery(requested)}`, { cache: "no-store" })).json();
      if (cancelled) return;
      if (body.error) return setStatus(body.error);
      const path: string = body.path ?? "";
      let loaded: EntityRelationshipDefinition | null = null;
      try {
        const parsed = body.content ? JSON.parse(body.content) : null;
        if (isErdDefinition(parsed)) loaded = { ...parsed, relationships: parsed.relationships ?? [] };
      } catch {
        // Falls through to the unreadable-document message below.
      }
      if (body.exists && !loaded) return setStatus(`${path} is not a readable ERD definition`);
      const name = (path.split("/").pop() ?? "Untitled").replace(/\.erdf\.json$/i, "");
      const preferred = readNotation();
      setDocPath(path);
      setDef(loaded ?? emptyErd("Default", name));
      setNotation(preferred);
      setMoved(readMoved(path, preferred));
      setSelection(null);
      setLinkReport(null);
      setFitKey((k) => k + 1);
      setStatus(body.exists ? "loaded" : "new document — the first edit writes it");

      const { bridgeUrl } = await loadRuntimeConfig();
      if (cancelled || !bridgeUrl) return;
      session = createBridgeSession({
        url: bridgeUrl,
        role: "web",
        docId: path,
        name: "web-designer",
        onFull: (e) => {
          const incoming: unknown = e.def;
          if (!isErdDefinition(incoming)) return;
          setDef({ ...incoming, relationships: incoming.relationships ?? [] });
          setStatus("updated live");
        },
        // An ERD has no PatchOp vocabulary; anything arriving as a patch is not for this board.
        onPatch: () => {},
        onPresence: (list) => setPeers(list.length),
      });
      sessionRef.current = session;
      session.connect();
    })().catch((e) => !cancelled && setStatus(String(e)));
    return () => {
      cancelled = true;
      sessionRef.current = null;
      session?.disconnect();
    };
  }, [requested]);

  const positions = useMemo<Record<string, LayoutBox>>(() => {
    if (!def) return {};
    const derived = erdAutoLayout(def, { notation });
    for (const [name, at] of Object.entries(moved)) {
      if (derived[name]) derived[name] = { ...derived[name], ...at };
    }
    return derived;
  }, [def, moved, notation]);

  const problems = useMemo(() => (def ? validateErd(def) : []), [def]);
  const errorEntities = useMemo(
    () => problems.map((p) => (p.element ?? "").split(/[.[]/)[0]).filter(Boolean),
    [problems],
  );

  const apply = useCallback(
    async (edit: Edit) => {
      if (!def || !docPath) return;
      let next: EntityRelationshipDefinition;
      try {
        next = edit(def);
      } catch (e) {
        return setStatus(e instanceof Error ? e.message : String(e));
      }
      setDef(next);
      setLinkReport(null);
      try {
        const r = await fetch(`/api/file${docQuery(docPath)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: JSON.stringify(next, null, 2) + "\n" }),
        });
        if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
        sessionRef.current?.emitFull(next as unknown as StateMachineDefinition);
        setStatus("saved");
      } catch (e) {
        setStatus(`not saved: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [def, docPath],
  );

  const moveEntity = useCallback(
    (name: string, box: LayoutBox) => {
      setMoved((prev) => {
        const next = { ...prev, [name]: { x: Math.round(box.x), y: Math.round(box.y) } };
        try {
          localStorage.setItem(layoutKey(docPath, notation), JSON.stringify(next));
        } catch {
          // A full or disabled store costs the arrangement, not the document.
        }
        return next;
      });
    },
    [docPath, notation],
  );

  const chooseNotation = (next: ErdNotation): void => {
    if (next === notation) return;
    try {
      localStorage.setItem(NOTATION_KEY, next);
    } catch {
      // The choice then lasts for this visit only.
    }
    setNotation(next);
    setMoved(readMoved(docPath, next));
    setFitKey((k) => k + 1);
  };

  const arrange = (): void => {
    setMoved({});
    try {
      localStorage.removeItem(layoutKey(docPath, notation));
    } catch {
      /* as above */
    }
    setFitKey((k) => k + 1);
  };

  const runLinkCheck = async (): Promise<void> => {
    if (!def) return;
    setStatus("checking links…");
    const machines = await siblingMachines(docPath);
    if (machines.length === 0) {
      setLinkReport([]);
      return setStatus("no .smdf.json beside this document to check against");
    }
    const found = machines.flatMap((m) =>
      checkLinks(m.def, def).map((e) => ({ ...e, message: `${m.def.settings?.name ?? m.path}: ${e.message}` })),
    );
    found.push(...checkStateOf(def, machines.map((m) => m.def.settings?.name ?? "")));
    setLinkReport(found);
    setStatus(`checked ${machines.length} machine(s): ${found.length} problem(s)`);
  };

  const openMachine = async (machine: string): Promise<void> => {
    const hit = (await siblingMachines(docPath)).find((m) => m.def.settings?.name === machine);
    if (hit) navigateToDoc(hit.path);
    else setStatus(`no .smdf.json beside this document defines '${machine}'`);
  };

  const selected = def?.entities.find((e) => e.name === selection) ?? null;
  const fileName = docPath.split("/").pop() || "…";

  return (
    <div className="app-shell flex flex-col overflow-hidden bg-gray-950 text-gray-200">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-800 bg-gray-900 px-3 py-2 text-xs">
        <span className="font-semibold text-blue-300">ERD</span>
        <DocSwitcher />
        <span className="text-gray-400" title={docPath}>
          {def?.settings.name ?? ""} · {fileName}
        </span>
        <span className="ml-auto text-gray-500">
          {status}
          {peers > 1 ? ` · ${peers} in the room` : ""}
        </span>
        {/* Same document, two drawings. The choice is this browser's; it is never written to the file. */}
        <span className="inline-flex overflow-hidden rounded border border-gray-700" role="group" aria-label="Notation">
          {(
            [
              ["crowsfoot", "▤", "Crow's foot — attributes listed inside the entity box"],
              ["chen", "◇", "Chen — attributes as ovals, relationships as diamonds"],
            ] as const
          ).map(([id, glyph, title]) => (
            <button
              key={id}
              title={title}
              aria-label={title}
              aria-pressed={notation === id}
              onClick={() => chooseNotation(id)}
              className={`px-2 py-1 text-sm leading-none ${
                notation === id ? "bg-blue-900/60 text-blue-200" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {glyph}
            </button>
          ))}
        </span>
        <button className={button} onClick={arrange} title="Forget the dragged positions and lay the board out again">
          ⤢ Arrange
        </button>
        <button className={button} onClick={() => setFitKey((k) => k + 1)}>
          Fit
        </button>
        <button className={button} onClick={runLinkCheck} title="Check the state machines beside this document against it">
          Check links
        </button>
        <button
          className={button}
          onClick={() => def && navigator.clipboard?.writeText(renderMermaidEr(def)).then(() => setStatus("mermaid copied"))}
        >
          Copy mermaid
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-[45dvh] flex-1 overflow-hidden">
          {def && (
            <EntityRelationshipCanvas
              definition={def}
              notation={notation}
              positions={positions}
              viewport={viewport}
              onViewportChange={setViewport}
              selection={selection}
              errorElements={errorEntities}
              fitKey={fitKey}
              onSelect={setSelection}
              onClearSelection={() => setSelection(null)}
              onEntityMove={moveEntity}
              onOpenMachine={openMachine}
              emptyHint="No entities yet — add one in the panel, or let an agent call add_entity."
            />
          )}
        </div>

        {def && (
          <aside className="touch-targets w-full overflow-y-auto border-t border-gray-800 bg-gray-900 p-3 md:w-80 md:border-l md:border-t-0">
            <div className={heading} style={{ marginTop: 0 }}>
              Entities
            </div>
            <div className="flex flex-wrap gap-1">
              {def.entities.map((e) => (
                <button
                  key={e.name}
                  className={`${button} ${selection === e.name ? "border-blue-500 text-blue-300" : ""}`}
                  onClick={() => setSelection(e.name)}
                >
                  {e.name}
                </button>
              ))}
            </div>
            <InlineForm
              fields={[{ name: "name", placeholder: "new entity" }]}
              submit="＋ Entity"
              onSubmit={(v) => {
                apply((d) => addEntity(d, { name: v.name.trim() }));
                setSelection(v.name.trim());
              }}
            />

            {selected && (
              <>
                <div className={heading}>{selected.name}</div>
                <label
                  className="mb-1 flex items-center gap-2 text-[11px] text-gray-400"
                  title="Exists only through another entity (an order line, without its order). Chen draws it as a double rectangle."
                >
                  <input
                    type="checkbox"
                    checked={!!selected.weak}
                    onChange={(e) => apply((d) => updateEntity(d, selected.name, { weak: e.target.checked }))}
                  />
                  weak entity
                </label>
                {(selected.attributes ?? []).map((a) => (
                  <div key={a.name} className="flex items-center justify-between gap-2 py-0.5 font-mono text-[11px]">
                    <span className={a.stateOf ? "text-blue-300" : "text-gray-300"}>
                      {a.name} : {a.type}
                      <span className="text-gray-500">
                        {a.key ? ` ${a.key.toUpperCase()}` : ""}
                        {a.references ? ` → ${a.references}` : ""}
                        {a.stateOf ? ` ◉ ${[a.stateOf].flat().join(", ")}` : ""}
                      </span>
                    </span>
                    <button
                      className="text-gray-500 hover:text-red-400"
                      aria-label={`Remove ${a.name}`}
                      onClick={() => apply((d) => removeAttribute(d, selected.name, a.name))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <InlineForm
                  fields={[
                    { name: "name", placeholder: "attribute" },
                    { name: "type", placeholder: "type", initial: "string" },
                    { name: "key", options: ["", "pk", "uk"] },
                    { name: "references", placeholder: "references Entity.attr" },
                    { name: "stateOf", placeholder: "stateOf Machine" },
                  ]}
                  submit="＋ Attribute"
                  onSubmit={(v) =>
                    apply((d) =>
                      addAttribute(d, selected.name, {
                        name: v.name.trim(),
                        type: v.type.trim() || "string",
                        key: v.key === "pk" || v.key === "uk" ? v.key : undefined,
                        references: v.references.trim() || undefined,
                        stateOf: v.stateOf.trim() || undefined,
                      }),
                    )
                  }
                />
                <button
                  className={`${button} mt-2 text-red-300`}
                  onClick={() => {
                    apply((d) => removeEntity(d, selected.name));
                    setSelection(null);
                  }}
                >
                  🗑 Delete {selected.name}
                </button>
              </>
            )}

            <div className={heading}>Relationships</div>
            {def.relationships.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-0.5 text-[11px] text-gray-300">
                <span>
                  {r.from} <span className="text-gray-500">{r.cardinality}</span> {r.to}
                  {r.label ? <span className="text-gray-500"> : {r.label}</span> : null}
                </span>
                <button
                  className="text-gray-500 hover:text-red-400"
                  aria-label="Remove relationship"
                  onClick={() => apply((d) => removeRelationship(d, r.from, r.to, r.label))}
                >
                  ✕
                </button>
              </div>
            ))}
            {def.entities.length > 0 && (
              <InlineForm
                fields={[
                  { name: "from", options: def.entities.map((e) => e.name) },
                  { name: "cardinality", options: [...ERD_CARDINALITIES], initial: "1:N" },
                  { name: "to", options: def.entities.map((e) => e.name) },
                  { name: "label", placeholder: "label (a verb)" },
                ]}
                submit="＋ Relationship"
                onSubmit={(v) =>
                  apply((d) =>
                    addRelationship(d, {
                      from: v.from,
                      to: v.to,
                      cardinality: v.cardinality as ErdCardinality,
                      label: v.label.trim() || undefined,
                    }),
                  )
                }
              />
            )}

            {(problems.length > 0 || linkReport) && <div className={heading}>Problems</div>}
            {problems.map((p, i) => (
              <div key={`p${i}`} className="py-0.5 text-[11px] text-red-300">
                [{p.ruleId}] {p.message}
              </div>
            ))}
            {linkReport?.length === 0 && problems.length === 0 && (
              <div className="py-0.5 text-[11px] text-green-400">Every name the machines use resolves.</div>
            )}
            {linkReport?.map((p, i) => (
              <div key={`l${i}`} className="py-0.5 text-[11px] text-amber-300">
                [{p.ruleId}] {p.message}
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

interface Field {
  name: string;
  placeholder?: string;
  options?: string[];
  initial?: string;
}

/** A row of inputs and one submit. Clears its text fields after a submit; keeps the selects. */
function InlineForm({
  fields,
  submit,
  onSubmit,
}: {
  fields: Field[];
  submit: string;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const initial = (): Record<string, string> =>
    Object.fromEntries(fields.map((f) => [f.name, f.initial ?? f.options?.[0] ?? ""]));
  const [values, setValues] = useState(initial);
  const first = fields[0];
  return (
    <form
      className="mt-1 grid grid-cols-2 gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const merged = { ...initial(), ...values };
        if (!merged[first.name]?.trim()) return;
        onSubmit(merged);
        setValues((prev) =>
          Object.fromEntries(fields.map((f) => [f.name, f.options ? (prev[f.name] ?? "") : (f.initial ?? "")])),
        );
      }}
    >
      {fields.map((f) =>
        f.options ? (
          <select
            key={f.name}
            className={input}
            aria-label={f.name}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          >
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o || `(${f.name})`}
              </option>
            ))}
          </select>
        ) : (
          <input
            key={f.name}
            className={input}
            aria-label={f.name}
            placeholder={f.placeholder}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        ),
      )}
      <button type="submit" className={`${button} col-span-2`}>
        {submit}
      </button>
    </form>
  );
}
