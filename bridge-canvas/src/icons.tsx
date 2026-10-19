/**
 * The stage's icons, drawn: outlines in the current colour.
 *
 * Typed symbols such as 🎙, 🔊, 💬, 👍 and even ▶ render as colour emoji on iOS,
 * saturated and larger than the text around them. The person these designers are
 * built with works on an iPhone and is visually sensitive, so every icon in the
 * stage's chrome is a line drawing that takes the button's own colour and size.
 */
import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="slc-icon"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function MicIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </Icon>
  );
}

export function SpeakerIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </Icon>
  );
}

export function SpeakerOffIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 10l4 4M20 10l-4 4" />
    </Icon>
  );
}

/** A speech bubble: the marks on a drawing, what people said about it. */
export function MarksIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-7l-4.5 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5z" />
    </Icon>
  );
}

export function PlayIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
    </Icon>
  );
}

export function PauseIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth={2.6} />
    </Icon>
  );
}

export function StopIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
    </Icon>
  );
}

export function PrevIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M17 5.5v13L8 12z" />
      <path d="M6.5 5.5v13" />
    </Icon>
  );
}

export function NextIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M7 5.5v13l9-6.5z" />
      <path d="M17.5 5.5v13" />
    </Icon>
  );
}

export function ThumbUpIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M7.5 10.5v9H4.5v-9zM7.5 10.5l3.5-6.5a2 2 0 0 1 2.5 2.2l-.6 3.3h5.4a2 2 0 0 1 2 2.4l-1.3 6.2a2 2 0 0 1-2 1.4H7.5" />
    </Icon>
  );
}

export function ThumbDownIcon(p: IconProps) {
  return (
    <Icon {...p} style={{ transform: "scaleY(-1)", ...p.style }}>
      <path d="M7.5 10.5v9H4.5v-9zM7.5 10.5l3.5-6.5a2 2 0 0 1 2.5 2.2l-.6 3.3h5.4a2 2 0 0 1 2 2.4l-1.3 6.2a2 2 0 0 1-2 1.4H7.5" />
    </Icon>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

/** A pencil: marking is on, a tap or a drag marks the drawing. */
export function MarkIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4.5 19.5l1-4.2L15.8 5a1.8 1.8 0 0 1 2.5 0l.7.7a1.8 1.8 0 0 1 0 2.5L8.7 18.5z" />
      <path d="M13.8 7l3.2 3.2" />
    </Icon>
  );
}
