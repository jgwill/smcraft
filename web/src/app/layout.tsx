import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMCraft Designer",
  description: "Visual State Machine Designer",
};

/**
 * The app shipped with no viewport declaration at all, which is why phones
 * rendered it microscopic: with no `width=device-width` a mobile browser
 * assumes a ~980px desktop layout viewport and then shrink-to-fits the whole
 * page into the screen. Everything below follows from fixing that.
 *
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` report real
 * numbers instead of zero — the shell in globals.css pads itself with them, so
 * notch and home-indicator hardware no longer sit on top of the toolbar/dock.
 *
 * Pinch-zoom is pinned to 1 deliberately, but do not mistake these two lines for
 * the mechanism: `userScalable` is advice, and browsers decline it. Android
 * Chrome overrides it whenever "Force enable zoom" is set in accessibility, and
 * iOS Safari has ignored it for years. What actually reserves two-finger
 * gestures for the app is `touch-action` in globals.css — `pan-x pan-y` on the
 * document, which permits every kind of scrolling and forbids page zoom. These
 * two lines remain as the cheap first line of defence.
 *
 * The usual accessibility objection to `userScalable: false` is that it blocks
 * magnification — here both halves of that capability exist in-app instead: the
 * canvas has its own zoom, and a pinch on the chrome scales the interface itself
 * (see components/UiScale.tsx).
 *
 * `interactiveWidget: "resizes-content"` matters because the panel sheet is
 * pinned to the bottom edge: without it the on-screen keyboard covers the very
 * inputs it was opened to edit, and nothing scrolls because the document itself
 * does not scroll.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#030712",
  colorScheme: "dark",
};

/**
 * Restore the remembered chrome size before anything paints.
 *
 * `UiScale` re-applies this from an effect anyway, but an effect runs after the
 * first paint: without this the app would flash at 100% and then jump to 175% on
 * every single reload, which reads as a bug even though it settles correctly.
 *
 * The two numbers here are the same clamp and the same key as `lib/uiScale.ts`;
 * they are repeated rather than imported because this string is handed to the
 * parser, not to the bundler. Silence on failure is the point — a browser with
 * storage disabled gets the default size, not a blank page.
 */
const RESTORE_UI_SCALE = `try{var s=parseFloat(localStorage.getItem("stateloom.uiScale.v1"));if(s>=0.75&&s<=1.75)document.documentElement.style.fontSize=(16*s)+"px"}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: RESTORE_UI_SCALE }} />
        {children}
      </body>
    </html>
  );
}
