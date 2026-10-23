/**
 * The loom's document kinds, and a link, drawn as outlines in the current text
 * colour — for the same reason as IssueIcon: typed symbols turn into colour
 * emoji on iOS, and the chrome is kept quiet.
 */
import type { DocKind } from "@miadi/stateloom-protocol";

type IconName = DocKind | "link" | "actor";

export default function KindIcon({ kind, size = 16 }: { kind: IconName; size?: number }) {
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
      className="shrink-0"
    >
      {kind === "erd" && (
        // A table: a header over rows.
        <>
          <rect x="4" y="4.5" width="16" height="15" rx="1.5" />
          <path d="M4 9h16M8 13h8M8 16.5h6" />
        </>
      )}
      {kind === "machine" && (
        // Two states and the transition between them.
        <>
          <rect x="2.5" y="4" width="8" height="6" rx="2.5" />
          <rect x="13.5" y="14" width="8" height="6" rx="2.5" />
          <path d="M6.5 10v4.5a2.5 2.5 0 0 0 2.5 2.5h4.5" />
          <path d="M11.5 15l2 2-2 2" />
        </>
      )}
      {kind === "sequence" && (
        // Two lifelines and a message.
        <>
          <path d="M6 4v16M18 4v16" strokeDasharray="2 2.2" />
          <path d="M6 9h11M15 7l2 2-2 2" />
          <path d="M18 15H7M9 13l-2 2 2 2" />
        </>
      )}
      {kind === "system" && (
        // Three members and what joins them.
        <>
          <rect x="3" y="3.5" width="7" height="6" rx="1.5" />
          <rect x="14" y="3.5" width="7" height="6" rx="1.5" />
          <rect x="8.5" y="14.5" width="7" height="6" rx="1.5" />
          <path d="M10 6.5h4M7 9.5l3 5M17 9.5l-3 5" />
        </>
      )}
      {kind === "link" && (
        <>
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
        </>
      )}
      {kind === "actor" && (
        <>
          <circle cx="12" cy="7.5" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </>
      )}
    </svg>
  );
}
