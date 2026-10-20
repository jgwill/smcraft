/**
 * Dictation (`browserDictation`) against a stand-in recogniser: final segments the
 * browser hands without a space between them read as separate words, and a space on
 * both sides of a join stays one. Guillaume's mark from an iPhone read
 * "in betweenWhen it hasn't been".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { browserDictation, joinHeard } from "../speech.js";

type Segment = { transcript: string; isFinal: boolean };

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start(): void {}
  stop(): void {}
  /** What the browser sends: every result so far, and where the new ones begin. */
  hear(resultIndex: number, segments: Segment[]): void {
    const results = segments.map((s) => Object.assign([{ transcript: s.transcript }], { isFinal: s.isFinal }));
    this.onresult?.({ resultIndex, results });
  }
}

function listen(): { heard: { text: string; final: boolean }[]; rec: FakeRecognition } {
  (globalThis as unknown as { window: unknown }).window = { webkitSpeechRecognition: FakeRecognition };
  const dictation = browserDictation({ lang: "en-US" });
  assert.ok(dictation, "a browser with webkitSpeechRecognition can listen");
  const heard: { text: string; final: boolean }[] = [];
  dictation.start((text, final) => heard.push({ text, final }));
  assert.ok(FakeRecognition.last);
  return { heard, rec: FakeRecognition.last };
}

test("two final segments with no space between them read as separate words", () => {
  const { heard, rec } = listen();
  rec.hear(0, [{ transcript: "in between", isFinal: true }]);
  rec.hear(1, [
    { transcript: "in between", isFinal: true },
    { transcript: "When it", isFinal: true },
  ]);
  assert.deepEqual(heard.at(-1), { text: "in between When it", final: true });
});

test("a segment that brings its own space, or a space on both sides, joins with one", () => {
  const { heard, rec } = listen();
  rec.hear(0, [{ transcript: "in between ", isFinal: true }]);
  rec.hear(1, [
    { transcript: "in between ", isFinal: true },
    { transcript: " When it", isFinal: true },
  ]);
  rec.hear(2, [
    { transcript: "in between ", isFinal: true },
    { transcript: " When it", isFinal: true },
    { transcript: " hasn't been", isFinal: true },
  ]);
  assert.equal(heard.at(-1)?.text, "in between When it hasn't been");
});

test("words still forming are joined to the final ones the same way", () => {
  const { heard, rec } = listen();
  rec.hear(0, [{ transcript: "in between", isFinal: true }]);
  rec.hear(1, [
    { transcript: "in between", isFinal: true },
    { transcript: "When", isFinal: false },
  ]);
  assert.deepEqual(heard.at(-1), { text: "in between When", final: false });
});

test("joinHeard keeps an empty side out of the text", () => {
  assert.equal(joinHeard("", "When it"), "When it");
  assert.equal(joinHeard("in between", ""), "in between");
  assert.equal(joinHeard("in between", "When it"), "in between When it");
  assert.equal(joinHeard("in between  ", "  When it"), "in between When it");
});
