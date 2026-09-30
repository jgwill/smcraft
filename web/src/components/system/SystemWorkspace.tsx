"use client";

/**
 * The designer, when the document is a system (`.sysdf.json`, Spec 82).
 *
 * The board is the system map: one card per member, by kind, with what it
 * holds; a line between two members for every name that crosses between them
 * (`systemLinks`), labelled with how many; and the actors the scenarios share.
 * A card opens its member inside the system (`?doc=<member>&system=<this>`),
 * where the strip keeps every drawing one tap away.
 *
 * The panel: Members (what each is, and the links between each pair), Checks
 * (`checkSystem` grouped by rule, errors first, then the replay of every path
 * of every scenario, and the reconcile mode with the changes the scenarios
 * imply), and Notes. Same shell as the other workspaces: one header row, the
 * panel a bottom sheet behind a dock on a phone, a right column on a desktop.
 *
 * Members load through the file API, so the document allowlist decides what a
 * system may reach; a refused member is drawn as a card that says why.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  RECONCILE_MODES,
  checkSystem,
  elementFocus,
  membersByKind,
  reconcileModeOf,
  reconcileSystem,
  setReconcileMode,
  summarizeReconcile,
  systemLinks,
  updateMember,
  updateSystemSettings,
  type DocKind,
  type EntityRelationshipDefinition,
  type ElementRef,
  type ReconcileMode,
  type SequenceDefinition,
  type StateMachineDefinition,
  type SystemIssue,
  type SystemLink,
} from "@miadi/stateloom-protocol";
import BoardBoundary from "@/components/BoardBoundary";
import DocSwitcher from "@/components/DocSwitcher";
import IssueIcon from "@/components/IssueIcon";
import { NotesField } from "@/components/erd/ErdWorkspace";
import { panelButton as button, panelHeading as heading } from "@/components/forms";
import KindIcon from "@/components/system/KindIcon";
import { memberTitle } from "@/components/system/SystemStrip";
import { useRequestedDoc } from "@/lib/docParam";
import { useSheetDrag } from "@/lib/useSheetDrag";
import { openInSystem, urlParam } from "@/lib/systemParam";
import { safely } from "@/lib/safely";
import { DocConflict, notifySystemChanged, readDoc, reconcileNow, useSystem, writeDoc, type LoadedSystem } from "@/lib/systemLoad";

type Tab = "members" | "checks" | "notes";

const KIND_LABEL: Record<DocKind, string> = { erd: "ERD", machine: "STATE MACHINE", sequence: "SEQUENCE", system: "SYSTEM" };

function countsOf(kind: DocKind, def: unknown, short = false): string {
  if (!def) return "";
  if (kind === "erd") {
    const d = def as EntityRelationshipDefinition;
    return `${d.entities?.length ?? 0} entities · ${d.relationships?.length ?? 0} relationships`;
  }
  if (kind === "sequence") {
    const d = def as SequenceDefinition;
    const f = d.fragments?.length ?? 0;
    return `${d.participants?.length ?? 0} participants · ${d.messages?.length ?? 0} messages${f && !short ? ` · ${f} fragment${f > 1 ? "s" : ""}` : ""}`;
  }
  const d = def as StateMachineDefinition;
  let states = 0;
  const walk = (s: StateMachineDefinition["state"] | undefined): void => {
    if (!s) return;
    states += 1;
    (s.states ?? []).forEach(walk);
    (s.parallel?.states ?? []).forEach(walk);
  };
  // The root holds the machine; it is not one of its states (as Miadi's scalar layer counts).
  (d.state?.states ?? []).forEach(walk);
  (d.state?.parallel?.states ?? []).forEach(walk);
  const events = (d.events ?? []).reduce((n, src) => n + (src?.events?.length ?? 0) + (src?.timers?.length ?? 0), 0);
  return `${states} states · ${events} events`;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

function linkLine(l: SystemLink): string {
  const from = l.from.kind === "message" ? `message ${l.from.name}` : `${l.from.kind} ${l.from.name}`;
  return `${from} ${l.text}`;
}

export default function SystemWorkspace() {
  const requested = useRequestedDoc();
  // No `?doc=`: the default document is this system; ask the server its path.
  const [path, setPath] = useState<string | null>(requested);
  useEffect(() => {
    let live = true;
    if (requested) setPath(requested);
    // The first render has not read the URL yet: only a page with no `?doc=` asks for the default.
    else if (!urlParam("doc")) readDoc(null).then((r) => live && setPath(r.path || null));
    return () => {
      live = false;
    };
  }, [requested]);
  const { system, reload } = useSystem(path);
  const [tab, setTab] = useState<Tab>("members");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);
  const [pair, setPair] = useState<string | null>(null);
  const [status, setStatusState] = useState<{ text: string; tone: "ok" | "warn" }>({ text: "loading…", tone: "ok" });
  const setStatus = useCallback((text: string, tone: "ok" | "warn" = "ok") => setStatusState({ text, tone }), []);
  const [busy, setBusy] = useState(false);
  const sheet = useSheetDrag({ onClose: () => setSheetOpen(false), restVh: 62, tallVh: 92 });
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const observe = () => {
      const r = el.getBoundingClientRect();
      if (r.width) setPortrait(r.height > r.width * 1.1);
    };
    observe();
    const ro = new ResizeObserver(observe);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Said once; a reload after an edit keeps whatever the edit said.
  const announced = useRef(false);
  useEffect(() => {
    if (!system) return;
    if (system.error) setStatus(system.error, "warn");
    else if (!announced.current) setStatus(`${system.members.length} member${system.members.length === 1 ? "" : "s"} loaded`);
    announced.current = true;
  }, [system, setStatus]);
  const [statusQuiet, setStatusQuiet] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStatusQuiet(true), 4000);
    return () => {
      clearTimeout(timer);
      setStatusQuiet(false);
    };
  }, [status]);

  // A member in a shape the checks do not expect costs the checks, not the map.
  const check = useMemo(() => (system?.def ? safely(() => checkSystem(system.def, system.members), null) : null), [system]);
  const links = useMemo(() => (system ? safely(() => systemLinks(system.members), []) : []), [system]);
  const reconcile = useMemo(() => (system?.def ? safely(() => reconcileSystem(system.def, system.members), null) : null), [system]);
  const mode: ReconcileMode = reconcileModeOf(system?.def);

  const pairs = useMemo(() => {
    const map = new Map<string, { a: string; b: string; links: SystemLink[] }>();
    for (const l of links) {
      if (l.from.member === l.to.member) continue;
      const key = pairKey(l.from.member, l.to.member);
      const entry = map.get(key) ?? { a: key.split("\u0000")[0], b: key.split("\u0000")[1], links: [] };
      entry.links.push(l);
      map.set(key, entry);
    }
    return map;
  }, [links]);

  const issuesOf = (member: string) => (check?.issues ?? []).filter((i) => i.member === member);
  const errors = (check?.issues ?? []).filter((i) => i.severity === "error");
  const warnings = (check?.issues ?? []).filter((i) => i.severity === "warning");

  const openMember = (member: string, focus?: string | null): void => {
    if (!system) return;
    openInSystem({ doc: system.absOf[member] ?? member, system: requested ?? system.path, focus: focus ?? null });
  };
  const openRef = (ref: ElementRef): void => openMember(ref.member, elementFocus(ref));
  const openIssue = (i: SystemIssue): void => {
    if (!i.member) return;
    openMember(i.member, i.element && /^[a-z]+:/.test(i.element) ? i.element : null);
  };

  const writeSystem = async (next: NonNullable<LoadedSystem["def"]>, said: string): Promise<void> => {
    if (!system) return;
    try {
      // Only over the file this page read: an agent's edit since is reloaded, not overwritten.
      await writeDoc(system.path, next, system.mtimes[system.path]);
      setStatus(said);
      notifySystemChanged();
    } catch (e) {
      if (e instanceof DocConflict) {
        setStatus("the system changed on disk — reloaded; make the change again", "warn");
        notifySystemChanged();
      } else setStatus(`not saved: ${e instanceof Error ? e.message : String(e)}`, "warn");
    }
  };

  const chooseMode = (next: ReconcileMode): void => {
    if (!system?.def || next === mode) return;
    void writeSystem(setReconcileMode(system.def, next), `reconcile mode: ${next}`);
  };

  const applyChanges = async (): Promise<void> => {
    if (!system || !reconcile || !reconcile.count) return;
    setBusy(true);
    // Computed again from the disk as it is now, not from what this page loaded.
    const { result, written, failed, conflicts } = await reconcileNow(system.path);
    setBusy(false);
    if (failed.length) setStatus(`not all written: ${failed.join("; ")}`, "warn");
    else if (conflicts.length) setStatus(`${conflicts.join(", ")} kept changing on disk — not written; apply again`, "warn");
    else if (!result?.count) setStatus("nothing to apply: the drawings on disk already agree");
    else setStatus(`${summarizeReconcile(result, "propose").replace(/ proposed/, " applied")} — ${written.length} file(s) written`);
  };

  const openTab = (next: Tab): void => {
    if (sheetOpen && tab === next) sheet.close();
    else setSheetOpen(true);
    setTab(next);
  };

  // ── The map's geometry, in its own coordinates; the SVG scales it to the board.
  const W = portrait ? 420 : 760;
  const H = portrait ? 640 : 520;
  const cardW = portrait ? 196 : 196;
  const cardH = 92;
  const memberPaths = system?.def?.members?.filter((m) => m?.path).map((m) => m.path) ?? [];
  const actors = system?.def?.actors ?? [];
  const actorRow = actors.length ? 64 : 0;
  const cards = useMemo(() => {
    const n = memberPaths.length;
    const cx = W / 2;
    const cy = (H - actorRow) / 2 + 6;
    const rx = Math.max(0, W / 2 - cardW / 2 - 16);
    const ry = Math.max(0, (H - actorRow) / 2 - cardH / 2 - 18);
    const at = new Map<string, { x: number; y: number }>();
    memberPaths.forEach((m, i) => {
      if (n === 1) return at.set(m, { x: cx, y: cy });
      // A phone held upright: a zigzag down the screen, so no two cards share a
      // row and every line has room for its count.
      if (portrait) {
        const top = cardH / 2 + 16;
        const bottom = H - actorRow - cardH / 2 - 16;
        return at.set(m, { x: i % 2 ? W * 0.67 : W * 0.33, y: top + ((bottom - top) * i) / (n - 1) });
      }
      if (n === 2) return at.set(m, portrait ? { x: cx, y: i ? cy + ry : cy - ry } : { x: i ? cx + rx : cx - rx, y: cy });
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      at.set(m, { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
    });
    return at;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberPaths.join("|"), W, H, cardW, actorRow, portrait]);

  // Which scenarios each actor takes part in.
  const actorUse = useMemo(() => {
    const use = new Map<string, string[]>();
    for (const { member, def } of membersByKind(system?.members ?? []).sequences) {
      for (const p of def.participants ?? []) {
        if (!p?.actor) continue;
        const list = use.get(p.actor) ?? [];
        if (!list.includes(member)) list.push(member);
        use.set(p.actor, list);
      }
    }
    return use;
  }, [system]);

  const def = system?.def;
  const fileName = (system?.path ?? path ?? "").split("/").pop() || "…";
  const tabs: { id: Tab; label: string; icon: ReactNode; badge?: number }[] = [
    { id: "members", label: "Members", icon: <KindIcon kind="system" /> },
    { id: "checks", label: "Checks", icon: <IssueIcon />, badge: errors.length + warnings.length || undefined },
    { id: "notes", label: "Notes", icon: "✎" },
  ];
  const selectedPair = pair ? pairs.get(pair) : undefined;

  // Issues grouped by rule: errors first, then warnings.
  const grouped = useMemo(() => {
    const out: { key: string; ruleId: string; severity: "error" | "warning"; issues: SystemIssue[] }[] = [];
    for (const severity of ["error", "warning"] as const) {
      const byRule = new Map<string, SystemIssue[]>();
      for (const i of check?.issues ?? []) {
        if (i.severity !== severity) continue;
        byRule.set(i.ruleId, [...(byRule.get(i.ruleId) ?? []), i]);
      }
      for (const [ruleId, issues] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        out.push({ key: `${severity}:${ruleId}`, ruleId, severity, issues });
      }
    }
    return out;
  }, [check]);

  return (
    <div className="app-shell dock-offset flex flex-col overflow-hidden bg-gray-950 text-gray-200" onClick={() => menuOpen && setMenuOpen(false)}>
      <header className="relative z-40 flex items-center gap-2 border-b border-gray-800 bg-gray-900 px-2 py-1.5 text-xs md:px-3 md:py-2">
        <span className="flex items-center gap-1 font-semibold text-blue-300">
          <KindIcon kind="system" size={14} />
          SYS
        </span>
        <DocSwitcher />
        <span className="min-w-0 flex-1 truncate text-gray-400" title={system?.path}>
          {def?.settings?.name ?? fileName}
          <span className="hidden text-gray-600 lg:inline"> · {fileName}</span>
        </span>
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <button className={button} onClick={reload} title="Read the system and every member again">
            Re-check
          </button>
          <button className={button} onClick={() => setPanelHidden((h) => !h)} aria-pressed={!panelHidden}>
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
                  reload();
                }}
              >
                Re-check the system
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div ref={boardRef} className="relative min-w-0 flex-1 overflow-hidden bg-[#030712]">
          {system && def && (
            <BoardBoundary what="system map" resetKey={system}>
            <svg className="h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`System map of ${def.settings?.name}`}>
              {/* Lines between members: one per pair, labelled with its count. */}
              {[...pairs.entries()].map(([key, p]) => {
                const a = cards.get(p.a);
                const b = cards.get(p.b);
                if (!a || !b) return null;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                const label = `${p.links.length} link${p.links.length === 1 ? "" : "s"}`;
                const w = label.length * 6.4 + 16;
                const on = pair === key;
                return (
                  <g
                    key={key}
                    className="cursor-pointer"
                    onClick={() => {
                      setPair(on ? null : key);
                      setTab("members");
                      setSheetOpen(true);
                    }}
                  >
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={18} />
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? "#3b82f6" : "#475569"} strokeWidth={on ? 2.5 : 1.6} />
                    <rect x={mx - w / 2} y={my - 11} width={w} height={22} rx={11} fill="#0f172a" stroke={on ? "#3b82f6" : "#334155"} />
                    <text x={mx} y={my + 4} textAnchor="middle" fontSize={11.5} fill={on ? "#93c5fd" : "#cbd5e1"}>
                      {label}
                    </text>
                  </g>
                );
              })}

              {/* Actors along the bottom, joined to the scenarios they take part in. */}
              {actors.map((actor, i) => {
                const x = ((i + 1) * W) / (actors.length + 1);
                const y = H - 30;
                return (
                  <g key={actor.name}>
                    {(actorUse.get(actor.name) ?? []).map((m) => {
                      const c = cards.get(m);
                      return c ? <line key={m} x1={x} y1={y - 14} x2={c.x} y2={c.y + cardH / 2} stroke="#334155" strokeDasharray="3 4" /> : null;
                    })}
                    <title>{[`${actor.kind}`, actor.description ?? "", actor.wheelNode ?? ""].filter(Boolean).join(" — ")}</title>
                    <rect x={x - 62} y={y - 14} width={124} height={28} rx={14} fill="#0c1020" stroke="#6366f1" />
                    <g transform={`translate(${x - 54} ${y - 8})`} color="#a5b4fc">
                      <KindIcon kind="actor" size={16} />
                    </g>
                    <text x={x - 34} y={y - 1} fontSize={11.5} fontWeight={600} fill="#e2e8f0">
                      {actor.name.length > 12 ? `${actor.name.slice(0, 11)}…` : actor.name}
                    </text>
                    <text x={x - 34} y={y + 9} fontSize={8.5} fill="#94a3b8">
                      {actor.kind}
                    </text>
                  </g>
                );
              })}

              {/* The members. */}
              {memberPaths.map((m) => {
                const at = cards.get(m);
                const loaded = system.members.find((x) => x.path === m);
                if (!at || !loaded) return null;
                const kind = loaded.kind;
                const mine = issuesOf(m);
                const e = mine.filter((i) => i.severity === "error").length;
                const w = mine.filter((i) => i.severity === "warning").length;
                const x = at.x - cardW / 2;
                const y = at.y - cardH / 2;
                const title = memberTitle(system, m);
                const inPair = selectedPair && (selectedPair.a === m || selectedPair.b === m);
                return (
                  <g key={m} className="cursor-pointer" onClick={() => openMember(m)}>
                    <title>{`${m}${loaded.error ? ` — cannot be read: ${loaded.error}` : ""}\nTap to open it inside the system.`}</title>
                    <rect
                      x={x}
                      y={y}
                      width={cardW}
                      height={cardH}
                      rx={10}
                      fill="#0f172a"
                      stroke={loaded.error ? "#ef4444" : inPair ? "#3b82f6" : e ? "#b91c1c" : "#475569"}
                      strokeWidth={inPair ? 2.2 : 1.5}
                      strokeDasharray={loaded.error ? "5 4" : undefined}
                    />
                    <g transform={`translate(${x + 10} ${y + 9})`} color="#93c5fd">
                      <KindIcon kind={kind} size={16} />
                    </g>
                    <text x={x + 32} y={y + 21} fontSize={9} fontWeight={700} letterSpacing="0.06em" fill="#64748b">
                      {KIND_LABEL[kind]}
                    </text>
                    <text x={x + 10} y={y + 43} fontSize={14} fontWeight={600} fill="#e2e8f0">
                      {title.length > 22 ? `${title.slice(0, 21)}…` : title}
                    </text>
                    <text x={x + 10} y={y + 60} fontSize={10.5} fill="#94a3b8">
                      {loaded.error ? "cannot be read" : countsOf(kind, loaded.def, true)}
                    </text>
                    <text x={x + 10} y={y + 79} fontSize={10.5} fill={e ? "#fca5a5" : w ? "#fcd34d" : "#4ade80"}>
                      {loaded.error
                        ? (loaded.error.length > 30 ? `${loaded.error.slice(0, 29)}…` : loaded.error)
                        : e || w
                          ? [e ? `${e} error${e > 1 ? "s" : ""}` : "", w ? `${w} warning${w > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ")
                          : "checks pass"}
                    </text>
                    <text x={x + cardW - 10} y={y + 79} fontSize={10.5} textAnchor="end" fill="#64748b">
                      open ›
                    </text>
                  </g>
                );
              })}
            </svg>
            </BoardBoundary>
          )}
          {system && !def && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-amber-300">{system.error}</div>
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
            </span>
          </div>
        </div>

        {sheetOpen && <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={sheet.close} aria-hidden="true" />}

        {system && def && (
          <aside
            style={sheet.sheetStyle}
            className={`safe-x fixed inset-x-0 bottom-0 z-30 flex h-[var(--sheet-h)] flex-col overflow-hidden rounded-t-2xl border-t border-gray-800 bg-gray-900 shadow-2xl transition-[transform,height] duration-200 ease-out ${
              sheetOpen ? "translate-y-0" : "pointer-events-none translate-y-full"
            } md:pointer-events-auto md:static md:z-auto md:h-auto md:w-96 md:translate-y-0 md:rounded-none md:border-l md:border-t-0 md:shadow-none md:transition-none ${
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
              {/* ── Members ──────────────────────────────────────────────── */}
              <section className={tab === "members" ? "" : "hidden"}>
                <div className={heading} style={{ marginTop: 0 }}>
                  Members
                </div>
                {memberPaths.map((m) => {
                  const loaded = system.members.find((x) => x.path === m);
                  const note = def.members.find((x) => x.path === m)?.notes;
                  return (
                    <div key={m} className="mb-1 rounded border border-gray-800">
                    <button onClick={() => openMember(m)} className="flex w-full items-start gap-2 p-2 text-left hover:bg-gray-800">
                      <span className="mt-0.5 text-blue-300">
                        <KindIcon kind={loaded?.kind ?? "machine"} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-gray-200">{memberTitle(system, m)}</span>
                        <span className="block truncate text-[10.5px] text-gray-500">{m}</span>
                        <span className={`block text-[11px] ${loaded?.error ? "text-red-300" : "text-gray-400"}`}>
                          {loaded?.error ? `cannot be read: ${loaded.error}` : countsOf(loaded?.kind ?? "machine", loaded?.def)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-gray-500">open ›</span>
                    </button>
                    {/* The system's note about this member — kept in the .sysdf.json, not in the member. */}
                    <div className="px-2 pb-2 [&_label]:mt-0">
                      <NotesField
                        key={`member:${m}`}
                        label="Note on this member, in the system"
                        value={note ?? ""}
                        placeholder={`Why ${memberTitle(system, m)} is part of this system, what is open…`}
                        onSave={(notes) => void writeSystem(updateMember(def, m, { notes }), "saved")}
                      />
                    </div>
                    </div>
                  );
                })}

                <div className={heading}>Links between members</div>
                {pairs.size === 0 && <div className="py-0.5 text-[11px] text-gray-600">No name crosses between the members yet.</div>}
                {[...pairs.entries()].map(([key, p]) => (
                  <div key={key} className="mb-1">
                    <button
                      className={`flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[11px] ${pair === key ? "bg-blue-950/60 text-blue-200" : "text-gray-300 hover:bg-gray-800"}`}
                      onClick={() => setPair(pair === key ? null : key)}
                    >
                      <span className="truncate">
                        {memberTitle(system, p.a)} ↔ {memberTitle(system, p.b)}
                      </span>
                      <span className="shrink-0 text-gray-500">{p.links.length}</span>
                    </button>
                    {pair === key && (
                      <div className="ml-2 border-l border-gray-800 pl-2">
                        {p.links.map((l, i) => (
                          <button
                            key={i}
                            className="block w-full truncate py-0.5 text-left text-[11px] text-gray-400 hover:text-gray-200"
                            title={`${linkLine(l)} — ${l.rule}`}
                            onClick={() => openRef(l.from)}
                          >
                            <span className="text-gray-600">{l.rule}</span> {linkLine(l)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {actors.length > 0 && (
                  <>
                    <div className={heading}>Actors</div>
                    {actors.map((a) => (
                      <div key={a.name} className="py-0.5 text-[11px] text-gray-300">
                        {a.name} <span className="text-gray-500">· {a.kind}</span>
                        {a.description ? <span className="text-gray-500"> — {a.description}</span> : null}
                      </div>
                    ))}
                  </>
                )}
              </section>

              {/* ── Checks ───────────────────────────────────────────────── */}
              <section className={tab === "checks" ? "" : "hidden"}>
                <div className={heading} style={{ marginTop: 0 }}>
                  Checks
                </div>
                <div className={`text-[11px] ${errors.length ? "text-red-300" : warnings.length ? "text-amber-300" : "text-green-400"}`}>
                  {errors.length} error{errors.length === 1 ? "" : "s"} · {warnings.length} warning{warnings.length === 1 ? "" : "s"}
                </div>
                {grouped.map((g) => (
                  <div key={g.key} className="mt-2">
                    <div className={`text-[11px] font-semibold ${g.severity === "error" ? "text-red-300" : "text-amber-300"}`}>
                      {g.ruleId} · {g.issues.length} {g.severity}
                      {g.issues.length === 1 ? "" : "s"}
                    </div>
                    {g.issues.map((i, n) => (
                      <button
                        key={n}
                        className="block w-full py-0.5 pl-2 text-left text-[11px] text-gray-300 hover:text-white"
                        onClick={() => openIssue(i)}
                        title={i.member ? `Open ${i.member}${i.element ? ` at ${i.element}` : ""}` : undefined}
                      >
                        {i.message}
                        {i.member && <span className="text-gray-500"> — {memberTitle(system, i.member)}</span>}
                      </button>
                    ))}
                  </div>
                ))}

                <div className={heading}>Reconcile</div>
                <p className="mb-1 text-[11px] text-gray-500">
                  What the scenarios imply for the machines and the data. <b className="text-gray-400">propose</b> lists it here to apply
                  by hand; <b className="text-gray-400">auto</b> writes it each time a scenario is saved.
                </p>
                <span className="inline-flex overflow-hidden rounded border border-gray-700" role="group" aria-label="Reconcile mode">
                  {RECONCILE_MODES.map((m) => (
                    <button
                      key={m}
                      aria-pressed={mode === m}
                      onClick={() => chooseMode(m)}
                      className={`px-3 py-1 text-xs ${mode === m ? "bg-blue-900/60 text-blue-200" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                    >
                      {m}
                    </button>
                  ))}
                </span>
                <div className="mt-2 text-[11px] font-semibold text-gray-400">Scenario changes</div>
                {reconcile && (
                  <>
                    <div className="text-[11px] text-gray-500">{summarizeReconcile(reconcile, "propose")}</div>
                    {reconcile.machines.map((m) => (
                      <div key={m.member} className="mt-1">
                        <div className="text-[11px] text-gray-300">
                          {m.machine} <span className="text-gray-500">· {m.member}</span>
                        </div>
                        {m.reasons.map((r, i) => (
                          <div key={i} className="pl-2 text-[11px] text-gray-400">
                            + {r}
                          </div>
                        ))}
                      </div>
                    ))}
                    {reconcile.erds.map((e) => (
                      <div key={e.member} className="mt-1">
                        <div className="text-[11px] text-gray-300">
                          {e.def.settings?.name ?? e.member} <span className="text-gray-500">· {e.member}</span>
                        </div>
                        {e.reasons.map((r, i) => (
                          <div key={i} className="pl-2 text-[11px] text-gray-400">
                            + {r}
                          </div>
                        ))}
                      </div>
                    ))}
                    {reconcile.system && (
                      <div className="mt-1">
                        <div className="text-[11px] text-gray-300">the system</div>
                        {reconcile.system.reasons.map((r, i) => (
                          <div key={i} className="pl-2 text-[11px] text-gray-400">
                            + {r}
                          </div>
                        ))}
                      </div>
                    )}
                    {reconcile.unresolved.map((u, i) => (
                      <div key={i} className="mt-1 text-[11px] text-amber-300">
                        left open: {u}
                      </div>
                    ))}
                    <button className={`${button} mt-2 disabled:opacity-40`} disabled={!reconcile.count || busy} onClick={applyChanges}>
                      {busy ? "Applying…" : `Apply${reconcile.count ? ` ${reconcile.count} change${reconcile.count === 1 ? "" : "s"}` : ""}`}
                    </button>
                  </>
                )}

                {(check?.replays ?? []).map(({ member, report }) => (
                  <div key={member}>
                    <div className={heading}>
                      Replay · {memberTitle(system, member)}
                    </div>
                    <div className="mb-1 text-[11px] text-gray-500">against {report.machines.join(", ") || "no machine"}</div>
                    {report.paths.map((p) => (
                      <div key={p.name} className="mb-2">
                        <div className={`text-[11px] font-semibold ${p.accepted ? "text-green-400" : "text-amber-300"}`}>
                          {p.name} — {p.accepted ? "accepted" : "stops"}
                        </div>
                        {p.steps
                          .filter((s) => s.result !== "data")
                          .map((s) => (
                            <button
                              key={`${p.name}:${s.ref}`}
                              className={`block w-full truncate py-0.5 pl-2 text-left font-mono text-[10.5px] ${
                                s.result === "moved" || s.result === "stayed" ? "text-gray-400" : "text-amber-300"
                              }`}
                              title={s.note ?? s.result}
                              onClick={() => openMember(member, `message:${s.ref}`)}
                            >
                              {s.ref}. {s.event ?? ""} {s.from.join("|") || "·"} → {s.to.join("|") || "·"} {s.result}
                            </button>
                          ))}
                      </div>
                    ))}
                  </div>
                ))}
              </section>

              {/* ── Notes ────────────────────────────────────────────────── */}
              <section className={tab === "notes" ? "" : "hidden"}>
                <div className={heading} style={{ marginTop: 0 }}>
                  Notes
                </div>
                <p className="mb-1 text-[11px] text-gray-600">Saved in the system file, for whoever opens it next.</p>
                <NotesField
                  key="system"
                  label="On this system"
                  value={def.settings?.notes ?? ""}
                  placeholder="What the system is for, what is still open…"
                  onSave={(notes) => void writeSystem(updateSystemSettings(def, { notes }), "saved")}
                />
                {def.settings?.description && (
                  <>
                    <div className={heading}>Description</div>
                    <p className="text-[11px] text-gray-400">{def.settings.description}</p>
                  </>
                )}
              </section>
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
