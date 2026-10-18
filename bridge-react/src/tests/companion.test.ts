/**
 * The companion client (Spec 84) against a stand-in phone-capture and a stand-in
 * microphone: the recorder's parts at the offset the service holds, the whole take with
 * the canvas it was spoken at, a failed send kept for Send again, the heartbeat; the
 * thread announcing only replies that arrive while the page is open, and a reply as a
 * tour the stage can present.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companionUrl,
  createCompanionThread,
  createTakeRecorder,
  replyTour,
  takeContext,
  type CompanionReply,
  type RecorderLike,
} from "../companion.js";

interface Call {
  url: string;
  method: string;
  body: unknown;
  type?: string;
}

function service(answer: (call: Call) => unknown, status = (_: Call) => 200) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: String(url),
      method: init.method ?? "GET",
      body: init.body instanceof Blob ? await init.body.text() : typeof init.body === "string" ? JSON.parse(init.body) : init.body,
      type: (init.headers as Record<string, string> | undefined)?.["content-type"],
    };
    calls.push(call);
    return new Response(JSON.stringify(answer(call)), { status: status(call), headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

function fakeMic() {
  let recorder: (RecorderLike & { feed(s: string): void }) | null = null;
  const stopped: string[] = [];
  const make = (): RecorderLike => {
    const r = {
      mimeType: "audio/mp4",
      ondataavailable: null as RecorderLike["ondataavailable"],
      onstop: null as RecorderLike["onstop"],
      onerror: null as RecorderLike["onerror"],
      start() {},
      stop() {
        r.onstop?.();
      },
      feed(s: string) {
        r.ondataavailable?.({ data: new Blob([s], { type: "audio/mp4" }) });
      },
    };
    recorder = r;
    return r;
  };
  const media = {
    getTracks: () => [{ stop: () => stopped.push("track") }],
  } as unknown as MediaStream;
  return { make, getUserMedia: async () => media, feed: (s: string) => recorder!.feed(s), fail: () => recorder!.onerror?.({ error: { name: "NotReadableError", message: "gone" } }), stopped };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a take: parts at the offset held, the whole take with its canvas, the heartbeat, and onStored", async () => {
  const { calls, fetchFn } = service((c) => {
    if (c.url.includes("takes/part")) return { success: true, bytes: Number(new URL(c.url, "http://x").searchParams.get("offset")) + String(c.body).length };
    if (c.url.includes("takes?")) return { success: true, take: "261018101010", english: "what does this state do?", presence: { state: "listening" } };
    return { success: true };
  });
  const mic = fakeMic();
  const stored: string[] = [];
  const r = createTakeRecorder({
    base: "/api/companion",
    episode: () => "2026-10-18-episode-999-x",
    context: () => ({ doc: "/d/wave.smdf.json", focus: "state:A" }),
    onStored: (t) => stored.push(t),
    fetch: fetchFn,
    getUserMedia: mic.getUserMedia,
    createRecorder: mic.make,
    partEveryMs: 30,
    beatEveryMs: 1000,
  });
  await r.press();
  assert.equal(r.getSnapshot().state, "recording");
  mic.feed("aaaa");
  await wait(45);
  mic.feed("bb");
  await wait(45);
  const parts = calls.filter((c) => c.url.includes("takes/part"));
  assert.ok(parts.length >= 2, `parts sent: ${parts.length}`);
  assert.match(parts[0].url, /^\/api\/companion\/takes\/part\?episode=2026-10-18-episode-999-x&rec=[a-z0-9-]+&context=.*&offset=0$/);
  assert.equal(parts[0].body, "aaaa");
  assert.match(parts[1].url, /offset=4$/);
  assert.equal(parts[1].body, "bb", "only the bytes the service does not hold yet");
  assert.equal(r.getSnapshot().held, 6);

  await r.press();
  const take = calls.find((c) => /takes\?/.test(c.url))!;
  assert.equal(take.body, "aaaabb", "the whole take");
  assert.equal(take.type, "audio/mp4");
  const ctx = JSON.parse(new URL(take.url, "http://x").searchParams.get("context")!);
  assert.deepEqual(ctx, { doc: "/d/wave.smdf.json", focus: "state:A" });
  assert.equal(r.getSnapshot().state, "idle");
  assert.match(r.getSnapshot().message, /Take 261018101010 is in the episode\. The session listening there will hear it\./);
  assert.deepEqual(stored, ["261018101010"]);
  const beats = calls.filter((c) => c.url.endsWith("recorder")).map((c) => (c.body as { recording: boolean }).recording);
  assert.equal(beats[0], true, "the service is told the microphone is open");
  assert.equal(beats[beats.length - 1], false, "and that it closed");
  assert.deepEqual(mic.stopped, ["track"], "the microphone is released");
  r.destroy();
});

test("a failed send keeps the recording for Send again; a recorder error keeps what it captured", async () => {
  let fail = true;
  const { calls, fetchFn } = service(
    (c) => (c.url.includes("takes?") ? (fail ? { success: false, error: "gaia is rebooting" } : { success: true, take: "261018101011", presence: { state: "away" } }) : { success: true }),
    (c) => (c.url.includes("takes?") && fail ? 503 : 200),
  );
  const mic = fakeMic();
  const r = createTakeRecorder({ base: "/c/", episode: () => "2026-10-18-episode-999-x", fetch: fetchFn, getUserMedia: mic.getUserMedia, createRecorder: mic.make, partEveryMs: 10_000 });
  await r.start();
  mic.feed("words");
  await r.stop();
  assert.equal(r.getSnapshot().state, "retry");
  assert.match(r.getSnapshot().message, /Not stored: gaia is rebooting\. Your recording is kept/);
  assert.ok(calls.some((c) => c.url.endsWith("takes/diagnostic")), "what went wrong is told to the service");
  fail = false;
  await r.press();
  assert.equal(r.getSnapshot().state, "idle");
  assert.match(r.getSnapshot().message, /No session is listening yet/);
  assert.equal(calls.filter((c) => /takes\?/.test(c.url)).at(-1)!.body, "words", "the kept recording is what is sent again");

  await r.start();
  mic.feed("half a thought");
  mic.fail();
  assert.equal(r.getSnapshot().state, "retry");
  assert.match(r.getSnapshot().message, /stopped with an error/);
  r.destroy();
});

test("no episode, or a refused microphone, says so and records nothing", async () => {
  const { fetchFn } = service(() => ({ success: true }));
  const none = createTakeRecorder({ base: "/c/", episode: () => null, fetch: fetchFn, createRecorder: fakeMic().make, getUserMedia: fakeMic().getUserMedia });
  await none.press();
  assert.match(none.getSnapshot().message, /Choose the episode/);
  const refused = createTakeRecorder({
    base: "/c/", episode: () => "e", fetch: fetchFn, createRecorder: fakeMic().make,
    getUserMedia: async () => { throw new Error("Permission denied"); },
  });
  await refused.press();
  assert.equal(refused.getSnapshot().state, "idle");
  assert.match(refused.getSnapshot().message, /Microphone refused: Permission denied/);
});

test("the thread announces only replies that arrive while the page is open, and a wait ends at its reply", async () => {
  const reply = (id: string, take: string | null): CompanionReply => ({ kind: "reply", id, episode: "e", take, text: `reply ${id}`, at: "2026-10-18T10:00:00Z", audio: null });
  let items: unknown[] = [{ kind: "take", take: "261018090000", at: "2026-10-18T09:00:00Z", text: "old" }, reply("r-old", "261018090000")];
  const { fetchFn } = service(() => ({ success: true, items, presence: { state: "listening" } }));
  const heard: string[] = [];
  const t = createCompanionThread({ base: "/api/companion/", fetch: fetchFn, onReply: (r) => heard.push(r.id), everyMs: 60_000, waitEveryMs: 20 });
  t.setEpisode("e");
  await wait(10);
  assert.equal(t.getSnapshot().items.length, 2);
  assert.deepEqual(heard, [], "a reply already there when the page opened is not announced");
  t.waitFor("261018101010");
  assert.equal(t.getSnapshot().waiting?.take, "261018101010");
  items = [...items, { kind: "take", take: "261018101010", at: "2026-10-18T10:10:10Z", text: "new" }, reply("r-new", "261018101010")];
  await wait(60);
  assert.deepEqual(heard, ["r-new"]);
  assert.equal(t.getSnapshot().waiting, null, "the wait ends at its reply");
  await t.refresh();
  assert.deepEqual(heard, ["r-new"], "announced once");
  t.destroy();
});

test("a reply is a tour: its steps with their own voices, or one caption with the whole reply's voice", () => {
  assert.equal(companionUrl("/api/companion/", "api/replies/x/audio"), "/api/companion/replies/x/audio");
  assert.equal(companionUrl("/api/companion", "https://cdn/x.mp3"), "https://cdn/x.mp3");
  assert.equal(companionUrl("/api/companion/", null), undefined);
  const stepped: CompanionReply = {
    kind: "reply", id: "r1", episode: "e", take: "t", text: "one\n\ntwo", at: "2026-10-18T10:00:00Z", audio: "api/replies/r1/audio",
    steps: [
      { say: "one", doc: "/d/w.smdf.json", spotlight: ["state:A"], audio: "api/replies/r1/steps/0/audio" },
      { say: "two", focus: "state:B" },
    ],
  };
  const tour = replyTour(stepped, "/api/companion/");
  assert.equal(tour.steps.length, 2);
  assert.equal(tour.steps[0].audio, "/api/companion/replies/r1/steps/0/audio");
  assert.equal(tour.steps[1].audio, "/api/companion/replies/r1/steps/1/audio", "a step not voiced yet is asked for at its own address, where it is rendered");
  const mute = replyTour({ ...stepped, unvoiced: "This reply cannot be voiced: no origin." }, "/api/companion/");
  assert.equal(mute.steps[1].audio, undefined, "a reply that cannot be voiced is read, not asked for");
  assert.match(tour.settings.name, /^Mia · /);
  const plain = replyTour({ ...stepped, steps: undefined }, "/api/companion/");
  assert.deepEqual(plain.steps, [{ say: "one\n\ntwo", audio: "/api/companion/replies/r1/audio" }]);

  assert.equal(takeContext(null), null);
  const { at, ...rest } = takeContext({ stage: "default", doc: "/d/w.smdf.json", kind: "machine", focus: null }, { marks: ["m-1"] })!;
  assert.ok(Date.parse(String(at)), "stamped when spoken");
  assert.deepEqual(rest, { stage: "default", doc: "/d/w.smdf.json", kind: "machine", marks: ["m-1"] }, "nothing empty is kept");
});
