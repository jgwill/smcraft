"use client";

/**
 * The designer, when the document is a sequence (`.sqdf.json`, Spec 81).
 *
 * Built as ErdWorkspace is: the document comes through the file API, the hub
 * room is keyed by its resolved path, every edit is one of the protocol's pure
 * functions (the same ones the MCP tools call), written to disk first and then
 * pushed to the room whole. The layout is the same too — one header row, view
 * controls on the board, the panel a bottom sheet behind a dock on a phone and
 * a right column on a desktop.
 *
 * Inside a system (`?system=` in the URL), the Issues tab adds the system's
 * findings for this scenario — the names it uses that no member defines, and
 * the replay of each path against the machines — and the fields that name an
 * event, a state or an entity suggest the ones the members define. When the
 * system's reconcile mode is `auto`, each saved edit also writes the changes
 * the scenario implies into the machines and the data.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SequenceCanvas, drawableSequence, type SequenceSelection } from "@miadi/stateloom-canvas";
import BoardBoundary from "@/components/BoardBoundary";
import { createBridgeSession, type BridgeSession } from "@miadi/stateloom-react";
import {
  IDENTITY_VIEWPORT,
  SQD_FRAGMENT_KINDS,
  addFragment,
  addFragmentMessage,
  addMessage,
  addParticipant,
  allMessages,
  moveParticipant,
  renameParticipant,
  checkSystem,
  clampScale,
  emptySequence,
  fitToBoxes,
  isSequenceDefinition,
  moveMessage,
  parseFocus,
  parseMessageRef,
  reconcileModeOf,
  removeFragment,
  removeMessage,
  removeParticipant,
  renderMermaidSequence,
  sequenceLayout,
  summarizeReconcile,
  updateFragment,
  updateMessage,
  updateParticipant,
  updateSqdSettings,
  validateSequence,
  zoomAt,
  type SequenceDefinition,
  type SqdFragmentKind,
  type SqdValidationError,
  type SqdMessage,
  type StateMachineDefinition,
  type Viewport,
} from "@miadi/stateloom-protocol";
import DocSwitcher from "@/components/DocSwitcher";
import IssueIcon from "@/components/IssueIcon";
import { NotesField } from "@/components/erd/ErdWorkspace";
import { FieldForm, panelButton as button, panelHeading as heading, type FormValues } from "@/components/forms";
import KindIcon from "@/components/system/KindIcon";
import { docQuery, useRequestedDoc } from "@/lib/docParam";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";
import { useSheetDrag } from "@/lib/useSheetDrag";
import { safely } from "@/lib/safely";
import { stripNote, useFocusRequest, useUrlParam, writeFocus } from "@/lib/systemParam";
import { memberOfDoc, notifySystemChanged, reconcileNow, systemVocabulary, useSystem } from "@/lib/systemLoad";

type Tab = "participants" | "messages" | "notes" | "issues";
type Edit = (def: SequenceDefinition) => SequenceDefinition;

const KINDS = ["", "actor", "service", "object"] as const;

const str = (v: string | boolean | undefined): string => (typeof v === "string" ? v.trim() : "");
const list = (v: string | boolean | undefined): string[] =>
  str(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** A message as the form hands it back: empty strings clear a field, `false` clears a flag. */
function messageFrom(v: FormValues): SqdMessage {
  return {
    from: str(v.from),
    to: str(v.to),
    label: str(v.label),
    event: str(v.event),
    machine: str(v.machine),
    carries: str(v.carries),
    state: str(v.state),
    description: str(v.description),
    optional: v.optional ? true : undefined,
    reply: v.reply ? true : undefined,
  } as SqdMessage;
}

export default function SequenceWorkspace() {
  const requested = useRequestedDoc();
  const systemPath = useUrlParam("system");
  const { system } = useSystem(systemPath);
  const focusRequest = useFocusRequest();
  const [docPath, setDocPath] = useState("");
  const [def, setDef] = useState<SequenceDefinition | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ ...IDENTITY_VIEWPORT });
  const [fitKey, setFitKey] = useState<number | undefined>(undefined);
  const [selection, setSelection] = useState<SequenceSelection | null>(null);
  const [status, setStatusState] = useState<{ text: string; tone: "ok" | "warn" }>({ text: "loading…", tone: "ok" });
  const setStatus = useCallback((text: string, tone: "ok" | "warn" = "ok") => setStatusState({ text, tone }), []);
  const [statusQuiet, setStatusQuiet] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStatusQuiet(true), 4000);
    return () => {
      clearTimeout(timer);
      setStatusQuiet(false);
    };
  }, [status]);
  const [tab, setTab] = useState<Tab>("messages");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const sheet = useSheetDrag({ onClose: () => setSheetOpen(false), restVh: 62, tallVh: 92 });
  const [peers, setPeers] = useState(0);
  const sessionRef = useRef<BridgeSession | null>(null);
  const firstView = useRef(true);
  const appliedNonce = useRef(-1);

  // Load the document, then join its room.
  useEffect(() => {
    let cancelled = false;
    let session: BridgeSession | null = null;
    (async () => {
      const body = await (await fetch(`/api/file${docQuery(requested)}`, { cache: "no-store" })).json();
      if (cancelled) return;
      if (body.error) return setStatus(body.error, "warn");
      const path: string = body.path ?? "";
      let loaded: SequenceDefinition | null = null;
      try {
        const parsed = body.content ? JSON.parse(body.content) : null;
        if (isSequenceDefinition(parsed)) loaded = parsed;
      } catch {
        // Falls through to the message below.
      }
      if (body.exists && !loaded) return setStatus(`${path} is not a readable sequence definition`, "warn");
      const name = (path.split("/").pop() ?? "Untitled").replace(/\.sqdf\.json$/i, "");
      setDocPath(path);
      setDef(loaded ?? emptySequence("Default", name));
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
          if (!isSequenceDefinition(incoming)) return;
          setDef(incoming);
          setStatus("updated live");
        },
        // A sequence has no PatchOp vocabulary.
        onPatch: () => {},
        onPresence: (list) => setPeers(list.length),
      });
      sessionRef.current = session;
      session.connect();
    })().catch((e) => !cancelled && setStatus(String(e), "warn"));
    return () => {
      cancelled = true;
      sessionRef.current = null;
      session?.disconnect();
    };
  }, [requested, setStatus]);

  // What is drawn and listed: the document read defensively (a malformed file
  // shows what it can). Edits still go through the protocol on `def` itself.
  const view = useMemo(() => (def ? drawableSequence(def) : null), [def]);
  const layout = useMemo(() => (view ? sequenceLayout(view) : null), [view]);
  // A malformed document is reported as one issue, not a crash.
  const problems = useMemo<SqdValidationError[]>(() => {
    if (!def) return [];
    let failure = "";
    const found = safely<SqdValidationError[] | null>(() => validateSequence(def), null, (m) => (failure = m));
    return found ?? [{ ruleId: "S000", message: `The document could not be checked (${failure}): a field is not the shape Spec 81 gives it` }];
  }, [def]);

  // The system, when this sequence is read as one of its members. The check
  // runs on the definition in hand, so it follows an edit before the reload.
  const member = memberOfDoc(system, docPath);
  const systemCheck = useMemo(() => {
    if (!system?.def || !member || !def) return null;
    return safely(
      () => checkSystem(system.def, system.members.map((m) => (m.path === member ? { ...m, def, error: undefined } : m))),
      null,
    );
  }, [system, member, def]);
  const memberIssues = useMemo(
    () => (systemCheck?.issues ?? []).filter((i) => i.member === member && !/^S0/.test(i.ruleId)),
    [systemCheck, member],
  );
  const replay = systemCheck?.replays.find((r) => r.member === member)?.report ?? null;
  const vocabulary = useMemo(() => systemVocabulary(system), [system]);

  // What the canvas outlines: checks name messages and participants as focus
  // strings, except a duplicate participant, which S002 names bare.
  const errorElements = useMemo(() => {
    const asFocus = (e: string | undefined): string =>
      !e ? "" : /^(message|participant):/.test(e) ? e : view?.participants.some((p) => p.name === e) ? `participant:${e}` : "";
    return [
      ...problems.map((p) => asFocus(p.element)),
      ...memberIssues.filter((i) => i.severity === "error").map((i) => asFocus(i.element)),
    ].filter(Boolean);
  }, [problems, memberIssues, view]);
  const warningElements = useMemo(
    () => memberIssues.filter((i) => i.severity === "warning").map((i) => i.element ?? ""),
    [memberIssues],
  );

  const boardSize = (): { width: number; height: number } => {
    const rect = boardRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  };

  /** Centre an area of the drawing at a size its words can be read at. */
  const centreOn = useCallback(
    (box: { x: number; y: number; width: number; height: number }) => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect?.width) return;
      const fit = fitToBoxes([box], rect.width, rect.height, { padding: 24, maxScale: 1.1 }).scale;
      const scale = clampScale(Math.max(fit, 0.7));
      setViewport({
        scale,
        x: rect.width / 2 - (box.x + box.width / 2) * scale,
        y: rect.height / 2 - (box.y + box.height / 2) * scale,
      });
    },
    [],
  );

  const showSelection = useCallback(
    (target: SequenceSelection) => {
      if (!layout) return;
      if (target.kind === "message") {
        const row = layout.rows.find((r) => r.ref === target.id);
        if (!row) return;
        const left = row.self ? row.fromX : Math.min(row.fromX, row.toX);
        const width = row.self ? 220 : Math.abs(row.toX - row.fromX);
        centreOn({ x: left - 10, y: row.y - 24, width: width + 20, height: 40 });
      } else {
        const p = layout.participants.find((b) => b.name === target.id);
        if (p) centreOn({ x: p.left - 20, y: p.top, width: p.width + 40, height: Math.min(260, layout.height - p.top) });
      }
    },
    [layout, centreOn],
  );

  const select = useCallback((target: SequenceSelection | null) => {
    setSelection(target);
    if (target) writeFocus(`${target.kind}:${target.id}`);
  }, []);

  // A focus from the URL, the strip or an agent: select it and bring it to the middle.
  useEffect(() => {
    if (!def || !layout || appliedNonce.current === focusRequest.nonce) return;
    appliedNonce.current = focusRequest.nonce;
    const f = focusRequest.focus ? parseFocus(focusRequest.focus) : null;
    if (!f) return;
    let target: SequenceSelection | null = null;
    if (f.kind === "message" && parseMessageRef(view ?? def, f.name)) target = { kind: "message", id: f.name };
    if (f.kind === "participant" && (view ?? def).participants.some((p) => p.name === f.name)) target = { kind: "participant", id: f.name };
    if (!target) return setStatus(`${focusRequest.focus} is not in this sequence`, "warn");
    firstView.current = false;
    setSelection(target);
    showSelection(target);
  }, [def, view, layout, focusRequest, showSelection, setStatus]);

  // The first view: the whole drawing when it can be read that way, else its
  // top-left corner at a readable size (a phone showing seven lifelines at a
  // quarter of their size shows nothing).
  useEffect(() => {
    if (!layout || !firstView.current) return;
    const { width, height } = boardSize();
    if (!width) return;
    firstView.current = false;
    const fit = Math.min((width - 32) / layout.width, (height - 32) / layout.height);
    if (fit >= 0.5 || layout.participants.length === 0) setFitKey((k) => (k ?? 0) + 1);
    else setViewport({ x: 8, y: 8, scale: 0.6 });
  }, [layout]);

  const apply = useCallback(
    async (edit: Edit) => {
      if (!def || !docPath) return;
      let next: SequenceDefinition;
      try {
        next = edit(def);
      } catch (e) {
        return setStatus(e instanceof Error ? e.message : String(e), "warn");
      }
      setDef(next);
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
        return setStatus(`not saved: ${e instanceof Error ? e.message : String(e)}`, "warn");
      }
      if (!system?.def || !member) return;
      // Inside a system in `auto` mode, what the scenario now implies is written
      // into the machines and the data straight away.
      // It reads every member fresh from disk first, and builds on an agent's
      // concurrent edit rather than writing over it.
      if (reconcileModeOf(system.def) === "auto") {
        const { result, failed, conflicts } = await reconcileNow(system.path);
        if (result && result.count > 0) {
          stripNote(
            failed.length
              ? `auto: not written — ${failed[0]}`
              : conflicts.length
                ? `auto: ${conflicts.join(", ")} kept changing on disk; not written — save again`
                : summarizeReconcile(result, "auto"),
          );
          return;
        }
      }
      notifySystemChanged();
    },
    [def, docPath, setStatus, system, member],
  );

  const zoomBy = (factor: number): void => {
    const { width, height } = boardSize();
    setViewport((vp) => zoomAt(vp, factor, { x: width / 2, y: height / 2 }));
  };

  const openTab = (next: Tab): void => {
    if (sheetOpen && tab === next) sheet.close();
    else setSheetOpen(true);
    setTab(next);
  };

  const copyMermaid = (): void => {
    if (def) navigator.clipboard?.writeText(renderMermaidSequence(def)).then(() => setStatus("mermaid copied"));
  };

  /** Select an element named by a check, and show it. */
  const goTo = (element: string | undefined): void => {
    const f = element ? parseFocus(element) : null;
    if (!f || (f.kind !== "message" && f.kind !== "participant")) return;
    const target: SequenceSelection = { kind: f.kind, id: f.name };
    select(target);
    showSelection(target);
    sheet.close();
  };

  const sd = view ?? emptySequence("", "");
  const messages = allMessages(sd);
  const selectedMessage =
    def && selection?.kind === "message" ? parseMessageRef(sd, selection.id) : null;
  const selectedParticipant =
    def && selection?.kind === "participant" ? sd.participants.find((p) => p.name === selection.id) ?? null : null;
  const names = sd.participants.map((p) => p.name);
  const fileName = docPath.split("/").pop() || "…";
  const problemCount = problems.length + memberIssues.filter((i) => i.severity === "error").length;
  const warningCount = memberIssues.filter((i) => i.severity === "warning").length;
  const tabs: { id: Tab; label: string; icon: ReactNode; badge?: number }[] = [
    { id: "participants", label: "Participants", icon: <KindIcon kind="actor" /> },
    { id: "messages", label: "Messages", icon: <KindIcon kind="sequence" /> },
    { id: "notes", label: "Notes", icon: "✎" },
    { id: "issues", label: "Issues", icon: <IssueIcon />, badge: problemCount + warningCount || undefined },
  ];
  const messageFields = (m?: SqdMessage) => [
    { name: "from", label: "from", options: names, initial: m?.from ?? names[0] ?? "" },
    { name: "to", label: "to", options: names, initial: m?.to ?? names[1] ?? names[0] ?? "" },
    { name: "label", label: "label", placeholder: "what is said or done", initial: m?.label ?? "", wide: true },
    { name: "event", label: "event it fires", suggest: vocabulary.events, initial: m?.event ?? "" },
    { name: "state", label: "state after", suggest: vocabulary.states, initial: m?.state ?? "" },
    { name: "carries", label: "entity it carries", suggest: vocabulary.entities, initial: m?.carries ?? "" },
    { name: "machine", label: "machine", suggest: vocabulary.machines, initial: m?.machine ?? "" },
    { name: "optional", label: "optional", checkbox: true, initial: !!m?.optional },
    { name: "reply", label: "reply (dashed)", checkbox: true, initial: !!m?.reply },
  ];
  const participantKind = (p: { actor?: string; service?: string; object?: string }) =>
    p.actor ? "actor" : p.object ? "object" : p.service ? "service" : "";
  const kindPatch = (kind: string, value: string) => ({
    actor: kind === "actor" ? value : "",
    service: kind === "service" ? value : "",
    object: kind === "object" ? value : "",
  });
  const where = [
    "main: at the end",
    ...(selectedMessage && selectedMessage.fragment === null ? [`main: after ${selectedMessage.index + 1}`] : []),
    ...(def?.fragments ?? []).map((f, i) => `fragment ${i + 1}: ${f.kind} · ${f.label}`),
  ];

  return (
    <div
      className="app-shell dock-offset flex flex-col overflow-hidden bg-gray-950 text-gray-200"
      onClick={() => menuOpen && setMenuOpen(false)}
    >
      <header className="relative z-40 flex items-center gap-2 border-b border-gray-800 bg-gray-900 px-2 py-1.5 text-xs md:px-3 md:py-2">
        <span className="flex items-center gap-1 font-semibold text-blue-300">
          <KindIcon kind="sequence" size={14} />
          SEQ
        </span>
        <DocSwitcher />
        <span className="min-w-0 flex-1 truncate text-gray-400" title={docPath}>
          {def?.settings.name ?? fileName}
          <span className="hidden text-gray-600 lg:inline"> · {fileName}</span>
        </span>
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <button className={button} onClick={copyMermaid}>
            Copy mermaid
          </button>
          <button
            className={button}
            onClick={() => setPanelHidden((h) => !h)}
            aria-pressed={!panelHidden}
            title={panelHidden ? "Show the panel" : "Hide the panel — the board takes the full width"}
          >
            {panelHidden ? "⟨ Panel" : "Panel ⟩"}
          </button>
        </div>
        <div className="relative shrink-0 md:hidden">
          <button
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm leading-none text-gray-200"
            aria-label="More actions"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
              <button
                className="block w-full px-4 py-3 text-left text-sm text-gray-200 hover:bg-gray-800"
                onClick={() => {
                  setMenuOpen(false);
                  copyMermaid();
                }}
              >
                Copy as mermaid
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div ref={boardRef} className="relative min-w-0 flex-1 overflow-hidden">
          {def && layout && (
            <BoardBoundary what="sequence" resetKey={def}>
            <SequenceCanvas
              definition={view!}
              layout={layout}
              viewport={viewport}
              onViewportChange={setViewport}
              selection={selection}
              errorElements={errorElements}
              warningElements={warningElements}
              fitKey={fitKey}
              onSelect={(kind, id) => select({ kind, id })}
              onClearSelection={() => setSelection(null)}
              emptyHint="No participants yet — add them in the panel, or let an agent write the scenario."
            />
            </BoardBoundary>
          )}

          <div
            className={`pointer-events-none absolute left-2 top-2 flex max-w-[75%] items-center gap-1.5 rounded bg-gray-950/70 px-1.5 py-0.5 text-[11px] ${
              status.tone === "warn" ? "text-amber-300" : "text-gray-500"
            }`}
            role="status"
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.tone === "warn" ? "bg-amber-400" : "bg-emerald-500"}`} />
            <span className={`truncate transition-opacity duration-500 ${statusQuiet && status.tone === "ok" ? "opacity-0" : "opacity-100"}`}>
              {status.text}
              {peers > 1 ? ` · ${peers} in the room` : ""}
            </span>
          </div>

          <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900/90 shadow-lg backdrop-blur">
            {(
              [
                ["＋", "Zoom in", () => zoomBy(1.25)],
                ["−", "Zoom out", () => zoomBy(0.8)],
                ["⛶", "Fit the whole diagram", () => setFitKey((k) => (k ?? 0) + 1)],
              ] as const
            ).map(([glyph, title, run]) => (
              <button
                key={title}
                title={title}
                aria-label={title}
                onClick={run}
                className="h-10 w-10 border-b border-gray-800 text-base leading-none text-gray-200 last:border-b-0 hover:bg-gray-800 md:h-8 md:w-8 md:text-sm"
              >
                {glyph}
              </button>
            ))}
          </div>

          {selection && !sheetOpen && (
            <button
              className="absolute bottom-3 left-1/2 max-w-[60%] -translate-x-1/2 truncate rounded-full border border-blue-500/60 bg-gray-900/95 px-4 py-2 text-sm text-blue-200 shadow-lg md:hidden"
              onClick={() => {
                setTab(selection.kind === "message" ? "messages" : "participants");
                setSheetOpen(true);
              }}
            >
              Edit {selection.kind === "message" ? `${selection.id}. ${selectedMessage?.message.label ?? ""}` : selection.id}
            </button>
          )}
        </div>

        {sheetOpen && <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={sheet.close} aria-hidden="true" />}

        {def && (
          <aside
            style={sheet.sheetStyle}
            className={`safe-x fixed inset-x-0 bottom-0 z-30 flex h-[var(--sheet-h)] flex-col overflow-hidden rounded-t-2xl border-t border-gray-800 bg-gray-900 shadow-2xl transition-[transform,height] duration-200 ease-out ${
              sheetOpen ? "translate-y-0" : "pointer-events-none translate-y-full"
            } md:pointer-events-auto md:static md:z-auto md:h-auto md:w-80 md:translate-y-0 md:rounded-none md:border-l md:border-t-0 md:shadow-none md:transition-none ${
              panelHidden ? "md:hidden" : ""
            }`}
          >
            <div className="md:hidden" {...sheet.zoneProps}>
              <div className="flex justify-center pb-1 pt-2">
                <span className="h-1.5 w-12 rounded-full bg-gray-600" />
              </div>
              <div className="flex items-center justify-between border-b border-gray-800 px-4 pb-2">
                <h2 className="text-sm font-semibold text-gray-300">{tabs.find((t) => t.id === tab)?.label}</h2>
                <button onClick={sheet.close} className="-mr-2 px-3 py-2 text-lg text-gray-400" aria-label="Close panel">
                  ✕
                </button>
              </div>
            </div>

            {/* Desktop: the panel's own tabs. */}
            <div className="hidden border-b border-gray-800 md:flex">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative flex-1 px-1 py-2 text-center text-xs transition-colors ${
                    tab === t.id ? "border-b-2 border-blue-400 bg-gray-800/50 text-blue-400" : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {t.label}
                  {t.badge !== undefined && (
                    <span className="absolute right-1 top-1 min-w-[14px] rounded-full bg-red-900 px-1 text-[9px] text-red-100">{t.badge}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="touch-targets dock-offset flex-1 overflow-y-auto overscroll-contain p-3">
              <BoardBoundary what="panel" resetKey={def}>
              {/* ── Participants ─────────────────────────────────────────── */}
              <section className={tab === "participants" ? "" : "hidden"}>
                <div className={heading} style={{ marginTop: 0 }}>
                  Participants
                </div>
                <div className="flex flex-wrap gap-1">
                  {sd.participants.map((p) => (
                    <button
                      key={p.name}
                      className={`${button} ${selection?.kind === "participant" && selection.id === p.name ? "border-blue-500 text-blue-300" : ""}`}
                      onClick={() => {
                        select({ kind: "participant", id: p.name });
                        showSelection({ kind: "participant", id: p.name });
                      }}
                      title={participantKind(p) || "participant"}
                    >
                      {p.name}
                      {participantKind(p) && <span className="text-gray-500"> · {participantKind(p)}</span>}
                    </button>
                  ))}
                </div>
                <FieldForm
                  id="add-participant"
                  reset
                  required={["name"]}
                  fields={[
                    { name: "name", placeholder: "new participant" },
                    { name: "kind", options: KINDS, label: "kind" },
                    { name: "value", placeholder: "actor / service / object", suggest: [...vocabulary.actors, ...vocabulary.objects] },
                    { name: "holds", placeholder: "holds: Entity, Entity", suggest: vocabulary.entities },
                  ]}
                  submit="＋ Participant"
                  onSubmit={(v) => {
                    const name = str(v.name);
                    const kind = str(v.kind);
                    apply((d) =>
                      addParticipant(d, {
                        name,
                        ...(kind ? { [kind]: str(v.value) || name } : {}),
                        holds: list(v.holds),
                      }),
                    );
                    select({ kind: "participant", id: name });
                  }}
                />

                {selectedParticipant && (
                  <>
                    <div className={`${heading} flex items-center justify-between gap-2`}>
                      <span className="truncate text-sm normal-case tracking-normal text-gray-200">{selectedParticipant.name}</span>
                      <button className={`${button} normal-case tracking-normal`} onClick={() => showSelection({ kind: "participant", id: selectedParticipant.name })}>
                        ◎ Show on board
                      </button>
                    </div>
                    {/* Where it stands: participants are the columns, left to right. */}
                    {(() => {
                      const at = sd.participants.findIndex((p) => p.name === selectedParticipant.name);
                      const last = sd.participants.length - 1;
                      const move = (to: number) => apply((d) => moveParticipant(d, selectedParticipant.name, to));
                      return (
                        <div className="mb-1 flex items-center gap-1 text-[11px] text-gray-400">
                          <button className={`${button} disabled:opacity-40`} disabled={at <= 0} onClick={() => move(at - 1)} aria-label="Move one column left">
                            ← Left
                          </button>
                          <span className="flex-1 text-center">
                            column {at + 1} of {last + 1}
                          </span>
                          <button className={`${button} disabled:opacity-40`} disabled={at >= last} onClick={() => move(at + 1)} aria-label="Move one column right">
                            Right →
                          </button>
                        </div>
                      );
                    })()}
                    <FieldForm
                      key={`rename:${selectedParticipant.name}`}
                      id="rename-participant"
                      required={["to"]}
                      fields={[{ name: "to", label: "new name", initial: selectedParticipant.name }]}
                      submit="Rename (every message follows)"
                      onSubmit={(v) => {
                        const to = str(v.to);
                        if (to === selectedParticipant.name) return;
                        apply((d) => renameParticipant(d, selectedParticipant.name, to));
                        select({ kind: "participant", id: to });
                      }}
                    />
                    <FieldForm
                      key={`p:${JSON.stringify(selectedParticipant)}`}
                      id="edit-participant"
                      fields={[
                        { name: "kind", options: KINDS, label: "kind", initial: participantKind(selectedParticipant) },
                        {
                          name: "value",
                          placeholder: "actor / service / object",
                          suggest: [...vocabulary.actors, ...vocabulary.objects],
                          initial: selectedParticipant.actor ?? selectedParticipant.object ?? selectedParticipant.service ?? "",
                        },
                        { name: "holds", placeholder: "holds: Entity, Entity", suggest: vocabulary.entities, initial: (selectedParticipant.holds ?? []).join(", "), wide: true },
                        { name: "description", placeholder: "description", initial: selectedParticipant.description ?? "", wide: true },
                      ]}
                      submit="Save participant"
                      onSubmit={(v) =>
                        apply((d) =>
                          updateParticipant(d, selectedParticipant.name, {
                            ...kindPatch(str(v.kind), str(v.value) || selectedParticipant.name),
                            holds: list(v.holds),
                            description: str(v.description),
                          }),
                        )
                      }
                    />
                    <button
                      className={`${button} mt-2 text-red-300`}
                      onClick={() => {
                        apply((d) => removeParticipant(d, selectedParticipant.name));
                        setSelection(null);
                        writeFocus(null);
                      }}
                      title="Also removes every message it sends or receives"
                    >
                      Delete {selectedParticipant.name} and its messages
                    </button>
                  </>
                )}
              </section>

              {/* ── Messages ─────────────────────────────────────────────── */}
              <section className={tab === "messages" ? "" : "hidden"}>
                <div className={heading} style={{ marginTop: 0 }}>
                  Messages
                </div>
                {messages.length === 0 && <div className="py-0.5 text-[11px] text-gray-600">None yet.</div>}
                <div className="flex flex-col">
                  {messages.map(({ ref, message: m, fragment }, i) => {
                    const startsFragment = fragment !== null && (i === 0 || messages[i - 1].fragment !== fragment);
                    const f = fragment !== null ? sd.fragments?.[fragment] : undefined;
                    const isSelected = selection?.kind === "message" && selection.id === ref;
                    return (
                      <div key={ref}>
                        {startsFragment && f && (
                          <div className="mt-2 border-t border-gray-800 pt-1 text-[11px] text-indigo-300">
                            <span className="font-semibold">{f.kind}</span> · after {f.after} · {f.label}
                          </div>
                        )}
                        <button
                          className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${
                            isSelected ? "bg-blue-950/60 text-blue-200" : "text-gray-300 hover:bg-gray-800"
                          }`}
                          onClick={() => {
                            select({ kind: "message", id: ref });
                            showSelection({ kind: "message", id: ref });
                          }}
                          title={`${m.from} → ${m.to}: ${m.label}`}
                        >
                          <span className="text-gray-500">{ref}.</span> {m.from} → {m.to}: {m.label}
                          {m.event ? <span className="text-blue-300"> [{m.event}]</span> : null}
                          {m.state ? <span className="text-emerald-400"> → {m.state}</span> : null}
                          {m.optional ? <span className="text-gray-500"> opt</span> : null}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {selectedMessage && (
                  <>
                    <div className={`${heading} flex items-center justify-between gap-2`}>
                      <span className="truncate text-sm normal-case tracking-normal text-gray-200">Message {selection!.id}</span>
                      <span className="flex gap-1 normal-case tracking-normal">
                        {selectedMessage.fragment === null && (
                          <>
                            <button
                              className={button}
                              aria-label="Move up"
                              title="Move up"
                              disabled={selectedMessage.index === 0}
                              onClick={() => {
                                apply((d) => moveMessage(d, selectedMessage.index, selectedMessage.index - 1));
                                select({ kind: "message", id: String(selectedMessage.index) });
                              }}
                            >
                              ↑
                            </button>
                            <button
                              className={button}
                              aria-label="Move down"
                              title="Move down"
                              disabled={selectedMessage.index >= sd.messages.length - 1}
                              onClick={() => {
                                apply((d) => moveMessage(d, selectedMessage.index, selectedMessage.index + 1));
                                select({ kind: "message", id: String(selectedMessage.index + 2) });
                              }}
                            >
                              ↓
                            </button>
                          </>
                        )}
                        <button className={button} onClick={() => showSelection(selection!)}>
                          ◎ Show
                        </button>
                      </span>
                    </div>
                    <FieldForm
                      key={`m:${selection!.id}:${JSON.stringify(selectedMessage.message)}`}
                      id="edit-message"
                      required={["label"]}
                      fields={[
                        ...messageFields(selectedMessage.message),
                        { name: "description", placeholder: "description", initial: selectedMessage.message.description ?? "", wide: true },
                      ]}
                      submit="Save message"
                      onSubmit={(v) =>
                        apply((d) => updateMessage(d, selectedMessage.index, messageFrom(v), selectedMessage.fragment))
                      }
                    />
                    <button
                      className={`${button} mt-2 text-red-300`}
                      onClick={() => {
                        apply((d) => removeMessage(d, selectedMessage.index, selectedMessage.fragment));
                        setSelection(null);
                        writeFocus(null);
                      }}
                    >
                      Delete message {selection!.id}
                    </button>
                  </>
                )}

                <div className={heading}>Add a message</div>
                <FieldForm
                  key={`add:${where.join("|")}:${names.join("|")}`}
                  id="add-message"
                  reset
                  required={["label"]}
                  fields={[{ name: "where", options: where, label: "where", wide: true }, ...messageFields()]}
                  submit="＋ Message"
                  onSubmit={(v) => {
                    const at = str(v.where);
                    const message = messageFrom(v);
                    const frag = /^fragment (\d+):/.exec(at);
                    const after = /^main: after (\d+)$/.exec(at);
                    if (frag) apply((d) => addFragmentMessage(d, Number(frag[1]) - 1, message));
                    else if (after) apply((d) => addMessage(d, message, Number(after[1])));
                    else apply((d) => addMessage(d, message));
                  }}
                />

                <div className={heading}>Fragments</div>
                {(sd.fragments ?? []).length === 0 && <div className="py-0.5 text-[11px] text-gray-600">None.</div>}
                {(sd.fragments ?? []).map((f, i) => (
                  <div key={`${i}:${JSON.stringify({ ...f, messages: undefined })}`} className="mb-2 rounded border border-gray-800 p-1.5">
                    <div className="flex items-center justify-between text-[11px] text-indigo-300">
                      <span>
                        {i + 1}. <span className="font-semibold">{f.kind}</span> · after {f.after} · {f.messages.length} message(s)
                      </span>
                      <button className="text-gray-500 hover:text-red-400" aria-label={`Remove fragment ${i + 1}`} onClick={() => apply((d) => removeFragment(d, i))}>
                        ✕
                      </button>
                    </div>
                    <FieldForm
                      id={`edit-fragment-${i}`}
                      fields={[
                        { name: "kind", options: SQD_FRAGMENT_KINDS, initial: f.kind },
                        { name: "after", placeholder: "after message", initial: String(f.after) },
                        { name: "label", placeholder: "the condition, in words", initial: f.label, wide: true },
                      ]}
                      submit="Save fragment"
                      onSubmit={(v) =>
                        apply((d) => updateFragment(d, i, { kind: str(v.kind) as SqdFragmentKind, after: Number(str(v.after)), label: str(v.label) }))
                      }
                    />
                  </div>
                ))}
                <FieldForm
                  key={`add-fragment:${sd.messages.length}:${selectedMessage?.index ?? ""}`}
                  id="add-fragment"
                  reset
                  required={["label"]}
                  fields={[
                    { name: "kind", options: SQD_FRAGMENT_KINDS },
                    {
                      name: "after",
                      placeholder: "after message",
                      initial: String(selectedMessage && selectedMessage.fragment === null ? selectedMessage.index + 1 : sd.messages.length),
                    },
                    { name: "label", placeholder: "the condition, in words", wide: true },
                    { name: "from", options: names, label: "first message from" },
                    { name: "to", options: names, label: "to", initial: names[1] ?? names[0] ?? "" },
                    { name: "first", placeholder: "first message label (optional)", wide: true },
                  ]}
                  submit="＋ Fragment"
                  onSubmit={(v) =>
                    apply((d) =>
                      addFragment(d, {
                        kind: str(v.kind) as SqdFragmentKind,
                        after: Number(str(v.after)),
                        label: str(v.label),
                        messages: str(v.first) ? [{ from: str(v.from), to: str(v.to), label: str(v.first) }] : [],
                      }),
                    )
                  }
                />
              </section>

              {/* ── Notes ────────────────────────────────────────────────── */}
              <section className={tab === "notes" ? "" : "hidden"}>
                <div className={heading} style={{ marginTop: 0 }}>
                  Notes
                </div>
                <p className="mb-1 text-[11px] text-gray-600">
                  Saved in the document, for whoever opens it next — you, or an agent.
                </p>
                <NotesField
                  key="sequence"
                  label="On this sequence"
                  value={def.settings.notes ?? ""}
                  placeholder="What was discussed, what is still open…"
                  onSave={(notes) => apply((d) => updateSqdSettings(d, { notes }))}
                />
                {selectedParticipant && (
                  <NotesField
                    key={`participant:${selectedParticipant.name}`}
                    label={`On ${selectedParticipant.name}`}
                    value={selectedParticipant.notes ?? ""}
                    placeholder={`A question or a decision about ${selectedParticipant.name}…`}
                    onSave={(notes) => apply((d) => updateParticipant(d, selectedParticipant.name, { notes }))}
                  />
                )}
                {selectedMessage && (
                  <NotesField
                    key={`message:${selection!.id}`}
                    label={`On message ${selection!.id}`}
                    value={selectedMessage.message.notes ?? ""}
                    placeholder="A question or a decision about this message…"
                    onSave={(notes) => apply((d) => updateMessage(d, selectedMessage.index, { notes }, selectedMessage.fragment))}
                  />
                )}
                {!selection && <p className="mt-2 text-[11px] text-gray-600">Select a participant or a message to leave a note on it.</p>}
                {[...sd.participants.filter((p) => p.notes?.trim()), ...messages.filter((m) => m.message.notes?.trim())].length > 0 && (
                  <>
                    <div className={heading}>With notes</div>
                    <div className="flex flex-wrap gap-1">
                      {sd.participants
                        .filter((p) => p.notes?.trim())
                        .map((p) => (
                          <button key={`p${p.name}`} className={button} onClick={() => goTo(`participant:${p.name}`)}>
                            {p.name}
                          </button>
                        ))}
                      {messages
                        .filter((m) => m.message.notes?.trim())
                        .map((m) => (
                          <button key={`m${m.ref}`} className={button} onClick={() => goTo(`message:${m.ref}`)}>
                            message {m.ref}
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </section>

              {/* ── Issues ───────────────────────────────────────────────── */}
              <section className={tab === "issues" ? "" : "hidden"}>
                <div className={heading} style={{ marginTop: 0 }}>
                  Issues
                </div>
                {problems.map((p, i) => (
                  <button key={`p${i}`} className="block w-full py-0.5 text-left text-[11px] text-red-300" onClick={() => goTo(p.element)}>
                    [{p.ruleId}] {p.message}
                  </button>
                ))}
                {memberIssues.map((p, i) => (
                  <button
                    key={`s${i}`}
                    className={`block w-full py-0.5 text-left text-[11px] ${p.severity === "error" ? "text-red-300" : "text-amber-300"}`}
                    onClick={() => goTo(p.element)}
                  >
                    [{p.ruleId}] {p.message}
                  </button>
                ))}
                {problems.length === 0 && memberIssues.length === 0 && (
                  <div className="py-0.5 text-[11px] text-green-400">
                    {systemCheck ? "Valid, and every name it uses resolves in the system." : "The document is valid."}
                  </div>
                )}
                {!systemPath && (
                  <p className="mt-2 text-[11px] text-gray-600">
                    Open this sequence from its system to check it against the machines and the data.
                  </p>
                )}
                {systemPath && !member && system && (
                  <p className="mt-2 text-[11px] text-amber-300">This document is not a member of the open system.</p>
                )}
                {replay && (
                  <>
                    <div className={heading}>Replay against {replay.machines.join(", ") || "no machine"}</div>
                    {replay.paths.map((path) => (
                      <div key={path.name} className="mb-2">
                        <div className={`text-[11px] font-semibold ${path.accepted ? "text-green-400" : "text-amber-300"}`}>
                          {path.name} — {path.accepted ? "accepted" : "stops"}
                        </div>
                        {path.steps
                          .filter((s) => s.result !== "data")
                          .map((s) => (
                            <button
                              key={`${path.name}:${s.ref}`}
                              className={`block w-full truncate py-0.5 pl-2 text-left font-mono text-[10.5px] ${
                                s.result === "moved" || s.result === "stayed" ? "text-gray-400" : "text-amber-300"
                              }`}
                              title={s.note ?? s.result}
                              onClick={() => goTo(`message:${s.ref}`)}
                            >
                              {s.ref}. {s.event ?? ""} {s.from.join("|") || "·"} → {s.to.join("|") || "·"} {s.result}
                            </button>
                          ))}
                      </div>
                    ))}
                  </>
                )}
              </section>
              </BoardBoundary>
            </div>
          </aside>
        )}
      </div>

      <nav className="dock-safe safe-x fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-800 bg-gray-900/95 backdrop-blur-md md:hidden">
        {tabs.map((t) => {
          const current = sheetOpen && tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => openTab(t.id)}
              aria-pressed={current}
              className={`relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
                current ? "text-blue-400" : "text-gray-500"
              }`}
            >
              <span className="flex h-4 items-center text-base leading-none">{t.icon}</span>
              <span>{t.label}</span>
              {t.badge !== undefined && (
                <span className="absolute right-1/2 top-1 min-w-[16px] translate-x-5 rounded-full border border-red-900/80 bg-red-950/80 px-1 text-[10px] leading-4 text-red-200">
                  {t.badge}
                </span>
              )}
              {current && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-blue-400" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
