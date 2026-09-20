/**
 * A warning triangle drawn as an outline in the current text colour.
 *
 * The "⚠" character is a full-colour emoji on iOS: a saturated yellow sign in
 * a dock of grey glyphs, pulling the eye whether or not there is anything to
 * report. Drawn here instead, it is as quiet as its neighbours and takes the
 * tab's own colour — grey at rest, the accent when its tab is open. The count
 * badge beside it is what says there is something to look at.
 */
export default function IssueIcon({ size = 16 }: { size?: number }) {
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
      <path d="M12 4.5 21 19.5H3Z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.3v.01" />
    </svg>
  );
}
