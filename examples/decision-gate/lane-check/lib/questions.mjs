// questions — the typed questions a coordinator asks about one lane, in TypeSafe's request
// shape (https://docs.typesafe.ai/api): every question has a type, instructions, and the
// criteria that define its answers. Backticked names point at fields of the state.

export const LANE_STATUS = {
  finished:
    "Every ask in `asks` (or, when `asks` is empty, what `question` and `latest_request` asked for) has matching evidence in `commits`, `pushes`, `files_touched` or `last_messages`, and the session is not waiting on anyone.",
  waiting:
    "The session stopped and its last message, or `unanswered_question_to_person`, asks a person or another session to decide, approve or answer something before it can continue.",
  working:
    "The session is still carrying out the work: `screen.running` is true, or its last message says what it does next without asking anyone.",
  stopped_short:
    "The session stopped without asking anyone, and at least one ask or part of the request has no evidence of being done.",
};

// The class of each question names the thresholds that apply to it in the policy file.
export function buildQuestions(state) {
  const questions = {
    lane_status: {
      class: "lane_status",
      type: "choice",
      instructions: "Where does this agent session stand with the work it was given?",
      criteria: LANE_STATUS,
    },
    claims_finished: {
      class: "claims_finished",
      type: "noul",
      instructions: "Does the most recent entry in `last_messages` say that the work is finished, complete or done?",
      criteria: { true: "It says the work is finished.", false: "It reports progress, asks something, or says what is left." },
    },
    asks_person: {
      class: "asks_person",
      type: "noul",
      instructions: "Does the most recent entry in `last_messages`, or `unanswered_question_to_person`, ask the person to decide, approve, choose or answer something?",
      criteria: { true: "A question or decision is waiting for the person.", false: "Nothing is asked of the person." },
    },
  };
  if (state.asks?.length) {
    state.asks.forEach((ask, index) => {
      questions[`ask_${index + 1}_met`] = {
        class: "ask_met",
        ref: ask.id,
        type: "noul",
        instructions: { ask: { title: ask.title, words: ask.words }, question: "Is `ask` fulfilled, according to `commits`, `pushes`, `files_touched` and `last_messages`?" },
        criteria: { true: "The evidence shows what the ask asked for was done.", false: "The evidence does not show it done, or shows it only partly done." },
      };
    });
  } else if (state.question) {
    questions.request_met = {
      class: "ask_met",
      ref: "question",
      type: "noul",
      instructions: "Is what `question` asked for (and `latest_request`, when present) done, according to `commits`, `pushes`, `files_touched` and `last_messages`?",
      criteria: { true: "The evidence shows the request done.", false: "The evidence does not show it done, or shows it only partly done." },
    };
  }
  return questions;
}

// Strip the fields TypeSafe does not take (class, ref) before sending.
export function wireQuestions(questions) {
  return Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { type: q.type, instructions: q.instructions, criteria: q.criteria }]));
}
