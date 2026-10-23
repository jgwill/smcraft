/**
 * A padlock drawn as an outline in the current text colour — closed or open.
 * Drawn rather than typed for the same reason as IssueIcon: the padlock
 * characters are full-colour emoji on iOS, a gold lock on a board of grey.
 */
export default function LockIcon({ locked, size = 16 }: { locked: boolean; size?: number }) {
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
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      {/* The shackle: seated in the body when locked, swung clear of it when not. */}
      <path d={locked ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-1.9"} />
    </svg>
  );
}
