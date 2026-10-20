/**
 * The cards a person writes and reads marks in (Spec 83).
 *
 * - `<MarkComposer>`: what was pointed at, and a box to say something about
 *   it — typed, or spoken when the host hands it something that listens.
 * - `<MarkThread>`: one mark and its replies; reply, resolve, reopen, remove.
 * - `<MarksPanel>`: every mark on the drawing, the ones with an agent's word
 *   not yet read first (marked "new"), and the button that copies them as a
 *   review for an agent.
 * - `<MarkNotice>`: one line near the board's controls when an agent answers
 *   ("Mia answered mark 3"); a tap opens that thread. It takes no focus.
 *
 * Props in, callbacks out, as the canvases: the host writes the sidecar and
 * tells the hub. A host that knows who will answer says so in `note`: one quiet
 * line under the card ("Mia is listening in episode 412: she answers here"). The listener is any object shaped like
 * `@miadi/stateloom-react`'s `browserDictation()`, so this package needs no
 * socket and no speech code of its own.
 */
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { MARK_KINDS, lastWordOf, markAnchorText, type Box, type Mark, type MarkKind } from "@miadi/stateloom-protocol";
import { themeStyle, type CanvasTheme } from "./theme.js";
import { CloseIcon, MicIcon } from "./icons.js";

/** Something that turns speech into words (`browserDictation()`). */
export interface ListenerLike {
  start(onText: (text: string, final: boolean) => void, onEnd?: (error?: string) => void): void;
  stop(): void;
}

const KIND_LABEL: Record<MarkKind, string> = {
  comment: "Comment",
  question: "Question",
  looks_good: "Looks good",
  delete: "Should go",
};

function useListening(listener: ListenerLike | null | undefined, onText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const base = useRef("");
  useEffect(() => () => listener?.stop(), [listener]);
  const toggle = (current: string): void => {
    if (!listener) return;
    if (listening) {
      listener.stop();
      setListening(false);
      return;
    }
    base.current = current ? `${current.trimEnd()} ` : "";
    setListening(true);
    listener.start(
      (heard) => onText(base.current + heard),
      () => setListening(false),
    );
  };
  return { listening, toggle };
}

function Anchor({ elements, region }: { elements?: readonly string[]; region?: Box }) {
  if (!elements?.length && !region) return <span className="slc-stage-chip slc-stage-chip--quiet">the drawing</span>;
  return (
    <>
      {elements?.map((e) => (
        <span key={e} className="slc-stage-chip">
          {e}
        </span>
      ))}
      {region && !elements?.length && <span className="slc-stage-chip slc-stage-chip--quiet">an area</span>}
    </>
  );
}

/** Who will answer, as the host knows it: one muted line, nothing when the host has nothing to say. */
function Note({ children }: { children?: ReactNode }) {
  if (children === undefined || children === null || children === false || children === "") return null;
  return (
    <div className="slc-stage-card-note" role="status">
      {children}
    </div>
  );
}

/** A mouse or trackpad: the composer may take focus without raising a keyboard. */
function finePointer(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
  } catch {
    return false;
  }
}

export interface MarkComposerProps {
  elements: readonly string[];
  region?: Box;
  /** The name marks are signed with. Empty: the composer asks for one. */
  author: string;
  onAuthorChange?: (name: string) => void;
  /** `author` is the name the mark is signed with: the one given, or the one typed here. */
  onSubmit: (mark: { text: string; kind: MarkKind; author: string }) => void;
  onCancel: () => void;
  listener?: ListenerLike | null;
  /** Start listening as soon as it opens (the person pressed Answer by voice). */
  listenAtOnce?: boolean;
  busy?: boolean;
  error?: string | null;
  placeholder?: string;
  /** Who will answer the mark, from the host: one quiet line under the card. */
  note?: ReactNode;
  theme?: Partial<CanvasTheme>;
  className?: string;
  style?: CSSProperties;
}

export function MarkComposer({
  elements,
  region,
  author,
  onAuthorChange,
  onSubmit,
  onCancel,
  listener,
  listenAtOnce = false,
  busy = false,
  error,
  placeholder = "What should the agent know about this?",
  note,
  theme,
  className,
  style,
}: MarkComposerProps) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<MarkKind>("comment");
  const [name, setName] = useState(author);
  const { listening, toggle } = useListening(listener, setText);
  const area = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (listenAtOnce && listener) toggle("");
    // On a phone, focusing raises the keyboard over the board before the person
    // asked to type: the box takes focus by itself only under a fine pointer,
    // or when they pressed Answer (by voice, where nothing listens).
    else if (listenAtOnce || finePointer()) area.current?.focus();
    // Once, when the composer opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e?: FormEvent): void => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    if (listening) listener?.stop();
    const signed = author || name.trim();
    if (!author && signed) onAuthorChange?.(signed);
    onSubmit({ text: text.trim(), kind, author: signed });
  };

  return (
    <form
      className={`slc-stage-card slc-stage-composer${className ? ` ${className}` : ""}`}
      style={{ ...themeStyle(theme), ...style }}
      onSubmit={submit}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="slc-stage-card-anchor">
        <span className="slc-stage-card-label">On</span>
        <Anchor elements={elements} region={region} />
      </div>
      <textarea
        ref={area}
        className="slc-stage-input slc-stage-textarea"
        value={text}
        placeholder={listening ? "Listening…" : placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") onCancel();
        }}
        rows={3}
      />
      {!author && (
        <input
          className="slc-stage-input"
          value={name}
          placeholder="Your name (signs your marks)"
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <div className="slc-stage-card-row">
        <select className="slc-stage-input slc-stage-select" value={kind} onChange={(e) => setKind(e.target.value as MarkKind)} aria-label="Kind of mark">
          {MARK_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        {listener && (
          <button
            type="button"
            className={`slc-stage-btn${listening ? " slc-stage-btn--live" : ""}`}
            onClick={() => toggle(text)}
            aria-pressed={listening}
            title={listening ? "Stop listening" : "Speak instead of typing"}
          >
            <MicIcon />
          </button>
        )}
        <span className="slc-stage-spacer" />
        <button type="button" className="slc-stage-btn slc-stage-btn--quiet" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="slc-stage-btn slc-stage-btn--main" disabled={!text.trim() || busy || (!author && !name.trim())}>
          {busy ? "Saving…" : "Mark"}
        </button>
      </div>
      <Note>{note}</Note>
      {error && <div className="slc-stage-card-error">{error}</div>}
    </form>
  );
}

export interface MarkThreadProps {
  mark: Mark;
  /** Its number on the board. */
  number?: number;
  onReply?: (text: string) => void;
  onResolve?: () => void;
  onReopen?: () => void;
  onRemove?: () => void;
  onClose: () => void;
  listener?: ListenerLike | null;
  busy?: boolean;
  error?: string | null;
  /**
   * Who will answer, from the host. Shown under the thread only while it waits on an
   * agent: the last word is a person's and the mark is not resolved.
   */
  note?: ReactNode;
  theme?: Partial<CanvasTheme>;
  className?: string;
  style?: CSSProperties;
}

export function MarkThread({
  mark,
  number,
  onReply,
  onResolve,
  onReopen,
  onRemove,
  onClose,
  listener,
  busy = false,
  error,
  note,
  theme,
  className,
  style,
}: MarkThreadProps) {
  const [reply, setReply] = useState("");
  const { listening, toggle } = useListening(listener, setReply);
  const send = (e?: FormEvent): void => {
    e?.preventDefault();
    if (!reply.trim() || busy) return;
    if (listening) listener?.stop();
    onReply?.(reply.trim());
    setReply("");
  };
  return (
    <div
      className={`slc-stage-card slc-stage-thread${className ? ` ${className}` : ""}`}
      style={{ ...themeStyle(theme), ...style }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="slc-stage-card-row">
        {number !== undefined && <span className={`slc-stage-pin slc-stage-pin--inline slc-stage-pin--${mark.status === "resolved" ? "resolved" : mark.status}`}>{number}</span>}
        <span className="slc-stage-card-label">
          {KIND_LABEL[mark.kind]} · {mark.status}
        </span>
        <span className="slc-stage-spacer" />
        <button type="button" className="slc-stage-btn slc-stage-btn--quiet" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>
      <div className="slc-stage-card-anchor">
        <Anchor elements={mark.elements} region={mark.region} />
      </div>
      <ol className="slc-stage-thread-list">
        <li className={`slc-stage-said slc-stage-said--${mark.author.role}`}>
          <span className="slc-stage-said-who">{mark.author.name}</span>
          <span className="slc-stage-said-text">{mark.text}</span>
        </li>
        {(mark.replies ?? []).map((r, i) => (
          <li key={i} className={`slc-stage-said slc-stage-said--${r.author.role}`}>
            <span className="slc-stage-said-who">{r.author.name}</span>
            <span className="slc-stage-said-text">{r.text}</span>
          </li>
        ))}
      </ol>
      {mark.status !== "resolved" && lastWordOf(mark) === "person" && <Note>{note}</Note>}
      {onReply && (
        <form className="slc-stage-card-row" onSubmit={send}>
          <input
            className="slc-stage-input slc-stage-grow"
            value={reply}
            placeholder={listening ? "Listening…" : "Reply…"}
            onChange={(e) => setReply(e.target.value)}
          />
          {listener && (
            <button type="button" className={`slc-stage-btn${listening ? " slc-stage-btn--live" : ""}`} onClick={() => toggle(reply)} aria-pressed={listening} title="Speak the reply">
              <MicIcon />
            </button>
          )}
          <button type="submit" className="slc-stage-btn slc-stage-btn--main" disabled={!reply.trim() || busy}>
            Reply
          </button>
        </form>
      )}
      <div className="slc-stage-card-row">
        {mark.status === "resolved"
          ? onReopen && (
              <button type="button" className="slc-stage-btn" onClick={onReopen}>
                Reopen
              </button>
            )
          : onResolve && (
              <button type="button" className="slc-stage-btn" onClick={onResolve}>
                Resolve
              </button>
            )}
        <span className="slc-stage-spacer" />
        {onRemove && (
          <button type="button" className="slc-stage-btn slc-stage-btn--danger" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {error && <div className="slc-stage-card-error">{error}</div>}
    </div>
  );
}

export interface MarksPanelProps {
  marks: readonly Mark[];
  selected?: string | null;
  onSelect: (id: string) => void;
  /** Copy the waiting marks as a review an agent reads. */
  onCopy?: () => void;
  copied?: boolean;
  onClose?: () => void;
  /** Who will answer the marks, from the host: one quiet line under the list. */
  note?: ReactNode;
  /**
   * Marks with an agent's word not yet opened (their ids): listed first and
   * marked "new". `unreadMarks(marks, read)` from the protocol.
   */
  unread?: readonly string[];
  theme?: Partial<CanvasTheme>;
  className?: string;
  style?: CSSProperties;
}

export function MarksPanel({ marks, selected, onSelect, onCopy, copied, onClose, note, unread, theme, className, style }: MarksPanelProps) {
  const [all, setAll] = useState(false);
  const unreadIds = new Set(unread ?? []);
  // Numbered as on the board; the ones with an agent's word not yet read first.
  const numbered = marks.map((m, i) => ({ m, n: i + 1 }));
  const ordered = [...numbered.filter(({ m }) => unreadIds.has(m.id)), ...numbered.filter(({ m }) => !unreadIds.has(m.id))];
  const shown = all ? ordered : ordered.filter(({ m }) => m.status !== "resolved");
  const open = marks.filter((m) => m.status !== "resolved").length;
  return (
    <div
      className={`slc-stage-card slc-stage-panel${className ? ` ${className}` : ""}`}
      style={{ ...themeStyle(theme), ...style }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="slc-stage-card-row">
        <span className="slc-stage-card-label">Marks on this drawing</span>
        <span className="slc-stage-spacer" />
        <span className="slc-stage-segment" role="group" aria-label="Which marks to list">
          <button type="button" className={`slc-stage-segment-btn${all ? "" : " slc-stage-segment-btn--on"}`} aria-pressed={!all} onClick={() => setAll(false)}>
            Open {open}
          </button>
          <button type="button" className={`slc-stage-segment-btn${all ? " slc-stage-segment-btn--on" : ""}`} aria-pressed={all} onClick={() => setAll(true)}>
            All {marks.length}
          </button>
        </span>
        {onClose && (
          <button type="button" className="slc-stage-btn slc-stage-btn--quiet" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        )}
      </div>
      {shown.length === 0 && <div className="slc-stage-empty">{marks.length ? "Every mark is resolved." : "No marks yet. Turn on marking (✎) and tap or draw around what you mean."}</div>}
      <ul className="slc-stage-panel-list">
        {shown.map(({ m, n }) => (
          <li key={m.id}>
            <button type="button" className={`slc-stage-panel-item${m.id === selected ? " slc-stage-panel-item--selected" : ""}`} onClick={() => onSelect(m.id)}>
              <span className={`slc-stage-pin slc-stage-pin--inline slc-stage-pin--${m.status === "resolved" ? "resolved" : m.author.role === "agent" && m.status === "open" ? "question" : m.status}${unreadIds.has(m.id) ? " slc-stage-pin--new" : ""}`}>{n}</span>
              <span className="slc-stage-panel-text">
                <span className="slc-stage-panel-said">{m.text}</span>
                <span className="slc-stage-panel-meta">
                  {unreadIds.has(m.id) && <span className="slc-stage-new">new</span>}
                  {m.author.name} · {markAnchorText(m)}
                  {m.replies?.length ? ` · ${m.replies.length} repl${m.replies.length === 1 ? "y" : "ies"}` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Note>{note}</Note>
      {onCopy && (
        <div className="slc-stage-card-row">
          <span className="slc-stage-spacer" />
          <button type="button" className="slc-stage-btn" onClick={onCopy} title="Copy what is on screen and the waiting marks, to paste into any agent">
            {copied ? "Copied" : "Copy for the agent"}
          </button>
        </div>
      )}
    </div>
  );
}

export interface MarkNoticeProps {
  /** The line: `agentWordText(agentWordIn(envelope))`, e.g. "Mia answered mark 3". */
  children: ReactNode;
  /** Open the thread it speaks of. */
  onOpen: () => void;
  onDismiss?: () => void;
  theme?: Partial<CanvasTheme>;
  className?: string;
  style?: CSSProperties;
}

/**
 * One line that says an agent answered, near the board's controls. A polite
 * live region: read out, never focused, never a card over the board. The host
 * decides how long it stays (a few seconds) and what a tap opens.
 */
export function MarkNotice({ children, onOpen, onDismiss, theme, className, style }: MarkNoticeProps) {
  return (
    <div
      className={`slc-stage-notice${className ? ` ${className}` : ""}`}
      style={{ ...themeStyle(theme), ...style }}
      role="status"
      aria-live="polite"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" className="slc-stage-notice-open" onClick={onOpen} title="Open the thread">
        <span className="slc-stage-notice-dot" aria-hidden="true" />
        <span className="slc-stage-notice-text">{children}</span>
      </button>
      {onDismiss && (
        <button type="button" className="slc-stage-notice-close" onClick={onDismiss} aria-label="Dismiss">
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
