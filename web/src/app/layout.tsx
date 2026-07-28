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
 * Pinch-zoom is pinned to 1 deliberately. The canvas owns two-finger gestures
 * for its own zoom; leaving browser page-zoom enabled means the browser eats
 * that gesture before the SVG ever sees it. The usual accessibility objection
 * to `userScalable: false` is that it blocks magnification of text — here the
 * canvas has its own zoom control and the panels reflow at device width, so the
 * capability is preserved in-app rather than removed.
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
