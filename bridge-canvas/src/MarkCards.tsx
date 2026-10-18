/**
 * The cards a person writes and reads marks in (Spec 83).
 *
 * - `<MarkComposer>`: what was pointed at, and a box to say something about
 *   it — typed, or spoken when the host hands it something that listens.
 * - `<MarkThread>`: one mark and its replies; reply, resolve, reopen, remove.
 * - `<MarksPanel>`: every mark on the drawing, waiting ones first, and the
 *   button that copies them as a review for an agent.
 *
 * Props in, callbacks out, as the canvases: the host writes the sidecar and
 * tells the hub. The listener is any object shaped like
 * `@miadi/stateloom-react`'s `browserDictation()`, so this package needs no
 * socket and no speech code of its own.
 */
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { MARK_KINDS, markAnchorText, type Box, type Mark, type MarkKind } from "@miadi/stateloom-protocol";
import { themeStyle, type CanvasTheme } from "./theme.js";

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
    else area.current?.focus();
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
            🎙
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
          ✕
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
              🎙
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
  theme?: Partial<CanvasTheme>;
  className?: string;
  style?: CSSProperties;
}

export function MarksPanel({ marks, selected, onSelect, onCopy, copied, onClose, theme, className, style }: MarksPanelProps) {
  const [all, setAll] = useState(false);
  const numbered = marks.map((m, i) => ({ m, n: i + 1 }));
  const shown = all ? numbered : numbered.filter(({ m }) => m.status !== "resolved");
  return (
    <div
      className={`slc-stage-card slc-stage-panel${className ? ` ${className}` : ""}`}
      style={{ ...themeStyle(theme), ...style }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="slc-stage-card-row">
        <span className="slc-stage-card-label">Marks on this drawing</span>
        <span className="slc-stage-spacer" />
        <button type="button" className={`slc-stage-btn slc-stage-btn--quiet${all ? " slc-stage-btn--on" : ""}`} onClick={() => setAll((a) => !a)}>
          {all ? "all" : "waiting"}
        </button>
        {onClose && (
          <button type="button" className="slc-stage-btn slc-stage-btn--quiet" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      {shown.length === 0 && <div className="slc-stage-empty">{marks.length ? "Every mark is resolved." : "No marks yet. Turn on marking (✎) and tap or draw around what you mean."}</div>}
      <ul className="slc-stage-panel-list">
        {shown.map(({ m, n }) => (
          <li key={m.id}>
            <button type="button" className={`slc-stage-panel-item${m.id === selected ? " slc-stage-panel-item--selected" : ""}`} onClick={() => onSelect(m.id)}>
              <span className={`slc-stage-pin slc-stage-pin--inline slc-stage-pin--${m.status === "resolved" ? "resolved" : m.author.role === "agent" && m.status === "open" ? "question" : m.status}`}>{n}</span>
              <span className="slc-stage-panel-text">
                <span className="slc-stage-panel-said">{m.text}</span>
                <span className="slc-stage-panel-meta">
                  {m.author.name} · {markAnchorText(m)}
                  {m.replies?.length ? ` · ${m.replies.length} repl${m.replies.length === 1 ? "y" : "ies"}` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
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
