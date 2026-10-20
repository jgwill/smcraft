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
 * - Who answers a mark: under the composer, the panel, and a thread whose last
 *   word is the person's, one line says whether a Mia seat listens in the
 *   drawing's chronicle episode (Spec 84's presence). No line when the drawing
 *   is not in an episode or no companion is configured.
 * - When an agent answers: the speech bubble counts what waits on the person
 *   ("1 for you") before what waits on the agent (quiet); a thread with an
 *   agent's word not yet opened is "new" on its pin and first in the list
 *   (read state per drawing in this browser); and a `marks:changed` carrying
 *   the answer shows one line by the controls for a few seconds ("Mia answered
 *   mark 3"), which opens the thread when tapped. Nothing takes focus and no
 *   card opens by itself.
 * - Pins: on opening a drawing with open marks and nothing lit, the view frames
 *   the marks (never below a legible scale); pins stay inside the board, fan out
 *   when they share a point, and never sit under the board's buttons or under the
 *   caption (the phone's sheet), where they could not be tapped.
 * - On a phone the cards open in the sheet at the bottom of the board, in the
 *   caption's place (StageProvider); the Talk conversation and a card take turns.
 * - Elements are named as the person sees them; a board that knows words only it
 *   can give (a sequence's messages) passes `labels`.
 * - The Talk dock's list of marks opens a mark here (`requestMark`): the thread
 *   opens and the view frames its mark.
 *
 * The sidecar is written through /api/marks; the hub is told after.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  fitLegibly,
  markAnchor,
  MarkComposer,
  MarkIcon,
  MarkNotice,
  MarksIcon,
  MarkThread,
  MarksPanel,
  StageOverlay,
  useMarksRead,
  type MarkDraft,
} from "@miadi/stateloom-canvas";
import {
  agentWordIn,
  agentWordText,
  boxesOf,
  markCounts,
  unreadMarks,
  formatReview,
  screenToWorld,
  type Box,
  type DocKind,
  type ElementBox,
  type Mark,
  type MarkKind,
  type Viewport,
} from "@miadi/stateloom-protocol";
import { useStageContext } from "./StageProvider";
import { episodeOf } from "./CompanionLayer";
import { presenceLine, useEpisodePresence } from "./useEpisodePresence";
import { urlParam } from "@/lib/systemParam";
import { MARK_REQUEST_EVENT, clearMarkRequest, markRequested } from "@/lib/markRequest";

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
  /** Words for elements only this board can name (a sequence's messages), by focus key. */
  labels?: Readonly<Record<string, string>>;
}

/** How long the line that says an agent answered stays by the controls. */
const NOTICE_MS = 7000;

const quietButton =
  "stage-quiet-btn flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border border-gray-700 bg-gray-900/90 px-2 text-sm text-gray-200 shadow-lg backdrop-blur hover:bg-gray-800";

/** How much of the board's bottom the caption, or the phone's sheet, covers. */
function coveredBottom(rect: DOMRect): number {
  let top = Infinity;
  for (const sel of [".stage-sheet", ".stage-caption-host .slc-stage-caption"]) {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    if (r && r.height > 0 && r.top < rect.bottom) top = Math.min(top, r.top);
  }
  return top === Infinity ? 0 : Math.max(0, rect.bottom - top + 8);
}

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

export default function StageLayer({ docPath, kind, viewport, setViewport, boxes, boardRef, focus = null, level, onReveal, labels }: StageLayerProps) {
  const stage = useStageContext();
  const [marks, setMarks] = useState<Mark[]>([]);
  const [marking, setMarking] = useState(false);
  const [draft, setDraft] = useState<(MarkDraft & { listen?: boolean }) | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const { read, markRead } = useMarksRead(docPath);

  // ── The drawing on this board, for the caption ──────────────────────
  const setBoard = stage?.setBoard;
  useEffect(() => {
    if (!setBoard || !docPath) return;
    setBoard(docPath);
    return () => setBoard(null);
  }, [setBoard, docPath]);

  /** Frame `targets` in what the caption (or the phone's sheet) leaves of the board, legibly. */
  const frame = useCallback(
    (targets: readonly Box[], opts: { floor?: number } = {}) => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect?.width || !targets.length) return;
      const covered = coveredBottom(rect);
      const height = Math.max(rect.height * 0.4, rect.height - covered);
      setViewport(fitLegibly(targets, rect.width, height, { padding: 48, maxScale: 1, floor: opts.floor ?? 0.2 }));
    },
    [boardRef, setViewport],
  );

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
        if (!docPath || e.docId !== docPath || !Array.isArray(e.marks)) return;
        setMarks(e.marks);
        // An agent's answer (or question) reaches a person who is not reading that thread: one line, for a while.
        const word = agentWordIn(e);
        if (!word || word.mark.id === selectedRef.current) return;
        setNotice({ id: word.mark.id, text: agentWordText(word) });
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
      }),
    [stage, docPath],
  );
  useEffect(() => {
    setNotice(null);
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [docPath]);

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
    // The caption covers the bottom of the board: fit into what it leaves.
    const fit = (): void => frame(targets);
    fit();
    // Again after the workspace's own fit or centring has landed. Not cleared
    // when the board's boxes move under it (a live update arrives just after a
    // drawing opens) — only when the layer goes.
    if (refit.current) clearTimeout(refit.current);
    refit.current = setTimeout(fit, 520);
  }, [litHere, litBoxes, region, spotlight, frame, onReveal]);
  useEffect(() => () => {
    if (refit.current) clearTimeout(refit.current);
  }, []);

  // ── Opening a drawing with marks: the view frames them ──────────────
  // Once per drawing, when nothing is lit here (a lit step decides the view): what the marks
  // point at on this level, and the element in hand. Looked at again after the workspace's
  // own first view and this browser's remembered view have landed, and framed again only
  // if that view hides some of them.
  const marksFramed = useRef<string | null>(null);
  const marksRefit = useRef<ReturnType<typeof setTimeout>[]>([]);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  useEffect(() => {
    if (!docPath || marksFramed.current === docPath) return;
    if (litHere) {
      marksFramed.current = docPath;
      return;
    }
    const open = marks.filter((m) => m.status !== "resolved" && (!m.level || !level || m.level === level));
    if (!open.length || !boxes.length) return;
    // Marks that name elements wait for the board to draw them (a board still showing the
    // layout it had before this drawing arrived draws none of them); an area stands alone.
    const named = open.filter((m) => m.elements?.length);
    const drawn = named.filter((m) => boxesOf(boxes, m.elements!).length > 0);
    if (named.length && !drawn.length) return;
    const anchors = [...drawn, ...open.filter((m) => !m.elements?.length)].map((m) => markAnchor(m, boxes)).filter((b): b is Box => !!b);
    marksFramed.current = docPath;
    if (!anchors.length) return;
    const targets = [...anchors, ...(focus ? boxesOf(boxes, [focus]) : [])];
    const fitIfHidden = (): void => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect?.width) return;
      const vp = viewportRef.current;
      const a = screenToWorld(vp, { x: 0, y: 0 });
      const b = screenToWorld(vp, { x: rect.width, y: rect.height - coveredBottom(rect) });
      const seen = targets.every((t) => t.x >= a.x && t.y >= a.y && t.x + t.width <= b.x && t.y + t.height <= b.y);
      if (!seen) frame(targets, { floor: 0.55 });
    };
    fitIfHidden();
    for (const t of marksRefit.current) clearTimeout(t);
    marksRefit.current = [setTimeout(fitIfHidden, 520), setTimeout(fitIfHidden, 1400)];
  }, [docPath, marks, boxes, litHere, level, focus, frame, boardRef]);
  useEffect(() => () => {
    for (const t of marksRefit.current) clearTimeout(t);
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

  // ── Who answers a mark ───────────────────────────────────────────────
  const episode = stage?.companion ? episodeOf(docPath) : null;
  const presence = useEpisodePresence(episode, !!(draft || selected || panel));
  const note = presenceLine(presence, episode);

  // ── What waits on whom, and what is new ─────────────────────────────
  const unread = useMemo(() => unreadMarks(marks, read).map((m) => m.id), [marks, read]);
  const counts = markCounts(marks, read);
  const selectedMark = marks.find((m) => m.id === selected) ?? null;
  // A thread on screen is read, and stays read as replies land in it.
  const selectedReplies = selectedMark?.replies?.length ?? 0;
  useEffect(() => {
    if (selectedMark) markRead(selectedMark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMark?.id, selectedReplies, markRead]);
  const openThread = useCallback((id: string): void => {
    setDraft(null);
    setPanel(false);
    setMarking(false);
    setSelected(id);
    setNotice(null);
  }, []);

  // ── A mark asked for from outside the board (the Talk dock's list) ──
  useEffect(() => {
    const take = (): void => {
      const id = markRequested(docPath);
      const mark = id ? marks.find((m) => m.id === id) : null;
      if (!mark) return;
      clearMarkRequest();
      openThread(mark.id);
      const at = markAnchor(mark, boxes);
      if (at) setTimeout(() => frame([at], { floor: 0.55 }), 60);
    };
    take();
    window.addEventListener(MARK_REQUEST_EVENT, take);
    return () => window.removeEventListener(MARK_REQUEST_EVENT, take);
  }, [docPath, marks, boxes, openThread, frame]);

  // ── The phone's sheet: a card holds it in the caption's place ───────
  const cardOpen = !!(draft || selectedMark || panel);
  const claimSheet = stage?.claimSheet;
  const releaseSheet = stage?.releaseSheet;
  useEffect(() => {
    if (cardOpen) claimSheet?.("card");
    else releaseSheet?.("card");
  }, [cardOpen, claimSheet, releaseSheet]);
  useEffect(() => () => releaseSheet?.("card"), [releaseSheet]);
  // The conversation took the sheet: the card gives way to it.
  const narrow = !!stage?.narrow;
  const sheetOwner = stage?.sheet ?? null;
  const [seenOwner, setSeenOwner] = useState(sheetOwner);
  if (seenOwner !== sheetOwner) {
    setSeenOwner(sheetOwner);
    if (narrow && sheetOwner === "talk") {
      setDraft(null);
      setSelected(null);
      setPanel(false);
    }
  }

  // ── The board's buttons: no pin sits under them ─────────────────────
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [controlsBox, setControlsBox] = useState<Box | null>(null);
  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;
    const measure = (): void => {
      const next = { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
      setControlsBox((b) => (b && b.x === next.x && b.y === next.y && b.width === next.width && b.height === next.height ? b : next));
    };
    measure();
    window.addEventListener("resize", measure);
    if (typeof ResizeObserver === "undefined") return () => window.removeEventListener("resize", measure);
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [docPath]);
  // ── And none under the caption, or the phone's sheet: what it covers of the board ──
  const [coverBox, setCoverBox] = useState<Box | null>(null);
  const shownNow = stage?.shown ?? null;
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const find = () => document.querySelector(".stage-sheet") ?? document.querySelector(".stage-caption-host .slc-stage-caption");
    let frameId = 0;
    const measure = (): void => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const b = board.getBoundingClientRect();
        const r = find()?.getBoundingClientRect();
        const next = r && r.height > 0 && r.top < b.bottom ? { x: r.left - b.left, y: r.top - b.top, width: r.width, height: Math.min(r.bottom, b.bottom) - r.top } : null;
        setCoverBox((c) => (c && next && c.x === next.x && c.y === next.y && c.width === next.width && c.height === next.height ? c : next));
      });
    };
    measure();
    const el = find();
    const watch = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (el) watch?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frameId);
      watch?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [boardRef, shownNow, cardOpen, sheetOwner, narrow, docPath]);
  const avoid = useMemo(() => [controlsBox, coverBox].filter((b): b is Box => !!b), [controlsBox, coverBox]);

  if (!docPath) return null;

  return (
    <>
      <StageOverlay
        viewport={viewport}
        boxes={boxes}
        spotlight={spotlight}
        region={region}
        marks={marks}
        unread={unread}
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
          setNotice(null);
          setDraft(d);
        }}
        draft={draft}
        avoid={avoid}
      />

      <div className="stage-board-controls" ref={controlsRef}>
        {notice && (
          <MarkNotice className="stage-board-notice" onOpen={() => openThread(notice.id)} onDismiss={() => setNotice(null)}>
            {notice.text}
          </MarkNotice>
        )}
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
          <MarkIcon />
          {marking && <span className="text-xs">marking</span>}
        </button>
        <button
          type="button"
          className={quietButton}
          aria-expanded={panel}
          onClick={() => {
            setDraft(null);
            setSelected(null);
            setNotice(null);
            setPanel((p) => !p);
          }}
          title={`Marks on this drawing${counts.forYou ? ` · ${counts.forYou} for you` : ""}${counts.forAgent ? ` · ${counts.forAgent} waiting on the agent` : ""}`}
          aria-label={`Marks on this drawing: ${counts.forYou} for you${counts.unread ? ` (${counts.unread} new)` : ""}, ${counts.forAgent} waiting on the agent`}
        >
          <MarksIcon />
          {counts.forYou > 0 && (
            <span className={`stage-for-you${counts.unread ? " stage-for-you--new" : ""}`}>
              {counts.forYou} for you
            </span>
          )}
          {counts.forAgent > 0 && <span className="text-xs text-gray-400">{counts.forAgent}</span>}
        </button>
      </div>

      {marking && !draft && !notice && (
        <div className="stage-board-hint" role="status">
          Tap an element, or drag around several, to say something about it.
        </div>
      )}

      {cardOpen && (() => {
        const card = draft ? (
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
              note={note}
              labels={labels}
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
              note={note}
              labels={labels}
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
              unread={unread}
              selected={selected}
              onSelect={(id) => {
                setPanel(false);
                setSelected(id);
              }}
              onCopy={copy}
              copied={copied}
              note={note}
              labels={labels}
              onClose={() => setPanel(false)}
            />
          );
        return narrow && stage?.sheetBody ? createPortal(card, stage.sheetBody) : <div className="stage-board-card">{card}</div>;
      })()}
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
