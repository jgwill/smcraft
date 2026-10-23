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

export async function decideDry(request) {
  return {
    model: "dry",
    answers: {},
    usage: null,
    sent: false,
    estimated_input_tokens: estimateTokens(request),
    within_budget: estimateTokens(request.state) < STATE_TOKEN_BUDGET,
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
export async function decideJev(request, { provider = resolveProvider(), fetchImpl = globalThis.fetch, attempts = 3 } = {}) {
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
      return { ...body, sent: true, destination: provider.url, service: provider.name, billing: { ...(body.billing ?? {}), ...billingOf(response.headers) } };
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
  if (answer.type === "noul") return { value: answer.noul >= 0.5, p: answer.noul, p_measures: "probability that the statement is true", read_status: "satisfied" };
  if (answer.type === "choice") return { value: answer.choice, p: answer.confidence, p_measures: "confidence in the chosen option", probabilities: answer.probabilities, read_status: "satisfied" };
  if (answer.type === "score") return { value: answer.score, p: answer.confidence, p_measures: "confidence in the score", probabilities: answer.probabilities, read_status: "satisfied" };
  return { value: null, p: null, p_measures: `unrecognised answer type ${answer.type}`, read_status: "unknown" };
}
