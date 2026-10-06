// decider — who answers the typed questions. Two are wired:
//
//   dry  answers nothing and sends nothing. It returns the exact request that would leave
//        the host, with its size, so a person can read it before any decider is chosen.
//   jev  TypeSafe's System One endpoint. Needs TYPESAFE_API_KEY. The request leaves this host.
//
// Which one runs is a person's decision (Q1 on the Decision Gate page), not this file's.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
// Pinned, not the alias: thresholds tuned against one version should not move silently
// when `jev-latest` does (https://docs.typesafe.ai/models#aliases).
export const JEV_MODEL = "jev-1.13.0";
// Jev's budget for the state plus the longest question.
export const STATE_TOKEN_BUDGET = 32_000;

export function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function buildRequest(state, questions, model = JEV_MODEL) {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The key, from the environment first, then from one literal line of
// ${TYPESAFE_ENV_FILE:-~/.env}. The file is read, never sourced, and the key is never printed.
export function typesafeKey(env = process.env) {
  if (env.TYPESAFE_API_KEY) return env.TYPESAFE_API_KEY;
  const file = env.TYPESAFE_ENV_FILE || join(homedir(), ".env");
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (m) return m[1].replace(/^(['"])(.*)\1$/, "$2") || null;
  }
  return null;
}

export async function decideJev(request, { apiKey = typesafeKey(), fetchImpl = globalThis.fetch, attempts = 3, url = JEV_URL } = {}) {
  if (!apiKey) throw new Error("no TYPESAFE_API_KEY in the environment or in ~/.env; the jev decider cannot run (--decider dry shows the request).");
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.ok) return { ...(await response.json()), sent: true };
    last = `${response.status} ${await response.text().catch(() => "")}`.trim();
    // 429 and 529 are the documented retryable statuses; anything else is final.
    if (response.status !== 429 && response.status !== 529) break;
    const after = Number(response.headers?.get?.("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** (attempt - 1));
  }
  throw new Error(`TypeSafe answered ${last}`);
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
