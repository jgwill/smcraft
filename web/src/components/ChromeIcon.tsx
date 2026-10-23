/**
 * The loom's chrome icons — the toolbar, the phone's tab bar, the context menu and the
 * delete buttons — drawn as outlines in the current text colour (lane U, finding U6).
 *
 * The typed symbols they replace (📂 💾 🔄 📥 🖼 ⚡ 📜 🗑 🎛 ⚙ ✏️ ↩ ↪ ↗) are colour emoji
 * on iOS: saturated, larger than the words beside them, and the first thing the eye lands
 * on around a board whose stage, marks and dock are already drawn. Same style as
 * IssueIcon and KindIcon: a 24-unit box, a 1.6 stroke, round ends.
 */
export type ChromeIconName =
  | "undo"
  | "redo"
  | "arrange"
  | "draw"
  | "open"
  | "save"
  | "reload"
  | "download"
  | "image"
  | "plus"
  | "check"
  | "bolt"
  | "scroll"
  | "code"
  | "trash"
  | "sliders"
  | "gear";

export default function ChromeIcon({ name, size = 14 }: { name: ChromeIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="inline-block shrink-0 align-[-2px]"
    >
      {name === "undo" && <path d="M9 7 4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12" />}
      {name === "redo" && <path d="M15 7l4.5 4.5L15 16M19 11.5H9.5a5 5 0 0 0 0 10H12" />}
      {name === "arrange" && (
        // Three boxes in layers.
        <>
          <rect x="8.5" y="3" width="7" height="5" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
          <rect x="14" y="16" width="7" height="5" rx="1.5" />
          <path d="M12 8v4M6.5 16v-2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2" />
        </>
      )}
      {name === "draw" && (
        // An arrow drawn from one state to another.
        <>
          <circle cx="5.5" cy="18.5" r="2" />
          <path d="M7 17 18.5 5.5M11.5 5.5h7v7" />
        </>
      )}
      {name === "open" && <path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7z" />}
      {name === "save" && (
        <>
          <path d="M5 4h11l3.5 3.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
          <path d="M8 4v5h7V4M8 20v-6h8v6" />
        </>
      )}
      {name === "reload" && <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15" />}
      {name === "download" && <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15" />}
      {name === "image" && (
        <>
          <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="m4 17.5 5-5 4 4 2.5-2.5 4.5 4.5" />
        </>
      )}
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
      {name === "check" && <path d="m5 12.5 4.5 4.5L19 7.5" />}
      {name === "bolt" && <path d="M13 3 5.5 13.5h5.5L10 21l8-11h-5.5z" />}
      {name === "scroll" && (
        // A page with lines: a written specification.
        <>
          <path d="M6.5 3.5h8l4 4v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
          <path d="M14.5 3.5v4h4M8.5 12h7M8.5 15.5h7M8.5 9h3" />
        </>
      )}
      {name === "code" && <path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5M13.5 5l-3 14" />}
      {name === "trash" && <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l.9 12.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.6M10 10.5v6M14 10.5v6" />}
      {name === "sliders" && (
        <>
          <path d="M5 4v16M12 4v16M19 4v16" />
          <circle cx="5" cy="9" r="2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="15" r="2" fill="currentColor" stroke="none" />
          <circle cx="19" cy="7.5" r="2" fill="currentColor" stroke="none" />
        </>
      )}
      {name === "gear" && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
        </>
      )}
    </svg>
  );
}
