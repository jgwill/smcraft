"use client";

/**
 * The phone sheet's grab handle, made to do what it looks like it does.
 *
 * The handle used to be decoration: it read as "this thing is a sheet" and
 * answered no gesture, so a thumb pulling it down — the one thing a handle
 * invites — got nothing. This hook gives the zone around it three answers:
 *
 *   drag down   the sheet follows the finger; past a threshold it closes
 *               (from the tall size, a short pull returns to the resting size)
 *   drag up     the sheet grows with the finger; past a threshold it stays tall
 *   tap         toggles between the resting and the tall size
 *
 * Height is handed to the sheet as the `--sheet-h` custom property rather than
 * an inline `height`, so the desktop rule (`md:h-auto`) still wins where the
 * sheet is a sidebar and none of this applies. A press that starts on a button
 * inside the zone (the ✕) is left to the button.
 */
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

const CLOSE_AFTER = 80;
const CLOSE_FROM_TALL_AFTER = 260;
const GROW_AFTER = 50;
const TAP_SLOP = 6;

export interface SheetDrag {
  /** Spread on the element that holds the handle. */
  zoneProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    style: CSSProperties;
  };
  /** Spread on the sheet itself, which sizes itself with `h-[var(--sheet-h)]`. */
  sheetStyle: CSSProperties;
  /** Close the sheet and return it to its resting size for next time. */
  close: () => void;
}

export function useSheetDrag(opts: { onClose: () => void; restVh: number; tallVh: number }): SheetDrag {
  const { onClose, restVh, tallVh } = opts;
  const [tall, setTall] = useState(false);
  const [dy, setDy] = useState<number | null>(null);
  const press = useRef<{ y: number; id: number } | null>(null);

  const close = (): void => {
    setTall(false);
    onClose();
  };

  const release = (e: ReactPointerEvent<HTMLElement>): void => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    const d = e.clientY - p.y;
    setDy(null);
    if (Math.abs(d) < TAP_SLOP) return setTall((t) => !t);
    if (d <= -GROW_AFTER) return setTall(true);
    if (d >= CLOSE_AFTER) {
      if (tall && d < CLOSE_FROM_TALL_AFTER) return setTall(false);
      close();
    }
  };

  const vh = tall ? tallVh : restVh;
  const dragging = dy !== null;
  const sheetStyle: CSSProperties & Record<"--sheet-h", string> = {
    "--sheet-h": dragging && dy < 0 ? `min(calc(${vh}dvh + ${-dy}px), ${tallVh}dvh)` : `${vh}dvh`,
    ...(dragging ? { transition: "none" } : {}),
    ...(dragging && dy > 0 ? { transform: `translateY(${dy}px)` } : {}),
  };

  return {
    zoneProps: {
      onPointerDown: (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        press.current = { y: e.clientY, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
        setDy(0);
      },
      onPointerMove: (e) => {
        const p = press.current;
        if (p && p.id === e.pointerId) setDy(e.clientY - p.y);
      },
      onPointerUp: release,
      onPointerCancel: release,
      // The zone is a gesture surface: the browser must not scroll or pan with it.
      style: { touchAction: "none", cursor: "grab" },
    },
    sheetStyle,
    close,
  };
}
