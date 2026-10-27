// decider — who answers the typed questions. Two are wired:
//
//   dry  answers nothing and sends nothing. It returns the exact request that would leave
//        the host, with its size, so a person can read it before any decider is chosen.
//   jev  the System One endpoint of whichever service issued the key in use (see PROVIDERS).
//        The request leaves this host.
//
// Which one runs, and which service may receive lane evidence, is a person's decision.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// A key belongs to the service that issued it, and it is only ever sent to that service's
// address. There is no fallback from one to the other.
//   Jev AI (jev-ai.pro) hosts a TypeSafe-compatible endpoint; its keys are made at
//   https://jev-ai.pro/jev-api and its docs are https://jev-ai.pro/docs.
//   TypeSafe (typesafe.ai) makes Jev; its keys are made at https://console.typesafe.ai/keys.
export const PROVIDERS = [
  { name: "jev-ai.pro", key: "JEV_AI_API_KEY", baseEnv: "JEV_AI_BASE_URL", base: "https://jev-ai.pro/api" },
  { name: "typesafe.ai", key: "TYPESAFE_API_KEY", baseEnv: "TYPESAFE_BASE_URL", base: "https://api.typesafe.ai" },
];
export const KEY_NAMES = PROVIDERS.map((p) => p.key);
export const DEFAULT_MODEL = "jev-latest";
// Jev's budget for the state plus the longest question.
export const STATE_TOKEN_BUDGET = 32_000;
// Response headers Jev AI uses to report what a call cost and what is left.
export const BILLING_HEADERS = ["x-jev-run-id", "x-jev-billing", "x-jev-paid-input-tokens-used", "x-jev-model-multiplier", "x-jev-credits-charged", "x-jev-tokens-remaining", "x-jev-credits-remaining"];

export function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function buildRequest(state, questions, model = DEFAULT_MODEL) {
  return { state, model, questions };
}

// ---------- the contract, checked both ways ----------
//
// Jev's published limits (docs.typesafe.ai and jev-ai.pro/docs, as the Episode 564 study
// records them in part 1.2) and the answer contract of part 1.3. A request is checked before
// it is sent; an answer is checked before anyone reads a number from it. The checks follow
// the validators of disler/ten-levels-of-jev (apps/ten-levels/src/core/types.ts and client.ts),
// revision R9 of jev-study-261026.md.
export const LIMITS = {
  MAX_QUESTIONS: 64,
  MAX_ID_CHARS: 64,
  MIN_CHOICE_OPTIONS: 2,
  MAX_CHOICE_OPTIONS: 255,
  MIN_SCORE_LEVELS: 2,
  MAX_SCORE_LEVELS: 10,
  MAX_BODY_BYTES: 256_000,
  SUM_TOLERANCE: 0.025,
};

// A typed failure: `kind` is invalid_request or invalid_answer, `failures` lists each problem
// as { code, question, detail }.
export class JevContractError extends Error {
  constructor(kind, failures) {
    super(`${kind}: ${failures.map((f) => `${f.question ?? "request"}: ${f.detail}`).join("; ")}`);
    this.name = "JevContractError";
    this.kind = kind;
    this.failures = failures;
  }
}

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isUnit = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;

// The request's shape, before anything is sent. Returns the failures; an empty list is a pass.
export function validateRequest(request) {
  const out = [];
  const fail = (code, detail, question = null) => out.push({ code, question, detail });
  if (!isObject(request)) { fail("request_not_object", "the request must be an object"); return out; }
  if (typeof request.state !== "string" && !isObject(request.state) && !Array.isArray(request.state)) fail("state_type", "state must be a string, an object or an array");
  if (request.model !== undefined && (typeof request.model !== "string" || !request.model.trim())) fail("model_type", "model must be a nonblank string");
  const questions = request.questions;
  if (!isObject(questions)) { fail("questions_type", "questions must be an object of id to question"); return out; }
  const ids = Object.keys(questions);
  if (ids.length < 1 || ids.length > LIMITS.MAX_QUESTIONS) fail("questions_count", `1 to ${LIMITS.MAX_QUESTIONS} questions, got ${ids.length}`);
  for (const id of ids) {
    const q = questions[id];
    if (id.length > LIMITS.MAX_ID_CHARS) fail("question_id", `id longer than ${LIMITS.MAX_ID_CHARS} characters`, id);
    if (!isObject(q)) { fail("question_type", "the question must be an object", id); continue; }
    if (!["noul", "choice", "score"].includes(q.type)) fail("question_type", `type must be noul, choice or score, got ${q.type}`, id);
    if (typeof q.instructions === "string" ? !q.instructions.trim() : !isObject(q.instructions)) fail("instructions", "instructions must be a nonblank string or an object", id);
    if (q.type === "noul" && q.criteria !== undefined) {
      if (!isObject(q.criteria) || Object.entries(q.criteria).some(([k, v]) => !["true", "false"].includes(k) || (v !== undefined && typeof v !== "string"))) fail("noul_criteria", "noul criteria map true and false to descriptions", id);
    }
    if (q.type === "choice") {
      if (!isObject(q.criteria)) fail("choice_options", "choice criteria must be an object of option to description", id);
      else {
        const n = Object.keys(q.criteria).length;
        if (n < LIMITS.MIN_CHOICE_OPTIONS || n > LIMITS.MAX_CHOICE_OPTIONS) fail("choice_options", `${LIMITS.MIN_CHOICE_OPTIONS} to ${LIMITS.MAX_CHOICE_OPTIONS} options, got ${n}`, id);
        if (Object.values(q.criteria).some((v) => v !== null && typeof v !== "string")) fail("choice_options", "option descriptions must be strings or null", id);
      }
    }
    if (q.type === "score") {
      if (!Array.isArray(q.criteria)) fail("score_levels", "score criteria must be an array of levels", id);
      else {
        if (q.criteria.length < LIMITS.MIN_SCORE_LEVELS || q.criteria.length > LIMITS.MAX_SCORE_LEVELS) fail("score_levels", `${LIMITS.MIN_SCORE_LEVELS} to ${LIMITS.MAX_SCORE_LEVELS} levels, got ${q.criteria.length}`, id);
        if (q.criteria.some((level) => typeof level !== "string" || !level.trim())) fail("score_levels", "levels must be nonblank strings", id);
      }
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  if (bytes > LIMITS.MAX_BODY_BYTES) fail("body_size", `${bytes} bytes of JSON, the limit is ${LIMITS.MAX_BODY_BYTES}`);
  return out;
}

// One answer against the question it answers: its type, its range, and for a choice or a
// score, probabilities that cover exactly the declared options and sum to about one.
export function validateAnswer(question, answer, id = null) {
  const out = [];
  const fail = (code, detail) => out.push({ code, question: id, detail });
  if (!isObject(answer)) { fail("answer_missing", "no answer"); return out; }
  if (answer.type !== question.type) { fail("answer_type", `asked a ${question.type}, answered a ${answer.type}`); return out; }
  if (question.type === "noul") {
    if (!isUnit(answer.noul)) fail("noul_range", `noul must be within 0 and 1, got ${answer.noul}`);
    return out;
  }
  if (!isUnit(answer.confidence)) fail("confidence_range", `confidence must be within 0 and 1, got ${answer.confidence}`);
  const keys = question.type === "choice" ? Object.keys(question.criteria ?? {}) : (question.criteria ?? []).map((_, i) => String(i));
  const probs = answer.probabilities;
  if (!isObject(probs)) { fail("probabilities_missing", "no probabilities"); return out; }
  const missing = keys.filter((k) => !Object.hasOwn(probs, k));
  const extra = Object.keys(probs).filter((k) => !keys.includes(k));
  if (missing.length || extra.length) fail("probabilities_keys", `probabilities must cover the declared options${missing.length ? `; missing ${missing.join(", ")}` : ""}${extra.length ? `; undeclared ${extra.join(", ")}` : ""}`);
  const bad = keys.filter((k) => Object.hasOwn(probs, k) && !isUnit(probs[k]));
  if (bad.length) fail("probabilities_range", `probabilities must be within 0 and 1: ${bad.join(", ")}`);
  const sum = keys.reduce((acc, k) => acc + (isUnit(probs[k]) ? probs[k] : 0), 0);
  if (!missing.length && Math.abs(sum - 1) > LIMITS.SUM_TOLERANCE) fail("probabilities_sum", `probabilities sum to ${Number(sum.toFixed(4))}, not 1 within ${LIMITS.SUM_TOLERANCE}`);
  if (question.type === "choice" && !keys.includes(answer.choice)) fail("choice_undeclared", `chose ${answer.choice}, which is not a declared option`);
  if (question.type === "score") {
    if (typeof answer.score !== "number" || answer.score < 0 || answer.score > keys.length - 1) fail("score_range", `score must be within 0 and ${keys.length - 1}, got ${answer.score}`);
    const legend = answer.legend;
    if (legend !== undefined && (!isObject(legend) || keys.some((k, i) => legend[k] !== question.criteria[i]))) fail("legend_mismatch", "the legend does not match the declared levels");
  }
  return out;
}

// Every answer of a response against the request's questions.
export function validateAnswers(request, body) {
  if (!isObject(body?.answers)) return [{ code: "answers_missing", question: null, detail: "the response carries no answers object" }];
  return Object.entries(request.questions ?? {}).flatMap(([id, q]) => validateAnswer(q, body.answers[id], id));
}

// The answers with each failing one marked, so readAnswer reads it as invalid instead of a number.
function markAnswers(answers, failures) {
  if (!isObject(answers)) return answers;
  const byQuestion = new Map();
  for (const f of failures) if (f.question && isObject(answers[f.question])) byQuestion.set(f.question, [...(byQuestion.get(f.question) ?? []), f]);
  return Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, byQuestion.has(id) ? { ...a, failures: byQuestion.get(id) } : a]));
}

export async function decideDry(request) {
  const failures = validateRequest(request);
  return {
    model: "dry",
    answers: {},
    usage: null,
    sent: false,
    estimated_input_tokens: estimateTokens(request),
    within_budget: estimateTokens(request.state) < STATE_TOKEN_BUDGET,
    validation: { ok: failures.length === 0, kind: failures.length ? "invalid_request" : null, failures },
  };
}

function envFileValue(name, env) {
  const file = env.TYPESAFE_ENV_FILE || join(homedir(), ".env");
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*?)\\s*$`).exec(line);
    if (m) return m[1].replace(/^(['"])(.*)\1$/, "$2") || null;
  }
  return null;
}

// The service to call and the key for it, from the environment first, then from one literal
// line of ${TYPESAFE_ENV_FILE:-~/.env}. The file is read, never sourced; the key is never printed.
export function resolveProvider(env = process.env) {
  for (const source of ["env", "file"]) {
    for (const provider of PROVIDERS) {
      const apiKey = source === "env" ? env[provider.key] : envFileValue(provider.key, env);
      if (!apiKey) continue;
      const base = (env[provider.baseEnv] || envFileValue(provider.baseEnv, env) || provider.base).replace(/\/+$/, "");
      return { name: provider.name, keyName: provider.key, apiKey, base, url: `${base}/v1/systemone`, modelsUrl: `${base}/v1/models` };
    }
  }
  return null;
}

// Kept for callers that only need the key.
export function typesafeKey(env = process.env) {
  return resolveProvider(env)?.apiKey ?? null;
}

function noKey() {
  return new Error(`no ${KEY_NAMES.join(" or ")} in the environment or in ~/.env; the jev decider cannot run (--decider dry shows the request).`);
}

function billingOf(headers) {
  const out = {};
  for (const name of BILLING_HEADERS) {
    const value = headers?.get?.(name);
    if (value != null) out[name.replace(/^x-jev-/, "").replace(/-/g, "_")] = value;
  }
  return out;
}

async function errorText(response) {
  const raw = await response.text().catch(() => "");
  try {
    const body = JSON.parse(raw);
    return body?.error?.message ?? body?.detail?.message ?? raw;
  } catch {
    return raw;
  }
}

// What each failure means, after https://jev-ai.pro/docs#errors.
export const FAILURES = {
  401: "the key is missing, invalid or revoked, or it was sent to the wrong service",
  402: "insufficient balance, or spending is paused",
  404: "wrong path: check the base URL keeps /api and does not repeat /v1",
  409: "a saved judge changed revision",
  422: "the request body, state, model or questions are invalid; do not resend it unchanged",
  429: "rate or capacity limit",
  502: "model or upstream unavailable",
  503: "model or upstream unavailable",
  504: "upstream timeout: the outcome is uncertain, so it is not resent",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Confirmed failures, after which a resend cannot double a charge: Jev AI's 429, 502 and 503,
// and TypeSafe's 529 (overloaded).
export const RESENDABLE = [429, 502, 503, 529];

// One decision call. It is resent only after a confirmed failure, honouring Retry-After. A
// timeout, a 504 or a lost connection leaves the outcome uncertain and the call may already
// have been charged, so it is reported and never replayed.
//
// A request that breaks the contract is refused before it is sent, with a JevContractError
// (kind invalid_request), because Jev would answer 422 and it must not be resent unchanged.
// An answer that breaks it was already paid for, so it is returned, never thrown away: the
// result carries `validation` { ok, kind, failures }, each failing answer is marked so
// readAnswer reads it as invalid, and one line goes to stderr.
export async function decideJev(request, { provider = resolveProvider(), fetchImpl = globalThis.fetch, attempts = 3, report = (line) => console.error(line) } = {}) {
  const requestFailures = validateRequest(request);
  if (requestFailures.length) throw new JevContractError("invalid_request", requestFailures);
  if (!provider) throw noKey();
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(provider.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request),
      });
    } catch (error) {
      throw new Error(`no answer from ${provider.url} (${error.message}); the outcome is uncertain, so the call was not resent`);
    }
    if (response.ok) {
      const body = await response.json();
      const failures = validateAnswers(request, body);
      const billing = { ...(body.billing ?? {}), ...billingOf(response.headers) };
      if (failures.length) report(`decider: ${new JevContractError("invalid_answer", failures).message}${billing.run_id ? ` [run ${billing.run_id}]` : ""}`);
      return {
        ...body,
        answers: markAnswers(body.answers, failures),
        sent: true, destination: provider.url, service: provider.name, billing,
        validation: { ok: failures.length === 0, kind: failures.length ? "invalid_answer" : null, failures },
      };
    }
    const runId = response.headers?.get?.("x-jev-run-id");
    last = `${response.status} from ${provider.url}: ${await errorText(response)}${FAILURES[response.status] ? ` (${FAILURES[response.status]})` : ""}${runId ? ` [run ${runId}]` : ""}`;
    if (!RESENDABLE.includes(response.status) || attempt === attempts) break;
    const after = Number(response.headers?.get?.("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** (attempt - 1));
  }
  throw new Error(last);
}

// The models the key can use. No inference runs, and nothing is charged.
export async function listModels({ provider = resolveProvider(), fetchImpl = globalThis.fetch } = {}) {
  if (!provider) throw noKey();
  const response = await fetchImpl(provider.modelsUrl, { headers: { Authorization: `Bearer ${provider.apiKey}`, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} from ${provider.modelsUrl}: ${await errorText(response)}${FAILURES[response.status] ? ` (${FAILURES[response.status]})` : ""}`);
  return { destination: provider.modelsUrl, service: provider.name, keyName: provider.keyName, models: (await response.json()).models ?? [] };
}

// One number per answer, named for what it measures. For a noul it is the probability of
// yes; for a choice or a score it is the model's confidence in the answer it gives.
export function readAnswer(answer) {
  if (!answer) return { value: null, p: null, p_measures: "nothing: the question was not answered", read_status: "unknown" };
  if (Array.isArray(answer.failures) && answer.failures.length) return { value: null, p: null, p_measures: "nothing: the answer failed validation", read_status: "invalid", failures: answer.failures };
  if (answer.type === "noul") return { value: answer.noul >= 0.5, p: answer.noul, p_measures: "probability that the statement is true", read_status: "satisfied" };
  if (answer.type === "choice") return { value: answer.choice, p: answer.confidence, p_measures: "confidence in the chosen option", probabilities: answer.probabilities, read_status: "satisfied" };
  if (answer.type === "score") return { value: answer.score, p: answer.confidence, p_measures: "confidence in the score", probabilities: answer.probabilities, read_status: "satisfied" };
  return { value: null, p: null, p_measures: `unrecognised answer type ${answer.type}`, read_status: "unknown" };
}
