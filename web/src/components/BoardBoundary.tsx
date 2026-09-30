"use client";

/**
 * Around each board and panel: a document an agent or a hand wrote in a shape
 * the drawing does not expect shows one plain message where it would have
 * drawn, and the rest of the page keeps working — never Next's "Application
 * error". It tries again when `resetKey` changes (the document was edited).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Change it to try drawing again (pass the document). */
  resetKey?: unknown;
  /** What could not be drawn: "sequence", "diagram", "panel"… */
  what: string;
}

export default class BoardBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[stateloom] the ${this.props.what} could not be drawn:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-amber-300">
        <p className="max-w-md">
          This {this.props.what} cannot be drawn: {error.message}. The file on disk is unchanged — correct it in the panel,
          in the file, or with the agent that wrote it.
        </p>
      </div>
    );
  }
}
