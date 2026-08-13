"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { isOnCanvasPane } from "@/lib/gestureOwner";
import {
  applyUiScale,
  clampUiScale,
  getServerUiScale,
  getUiScale,
  setUiScale,
  subscribeUiScale,
} from "@/lib/uiScale";

/**
 * How far the fingers must travel before a two-finger contact counts as a
 * request to resize the chrome. The canvas needs no such threshold — two fingers
 * on the board can only ever mean zoom — but the chrome is full of things a hand
 * rests on, and a two-finger tap on a panel must not leave the menus a few
 * percent bigger than they were.
 */
const CHROME_PINCH_SLOP_PX = 12;

interface ChromePinch {
  a: number;
  b: number;
  /** The chrome size the gesture opened against. Never re-read mid-gesture. */
  startScale: number;
  /**
   * Finger separation at the moment the gesture *engaged* — which is when it
   * passed the slop, not when the fingers landed. Re-baselining there is what
   * stops the chrome jumping a slop's worth of scale the instant it engages.
   */
  startDist: number;
  engaged: boolean;
}

function distanceBetween(a: Touch, b: Touch): number {
  // Two fingers on one pixel would divide by zero; a floor of one pixel makes the
  // opening frame a no-op instead of an infinity. Same guard the canvas uses.
  return Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY));
}

function findTouch(list: TouchList, identifier: number): Touch | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].identifier === identifier) return list[i];
  }
  return null;
}

/**
 * The second set of controls.
 *
 * Pinch the board and the machine gets bigger. Pinch anywhere else — toolbar,
 * panels, the bottom sheet, the tab dock — and the *interface* gets bigger:
 * labels, buttons, the 44px touch floors, all of it, because every one of them is
 * a multiple of the root font size. See `lib/uiScale.ts` for why that one
 * property is the whole mechanism, and `lib/gestureOwner.ts` for the rule that
 * keeps the two pinches from ever answering the same gesture.
 */
export default function UiScale() {
  // The scale lives outside React (lib/uiScale.ts) — it is a property of the
  // document that a gesture sets and the browser remembers. This component only
  // observes it, which is why there is no restore-from-storage effect here and no
  // render at 100% before the remembered size arrives.
  const scale = useSyncExternalStore(subscribeUiScale, getUiScale, getServerUiScale);
  const pinchRef = useRef<ChromePinch | null>(null);
  // The size the fingers have asked for but the screen has not yet been given.
  // Only the gesture writes it — never the render — so a frame that lands between
  // two moves cannot roll the pinch back to where it was one move ago.
  const pendingRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  // Keep the glass in step with the store. Normally a no-op: the inline script in
  // layout.tsx has already sized the root before first paint, and every gesture
  // writes the DOM before it notifies. This is the belt for the case where that
  // script was blocked.
  useEffect(() => {
    applyUiScale(scale);
  }, [scale]);

  /** Move at most once per frame; fingers report far faster than the screen. */
  const paint = useCallback((next: number) => {
    pendingRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingRef.current !== null) setUiScale(pendingRef.current, false);
    });
  }, []);

  const reset = useCallback(() => {
    pendingRef.current = null;
    setUiScale(1, true);
  }, []);

  // Chrome pinch. Native touch listeners rather than React's pointer events for
  // two reasons: `TouchEvent.touches` hands over every finger at once, so no map
  // has to be kept to know a gesture is a pinch; and `preventDefault` on a
  // *non-passive* touchmove is the only thing that reliably stops a panel from
  // scrolling out from under a hand that meant to resize it.
  useEffect(() => {
    const endPinch = () => {
      const pinch = pinchRef.current;
      pinchRef.current = null;
      if (!pinch?.engaged) return;
      // The fingers are off the glass. Whatever the last move asked for goes on
      // now — a lift must never be answered by the frame before it — and now, and
      // only now, is the size worth remembering across reloads.
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      const settled = pendingRef.current ?? getUiScale();
      pendingRef.current = null;
      setUiScale(clampUiScale(settled), true);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        // A third finger — or a drop back to one — is no longer a chrome pinch.
        // It settles at the size it reached rather than snapping back.
        if (pinchRef.current) endPinch();
        return;
      }
      const [a, b] = [e.touches[0], e.touches[1]];
      // The arbitration rule, applied once and never revisited: if either finger
      // is on the canvas pane, this gesture is not ours. The canvas takes it when
      // the other finger is there too; when it is not, nobody takes it.
      if (isOnCanvasPane(a.target) || isOnCanvasPane(b.target)) return;

      pinchRef.current = {
        a: a.identifier,
        b: b.identifier,
        startScale: getUiScale(),
        startDist: distanceBetween(a, b),
        engaged: false,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      const pinch = pinchRef.current;
      if (!pinch) return;
      const a = findTouch(e.touches, pinch.a);
      const b = findTouch(e.touches, pinch.b);
      if (!a || !b) return;

      // Two fingers on the chrome never mean "scroll" — one finger does that — so
      // the browser's reading of this gesture is always wrong, and is refused from
      // the very first move, before it can commit to a scroll it cannot undo.
      e.preventDefault();

      const dist = distanceBetween(a, b);
      if (!pinch.engaged) {
        if (Math.abs(dist - pinch.startDist) < CHROME_PINCH_SLOP_PX) return;
        pinch.engaged = true;
        pinch.startDist = dist;
        return;
      }
      // Measured from the opening frame, never from the previous move — the same
      // arithmetic the canvas zoom uses, so the two gestures feel like one gesture
      // pointed at two different things, and neither accumulates drift.
      paint(clampUiScale(pinch.startScale * (dist / pinch.startDist)));
    };

    const onTouchEnd = (e: TouchEvent) => {
      const pinch = pinchRef.current;
      if (!pinch) return;
      // Either finger leaving ends the gesture. A hand that puts one back down
      // opens a fresh pinch against the size this one settled on.
      if (!findTouch(e.touches, pinch.a) || !findTouch(e.touches, pinch.b)) endPinch();
    };

    // Capture phase, so a panel that stops propagation cannot hide the gesture.
    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart, { capture: true });
      document.removeEventListener("touchmove", onTouchMove, { capture: true });
      document.removeEventListener("touchend", onTouchEnd, { capture: true });
      document.removeEventListener("touchcancel", onTouchEnd, { capture: true });
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [paint]);

  if (scale === 1) return null;

  // Sized in px on purpose. This is the way back from a chrome that has become
  // too big to use — it must be the one thing on screen the scale cannot reach.
  return (
    <div className="ui-scale-pill" role="status" aria-live="polite">
      <span>UI {Math.round(scale * 100)}%</span>
      <button type="button" onClick={reset} aria-label="Reset interface size to 100 percent">
        Reset
      </button>
    </div>
  );
}
