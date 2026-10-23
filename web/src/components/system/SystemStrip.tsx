"use client";

/**
 * The system strip (Spec 82): one compact row above whichever workspace is
 * open, when the URL says the open document is read as a member of a system
 * (`?system=<.sysdf.json>`).
 *
 * - The system's name: back to the map.
 * - One tab per member, drawn by kind: switch drawings without losing the system.
 * - Links: what the element in hand (`focus=`) is joined to in the other
 *   drawings — `linksOf(systemLinks(members), member, focus)` — each one a way
 *   to that element, opened and focused. With nothing in hand, the elements of
 *   this drawing that have links, to pick one.
 *
 * It also joins the system file's hub room with its own client: a `view:show`
 * from an agent opens the member it names, focuses the element, and says the
 * agent's note here as one short line. Notes from this page (an `auto`
 * reconcile) come through the same line. Never a second row on a phone: the
 * line lays itself over the board under the strip, then fades.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  elementFocus,
  linksOf,
  parseFocus,
  resolveMemberPath,
  systemLinks,
  type DocKind,
  type ElementRef,
  type SystemLink,
  type ViewEnvelope,
} from "@miadi/stateloom-protocol";
import { createBridgeClient } from "@miadi/stateloom-client";
import KindIcon from "@/components/system/KindIcon";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";
import { safely } from "@/lib/safely";
import { STRIP_NOTE_EVENT, openInSystem, useUrlParam } from "@/lib/systemParam";
import { memberOfDoc, notifySystemChanged, stayJoined, useSystem, type LoadedSystem } from "@/lib/systemLoad";

/** What a member is called on a tab: its own name when it has one, else its file's. */
export function memberTitle(system: LoadedSystem | null, member: string): string {
  const def = system?.members.find((m) => m.path === member)?.def as { settings?: { name?: string } } | null | undefined;
  return def?.settings?.name || (member.split("/").pop() ?? member).replace(/\.(smdf|erdf|sqdf|sysdf)\.json$|\.json$/i, "");
}

const kindOf = (system: LoadedSystem | null, member: string): DocKind =>
  system?.members.find((m) => m.path === member)?.kind ?? "machine";

function elementLabel(ref: Pick<ElementRef, "kind" | "name">): string {
  return ref.kind === "message" ? `message ${ref.name}` : `${ref.kind} ${ref.name}`;
}

/** The elements of `member` that some link touches, with how many links each. */
function linkedElements(links: readonly SystemLink[], member: string | null): [string, number][] {
  if (!member) return [];
  const seen = new Map<string, number>();
  for (const l of links) {
    for (const end of [l.from, l.to]) {
      if (end.member !== member) continue;
      const key = elementFocus(end);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export default function SystemStrip({ systemPath }: { systemPath: string }) {
  const doc = useUrlParam("doc");
  const focus = useUrlParam("focus");
  const { system } = useSystem(systemPath);
  const [linksOpen, setLinksOpen] = useState(false);
  const [note, setNote] = useState<{ text: string; origin?: string; at: number } | null>(null);
  // The hub's handler outlives renders; it reads the system as it is now.
  const systemRef = useRef(system);
  useEffect(() => {
    systemRef.current = system;
  }, [system]);

  const links = useMemo(() => (system ? safely(() => systemLinks(system.members), []) : []), [system]);
  const member = memberOfDoc(system, doc);
  const onMap = !!system && (doc === system.path || doc === systemPath);
  const focused = member && focus ? linksOf(links, member, focus) : [];
  // With nothing in hand: this drawing's elements that have links, to pick one.
  const linkedHere = linkedElements(links, member);

  // Notes from this page (an auto reconcile) and from agents.
  useEffect(() => {
    const onNote = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string; origin?: string }>).detail;
      if (detail?.text) setNote({ ...detail, at: Date.now() });
    };
    window.addEventListener(STRIP_NOTE_EVENT, onNote);
    return () => window.removeEventListener(STRIP_NOTE_EVENT, onNote);
  }, []);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 9000);
    return () => clearTimeout(timer);
  }, [note]);

  // The system's room: an agent's `view:show` lands here.
  const roomPath = system?.path;
  useEffect(() => {
    if (!roomPath) return;
    let live = true;
    let client: ReturnType<typeof createBridgeClient> | null = null;
    let stopJoining: (() => void) | null = null;
    (async () => {
      const { bridgeUrl } = await loadRuntimeConfig();
      if (!live || !bridgeUrl) return;
      client = createBridgeClient({ url: bridgeUrl, role: "web", docId: roomPath, name: "web-system-strip" });
      client.on("view", (env: ViewEnvelope) => {
        const sys = systemRef.current;
        if (!sys) return;
        // Only the system's own drawings: a member named as the system writes it,
        // or by its absolute path. Anything else is not this strip's to open.
        const member = env.member
          ? sys.absOf[env.member] !== undefined
            ? env.member
            : Object.keys(sys.absOf).find((m) => sys.absOf[m] === env.member)
          : undefined;
        if (env.member && !member) {
          setNote({ text: `ignored a view of ${env.member.split("/").pop()}: it is not a member of this system`, origin: env.origin, at: Date.now() });
          return;
        }
        const target = member ? sys.absOf[member] : roomPath;
        openInSystem({ doc: target, system: systemPath, focus: env.focus ?? null });
        // The agent's words are the news; an open Links list would cover them.
        setLinksOpen(false);
        const what = [member ? memberTitle(sys, member) : "the system map", env.focus].filter(Boolean).join(" · ");
        setNote({ text: env.note ? env.note : `showing ${what}`, origin: env.origin, at: Date.now() });
      });
      // The system file itself was written elsewhere (an agent's add_member): read it again.
      client.on("full", () => notifySystemChanged());
      // Joined again after every reconnect: a restarted hub has forgotten the
      // room, and a strip that never re-joins never hears an agent again. No hub,
      // or a refusal: the strip still switches drawings, it just hears no agent.
      stopJoining = stayJoined(client);
    })();
    return () => {
      live = false;
      stopJoining?.();
      client?.disconnect();
    };
  }, [roomPath, systemPath]);

  const go = (target: { member?: string; focus?: string | null }): void => {
    setLinksOpen(false);
    if (!system) return;
    const docPath = target.member ? (system.absOf[target.member] ?? resolveMemberPath(system.path, target.member)) : system.path;
    openInSystem({ doc: docPath, system: systemPath, focus: target.focus ?? null });
  };

  const members = system?.def?.members?.filter((m) => m?.path).map((m) => m.path) ?? [];
  const name = system?.def?.settings?.name ?? (systemPath.split("/").pop() ?? "system").replace(/\.sysdf\.json$/i, "");
  const count = focused.length;

  return (
    <div className="system-strip relative z-50 border-b border-gray-800 bg-gray-950 text-xs text-gray-300">
      <div className="flex h-[var(--strip-h)] items-center gap-1 px-1.5 md:px-2">
        <button
          onClick={() => go({})}
          className={`flex min-w-0 max-w-[30%] shrink-0 items-center gap-1 rounded px-1.5 py-1 md:max-w-[16rem] ${
            onMap ? "bg-blue-950/60 text-blue-200" : "text-gray-300 hover:bg-gray-800"
          }`}
          title={`${systemPath} — the system map`}
        >
          <KindIcon kind="system" size={15} />
          <span className="truncate font-semibold">{name}</span>
        </button>
        <span className="h-4 w-px shrink-0 bg-gray-800" />

        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" aria-label="Members">
          {members.map((m) => {
            const current = m === member;
            const failed = system?.members.find((x) => x.path === m)?.error;
            return (
              <button
                key={m}
                onClick={() => go({ member: m })}
                aria-current={current ? "page" : undefined}
                title={`${memberTitle(system, m)} — ${m}${failed ? ` (cannot be read: ${failed})` : ""}`}
                className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 ${
                  current ? "bg-blue-950/60 text-blue-200" : failed ? "text-red-400 hover:bg-gray-800" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                }`}
              >
                <KindIcon kind={kindOf(system, m)} size={15} />
                <span className={`max-w-[7.5rem] truncate md:max-w-[11rem] ${current ? "" : "hidden md:inline"}`}>{memberTitle(system, m)}</span>
              </button>
            );
          })}
          {!system && <span className="px-1 text-gray-600">loading…</span>}
          {system?.error && <span className="truncate px-1 text-amber-300">{system.error}</span>}
        </nav>

        <button
          onClick={() => setLinksOpen((o) => !o)}
          disabled={!member}
          aria-expanded={linksOpen}
          title={member ? (focus ? `What ${focus} links to in the other drawings` : "Elements of this drawing that link to the others") : "Open a member to follow its links"}
          className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 disabled:opacity-40 ${
            linksOpen ? "bg-blue-950/60 text-blue-200" : "text-gray-300 hover:bg-gray-800"
          }`}
        >
          <KindIcon kind="link" size={15} />
          <span className="hidden sm:inline">Links</span>
          {count > 0 && <span className="rounded-full border border-gray-700 px-1 text-[10px] leading-4 text-gray-300">{count}</span>}
        </button>
      </div>

      {/* The one-line note: over the board, never a row of its own. */}
      {note && !linksOpen && (
        <div
          className="pointer-events-none absolute inset-x-0 top-full flex justify-center px-2 pt-1"
          role="status"
        >
          <span className="max-w-full truncate rounded border border-gray-700 bg-gray-900/95 px-2 py-0.5 text-[11px] text-gray-300 shadow">
            {note.origin ? <span className="text-blue-300">{note.origin}: </span> : null}
            {note.text}
          </span>
        </div>
      )}

      {linksOpen && member && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setLinksOpen(false)} aria-hidden="true" />
          <div className="absolute right-1 top-full z-50 mt-1 max-h-[60vh] w-[min(24rem,calc(100vw-0.5rem))] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-2 shadow-xl">
            {focus && parseFocus(focus) ? (
              <>
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                  <span className="truncate">
                    <span className="text-gray-200">{elementLabel(parseFocus(focus)!)}</span> in {memberTitle(system, member)}
                  </span>
                  <button className="shrink-0 text-gray-500 hover:text-gray-200" onClick={() => openInSystem({ doc: doc!, focus: null })}>
                    clear
                  </button>
                </div>
                {focused.length === 0 && <div className="py-1 text-[11px] text-gray-500">Nothing in the other drawings names it.</div>}
                {focused.map((l, i) => (
                  <button
                    key={i}
                    onClick={() => go({ member: l.other.member, focus: elementFocus(l.other) })}
                    className="flex w-full items-start gap-2 rounded px-1.5 py-1.5 text-left hover:bg-gray-800"
                  >
                    <span className="mt-0.5 text-gray-400">
                      <KindIcon kind={kindOf(system, l.other.member)} size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-gray-200">{l.text}</span>
                      <span className="block truncate text-[10.5px] text-gray-500">
                        {elementLabel(l.other)} · {memberTitle(system, l.other.member)} · {l.rule}
                      </span>
                    </span>
                  </button>
                ))}
              </>
            ) : null}
            {(!focus || !parseFocus(focus)) && (
              <>
                <div className="mb-1 text-[11px] text-gray-500">
                  Elements of {memberTitle(system, member)} that the other drawings name — pick one to follow it.
                </div>
                {linkedHere.length === 0 && <div className="py-1 text-[11px] text-gray-500">None.</div>}
                <div className="flex flex-wrap gap-1">
                  {linkedHere.map(([key, n]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setLinksOpen(true);
                        openInSystem({ doc: doc!, focus: key });
                      }}
                      className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-200 hover:bg-gray-700"
                    >
                      {key} <span className="text-gray-500">{n}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
