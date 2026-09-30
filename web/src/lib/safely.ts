/**
 * Run a check or a derivation over a document that may be malformed, and fall
 * back instead of throwing: a hand- or agent-written file is not always the
 * shape the types say, and one bad field must not take the page down. The
 * error is kept for whoever asks (`onError`) and logged once.
 */
export function safely<T>(run: () => T, fallback: T, onError?: (message: string) => void): T {
  try {
    return run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[stateloom] skipped on a malformed document:", message);
    onError?.(message);
    return fallback;
  }
}
