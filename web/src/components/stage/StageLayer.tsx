"use client";

/**
 * The stage on one board (Spec 83): mounted by each workspace beside its
 * canvas, told the board's viewport and where its elements are.
 *
 * - What the step on stage lights in this drawing is drawn here, and the view
 *   fits it (after the workspace has centred the step's focus, so the wider
 *   view wins).
 * - This drawing's marks: pinned on the board, listed in a panel, read and
 *   answered in a thread. ✎ turns marking on — a tap marks an element, a drag
 *   marks an area and what is inside it — and the composer asks what the agent
 *   should know. Answer on the caption opens the composer on what is lit.
 * - What the person is looking at goes back to the agents through the stage.
 *
 * The sidecar is written through /api/marks; the hub is told after.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MarkComposer, MarkThread, MarksPanel, StageOverlay, type MarkDraft } from "@miadi/stateloom-canvas";
import {
  boxesOf,
  fitToBoxes,
  formatReview,
  screenToWorld,
  type DocKind,
  type ElementBox,
  type Mark,
  type MarkKind,
  type Viewport,
} from "@miadi/stateloom-protocol";
import { useStageContext } from "./StageProvider";
import { urlParam } from "@/lib/systemParam";

export interface StageLayerProps {
  /** The drawing this board shows, absolute. Null until the workspace has read it. */
  docPath: string | null;
  kind: DocKind;
  viewport: Viewport;
  setViewport: (vp: Viewport) => void;
  boxes: readonly ElementBox[];
  boardRef: RefObject<HTMLElement | null>;
  /** The element in hand (`focus=`). */
  focus?: string | null;
  /** The machine level on the board: the state whose children are drawn. */
  level?: string;
  /**
   * The step lights something this board cannot see yet — a state on another
   * level, a sequence shown as a list. The workspace brings it on.
   */
  onReveal?: (focuses: readonly string[]) => void;
}

const quietButton =
  "flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border border-gray-700 bg-gray-900/90 px-2 text-sm text-gray-200 shadow-lg backdrop-blur hover:bg-gray-800";

async function postMarks(docPath: string, body: unknown): Promise<{ marks: Mark[]; change: { action: "add" | "reply" | "resolve" | "reopen" | "remove"; id: string } }> {
  const r = await fetch(`/api/marks?doc=${encodeURIComponent(docPath)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error ?? `the marks could not be written (${r.status})`);
  return data;
}

export default function StageLayer({ docPath, kind, viewport, setViewport, boxes, boardRef, focus = null, level, onReveal }: StageLayerProps) {
  const stage = useStageContext();
  const [marks, setMarks] = useState<Mark[]>([]);
  const [marking, setMarking] = useState(false);
  const [draft, setDraft] = useState<(MarkDraft & { listen?: boolean }) | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── This drawing's marks ─────────────────────────────────────────────
  const load = useCallback(() => {
    if (!docPath) return;
    fetch(`/api/marks?doc=${encodeURIComponent(docPath)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && Array.isArray(data.marks) && setMarks(data.marks))
      .catch(() => {});
  }, [docPath]);
  useEffect(() => {
    setMarks([]);
    setSelected(null);
    setDraft(null);
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);
  useEffect(
    () =>
      stage?.onMarks((e) => {
        if (docPath && e.docId === docPath && Array.isArray(e.marks)) setMarks(e.marks);
      }),
    [stage, docPath],
  );

  const write = async (body: unknown): Promise<boolean> => {
    if (!docPath) return false;
    setBusy(true);
    setError(null);
    try {
      const r = await postMarks(docPath, body);
      setMarks(r.marks);
      stage?.sendMarks({ docId: docPath, marks: r.marks, change: r.change });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ── What the step lights here ────────────────────────────────────────
  const lit = stage?.lit ?? null;
  const litHere = lit && (!lit.doc || lit.doc === docPath) ? lit : null;
  const spotlight = litHere?.spotlight;
  const region = litHere?.region ?? null;
  const fitted = useRef(-1);
  const revealed = useRef(-1);
  const refit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const litBoxes = useMemo(() => (spotlight?.length ? boxesOf(boxes, spotlight) : []), [boxes, spotlight]);
  useEffect(() => {
    if (!litHere || fitted.current === litHere.nonce) return;
    const targets = [...litBoxes, ...(region ? [region] : [])];
    if (!targets.length) {
      // Lit, but not drawn on this board as it stands: ask the workspace once.
      if (spotlight?.length && revealed.current !== litHere.nonce) {
        revealed.current = litHere.nonce;
        onReveal?.(spotlight);
      }
      return;
    }
    fitted.current = litHere.nonce;
    const fit = (): void => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect?.width) return;
      // The caption covers the bottom of the board: fit into what it leaves.
      const caption = document.querySelector(".stage-caption-host .slc-stage-caption")?.getBoundingClientRect();
      const covered = caption && caption.top < rect.bottom ? Math.max(0, rect.bottom - caption.top + 8) : 0;
      const height = Math.max(rect.height * 0.4, rect.height - covered);
      setViewport(fitToBoxes(targets, rect.width, height, { padding: 48, maxScale: 1 }));
    };
    fit();
    // Again after the workspace's own fit or centring has landed. Not cleared
    // when the board's boxes move under it (a live update arrives just after a
    // drawing opens) — only when the layer goes.
    if (refit.current) clearTimeout(refit.current);
    refit.current = setTimeout(fit, 520);
  }, [litHere, litBoxes, region, spotlight, boardRef, setViewport, onReveal]);
  useEffect(() => () => {
    if (refit.current) clearTimeout(refit.current);
  }, []);

  // Answer on the caption: a composer on what is lit (or the element in hand).
  const answered = useRef(stage?.answerNonce ?? 0);
  useEffect(() => {
    if (!stage || stage.answerNonce === answered.current) return;
    answered.current = stage.answerNonce;
    const elements = spotlight?.length ? [...spotlight] : litHere?.focus ? [litHere.focus] : focus ? [focus] : [];
    setPanel(false);
    setSelected(null);
    setDraft({ elements, region: region ?? undefined, listen: !!stage.listener });
  }, [stage, spotlight, litHere, focus, region]);

  // ── What the person is looking at ────────────────────────────────────
  const report = stage?.report;
  useEffect(() => {
    if (!report || !docPath) return;
    const rect = boardRef.current?.getBoundingClientRect();
    const a = screenToWorld(viewport, { x: 0, y: 0 });
    const b = rect ? screenToWorld(viewport, { x: rect.width, y: rect.height }) : a;
    report({
      doc: docPath,
      kind,
      system: urlParam("system") ?? undefined,
      focus,
      ...(rect?.width ? { visible: { x: Math.round(a.x), y: Math.round(a.y), width: Math.round(b.x - a.x), height: Math.round(b.y - a.y) } } : {}),
    });
  }, [report, docPath, kind, focus, viewport, boardRef]);

  const copy = (): void => {
    if (!docPath) return;
    const text = formatReview(stage?.lastReport() ?? null, [{ doc: docPath, marks: marks.filter((m) => m.status !== "resolved") }]);
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!docPath) return null;
  const waiting = marks.filter((m) => m.status === "open" && m.author.role === "person").length;
  const questions = marks.filter((m) => m.status === "open" && m.author.role === "agent").length;
  const selectedMark = marks.find((m) => m.id === selected) ?? null;

  return (
    <>
      <StageOverlay
        viewport={viewport}
        boxes={boxes}
        spotlight={spotlight}
        region={region}
        marks={marks}
        selectedMark={selected}
        onSelectMark={(id) => {
          setDraft(null);
          setPanel(false);
          setSelected((s) => (s === id ? null : id));
        }}
        marking={marking}
        onDraft={(d) => {
          setMarking(false);
          setSelected(null);
          setPanel(false);
          setDraft(d);
        }}
        draft={draft}
      />

      <div className="stage-board-controls">
        <button
          type="button"
          className={`${quietButton} ${marking ? "!border-amber-400 !text-amber-300" : ""}`}
          aria-pressed={marking}
          onClick={() => {
            setDraft(null);
            setMarking((m) => !m);
          }}
          title={marking ? "Marking: tap an element, or drag around several. Tap ✎ again to stop." : "Mark something for the agent — tap an element or drag around several"}
        >
          ✎{marking && <span className="text-xs">marking</span>}
        </button>
        <button
          type="button"
          className={quietButton}
          aria-expanded={panel}
          onClick={() => {
            setDraft(null);
            setSelected(null);
            setPanel((p) => !p);
          }}
          title="Marks on this drawing"
        >
          💬
          {waiting + questions > 0 && <span className="text-xs text-amber-300">{waiting + questions}</span>}
        </button>
      </div>

      {(draft || selectedMark || panel) && (
        <div className="stage-board-card">
          {draft ? (
            <MarkComposer
              key={`${draft.elements.join(",")}|${draft.region ? JSON.stringify(draft.region) : ""}`}
              elements={draft.elements}
              region={draft.region}
              author={stage?.author ?? ""}
              onAuthorChange={stage?.setAuthor}
              listener={stage?.listener}
              listenAtOnce={!!draft.listen}
              busy={busy}
              error={error}
              onCancel={() => {
                setDraft(null);
                setError(null);
              }}
              onSubmit={async ({ text, kind: markKind, author }: { text: string; kind: MarkKind; author: string }) => {
                const name = author || "someone";
                const ok = await write({
                  action: "add",
                  mark: { text, kind: markKind, elements: draft.elements, region: draft.region, level, author: { name } },
                });
                if (ok) setDraft(null);
              }}
            />
          ) : selectedMark ? (
            <MarkThread
              mark={selectedMark}
              number={marks.indexOf(selectedMark) + 1}
              listener={stage?.listener}
              busy={busy}
              error={error}
              onClose={() => setSelected(null)}
              onReply={(text) => void write({ action: "reply", id: selectedMark.id, text, author: { name: stage?.author || "someone" } })}
              onResolve={() => void write({ action: "resolve", id: selectedMark.id })}
              onReopen={() => void write({ action: "reopen", id: selectedMark.id })}
              onRemove={async () => {
                if (await write({ action: "remove", id: selectedMark.id })) setSelected(null);
              }}
            />
          ) : (
            <MarksPanel
              marks={marks}
              selected={selected}
              onSelect={(id) => {
                setPanel(false);
                setSelected(id);
              }}
              onCopy={copy}
              copied={copied}
              onClose={() => setPanel(false)}
            />
          )}
        </div>
      )}
    </>
  );
}

/**
 * For a board that is not drawn right now (the sequence's list view): when the
 * step on stage lights something in this drawing — a spotlight or an area, not
 * a focus, which the list shows by itself — ask for the drawing.
 */
export function StageReveal({ docPath, onReveal }: { docPath: string | null; onReveal: () => void }) {
  const stage = useStageContext();
  const lit = stage?.lit ?? null;
  const done = useRef(-1);
  useEffect(() => {
    if (!lit || done.current === lit.nonce) return;
    if (lit.doc && lit.doc !== docPath) return;
    if (!lit.spotlight?.length && !lit.region) return;
    done.current = lit.nonce;
    onReveal();
  }, [lit, docPath, onReveal]);
  return null;
}
