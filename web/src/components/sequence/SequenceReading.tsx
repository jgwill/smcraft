"use client";

/**
 * A sequence read as a list — the view a phone opens on (Spec 81).
 *
 * A sequence with seven participants is wider than a phone at any size its
 * words can be read at: the drawing shows two lifelines, and a message between
 * two others is a line whose label sits off the screen (found 2026-10-01 on
 * DiscussionFromChart). Here every message is a row in story order: who sends
 * it to whom, what is said, and what it does (the event it fires, on which
 * machine, the state it leaves, what it carries). Each fragment is a framed
 * group under its heading. Nothing is cut, nothing needs panning, and each
 * participant keeps one colour so a reader can follow who speaks.
 *
 * Read-only: tapping a row selects it, exactly as tapping it in the drawing
 * does, and the host's panel edits it.
 */
import type { SequenceDefinition, SqdMessage } from "@miadi/stateloom-protocol";
import { allMessages } from "@miadi/stateloom-protocol";
import type { SequenceSelection } from "@miadi/stateloom-canvas";

export interface ReadingIssue {
  severity: "error" | "warning";
  text: string;
}

/** Light tints, each above 4.5:1 on gray-900 and gray-950. */
const SPEAKER_COLOURS = [
  "text-sky-300",
  "text-emerald-300",
  "text-amber-300",
  "text-rose-300",
  "text-violet-300",
  "text-cyan-300",
  "text-lime-300",
  "text-orange-300",
];

/** The element id a row carries, so a focus can scroll to it. */
export const readingRowId = (target: SequenceSelection): string => `seq-read-${target.kind}-${target.id}`;

export default function SequenceReading({
  definition,
  selection,
  issues,
  onSelect,
  onShowInDiagram,
}: {
  definition: SequenceDefinition;
  selection: SequenceSelection | null;
  /** Check findings by focus string (`message:9`, `participant:Chart`). */
  issues: ReadonlyMap<string, ReadingIssue[]>;
  onSelect: (target: SequenceSelection) => void;
  onShowInDiagram: (target: SequenceSelection) => void;
}) {
  const colourOf = new Map(definition.participants.map((p, i) => [p.name, SPEAKER_COLOURS[i % SPEAKER_COLOURS.length]]));
  const messages = allMessages(definition);
  const main = messages.filter((m) => m.fragment === null);
  const fragments = (definition.fragments ?? []).map((f, fi) => ({ f, fi, rows: messages.filter((m) => m.fragment === fi) }));
  const isSelected = (kind: SequenceSelection["kind"], id: string) => selection?.kind === kind && selection.id === id;

  const name = (who: string) => <span className={`font-semibold ${colourOf.get(who) ?? "text-gray-300"}`}>{who || "?"}</span>;

  const row = (ref: string, m: SqdMessage) => {
    const target: SequenceSelection = { kind: "message", id: ref };
    const found = issues.get(`message:${ref}`) ?? [];
    const worst = found.some((i) => i.severity === "error") ? "error" : found.length ? "warning" : null;
    const selected = isSelected("message", ref);
    return (
      <li key={ref} id={readingRowId(target)} className="scroll-mt-16 scroll-mb-24">
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          onClick={() => onSelect(target)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(target))}
          className={`flex gap-3 rounded-lg border-l-2 px-3 py-2.5 ${
            selected ? "bg-blue-950/60 ring-1 ring-blue-500/60" : "hover:bg-gray-900"
          } ${worst === "error" ? "border-red-500" : worst === "warning" ? "border-amber-400" : "border-transparent"}`}
        >
          <span className="mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-gray-700 bg-gray-900 px-1 font-mono text-[11px] text-gray-300">
            {ref}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] leading-5 text-gray-400">
              {name(m.from)}
              {m.from === m.to ? (
                <span> to itself</span>
              ) : (
                <>
                  <span className="px-1.5 text-gray-500">{m.reply ? "⇠" : "→"}</span>
                  {name(m.to)}
                </>
              )}
              {m.reply && <span className="ml-2 text-[11px] text-gray-500">reply</span>}
              {m.optional && <span className="ml-2 rounded border border-gray-700 px-1 text-[11px] text-gray-400">optional</span>}
            </div>
            <div className={`mt-0.5 break-words text-[15px] leading-6 ${m.reply ? "text-gray-300" : "text-gray-100"}`}>
              {m.label || <span className="text-gray-500">no label</span>}
            </div>
            {(m.event || m.state || m.carries) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-5">
                {m.event && (
                  <span className="rounded border border-blue-500/50 bg-blue-950/50 px-1.5 font-mono text-blue-200">{m.event}</span>
                )}
                {m.event && m.machine && <span className="text-gray-400">on {m.machine}</span>}
                {m.state && <span className="text-emerald-300">→ {m.state}</span>}
                {m.carries && <span className="text-gray-400">carries {m.carries}</span>}
              </div>
            )}
            {found.map((i, n) => (
              <p key={n} className={`mt-1.5 text-[12px] leading-5 ${i.severity === "error" ? "text-red-300" : "text-amber-300"}`}>
                {i.text}
              </p>
            ))}
            {selected && (
              <button
                className="mt-2 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-[12px] text-gray-200"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowInDiagram(target);
                }}
              >
                Show in the diagram
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-10">
        {definition.participants.length > 0 && (
          <ul className="mb-4 flex flex-wrap gap-2" aria-label="Participants">
            {definition.participants.map((p) => {
              const target: SequenceSelection = { kind: "participant", id: p.name };
              const kind = p.actor ? "actor" : p.object ? "object" : p.service ? "service" : "";
              const found = issues.get(`participant:${p.name}`) ?? [];
              return (
                <li key={p.name} id={readingRowId(target)}>
                  <button
                    onClick={() => onSelect(target)}
                    aria-pressed={isSelected("participant", p.name)}
                    title={found.map((i) => i.text).join("\n") || undefined}
                    className={`rounded-full border px-3 py-1 text-[13px] ${
                      isSelected("participant", p.name) ? "border-blue-500 bg-blue-950/60" : "border-gray-700 bg-gray-900"
                    } ${found.length ? "ring-1 ring-amber-400/70" : ""}`}
                  >
                    {name(p.name)}
                    {kind && <span className="ml-1.5 text-[11px] text-gray-400">{kind}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {messages.length === 0 && (
          <p className="text-sm text-gray-400">No messages yet — add them in the panel, or let an agent write the scenario.</p>
        )}

        <ol className="flex flex-col gap-1">{main.map(({ ref, message }) => row(ref, message))}</ol>

        {fragments.map(({ f, fi, rows }) => (
          <section key={fi} className="mt-5 rounded-xl border border-indigo-500/50 bg-indigo-950/20 p-1.5">
            <header className="px-3 pb-1.5 pt-2">
              <div className="text-[12px] text-indigo-200">
                <span className="font-semibold uppercase tracking-wide">{f.kind}</span>
                <span className="text-indigo-300"> · after {f.after}</span>
              </div>
              <div className="mt-0.5 break-words text-[14px] leading-5 text-gray-100">{f.label}</div>
            </header>
            {rows.length === 0 ? (
              <p className="px-3 pb-2 text-[12px] text-gray-400">No messages in this fragment.</p>
            ) : (
              <ol className="flex flex-col gap-1">{rows.map(({ ref, message }) => row(ref, message))}</ol>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
