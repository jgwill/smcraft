import type {
  ActionDef,
  EventDef,
  ParameterDef,
  StateDef,
  StateMachineDefinition,
  TransitionDef,
} from "@/types/definition";

function collectStates(root: StateDef): StateDef[] {
  const states = [root];
  for (const child of root.states ?? []) {
    states.push(...collectStates(child));
  }
  return states;
}

function formatParameters(parameters?: ParameterDef[]): string {
  if (!parameters?.length) return "none";
  return parameters
    .map((param) => {
      const description = param.description ? ` — ${param.description}` : "";
      return `- \`${param.name}: ${param.type}\`${description}`;
    })
    .join("\n");
}

function formatActions(actions?: ActionDef[]): string {
  if (!actions?.length) return "none";
  return actions
    .map((action) => {
      if (action.code) return action.code;
      if (action.timerStart) return `start timer ${action.timerStart.timer} (${action.timerStart.duration})`;
      if (action.timerStop) return `stop timer ${action.timerStop}`;
      return action.name ?? action.action;
    })
    .join("; ");
}

function formatLifecyclePath(root: StateDef): string {
  return (root.states ?? []).map((state) => state.name).join(" → ");
}

function inferHumanReview(transition: TransitionDef, nextState?: StateDef): string {
  const nextName = nextState?.name ?? transition.nextState ?? "";
  return /hitl|review|approved|rejected/i.test(`${transition.event} ${nextName}`) ? "yes" : "no";
}

function summarizeNextPaths(stateMap: Map<string, StateDef>, nextStateName?: string): string {
  if (!nextStateName) return "none";
  const state = stateMap.get(nextStateName);
  if (!state?.transitions?.length) return "terminal";
  return state.transitions
    .map((transition) => `${transition.event} → ${transition.nextState ?? "(internal)"}`)
    .join("; ");
}

export function generateMachineSpecification(definition: StateMachineDefinition): string {
  const machineName = definition.settings.name ?? definition.state.name;
  const states = collectStates(definition.state);
  const stateMap = new Map(states.map((state) => [state.name, state]));
  const events = definition.events.flatMap((source) => (source.events ?? []).map((event) => ({ source: source.name, event })));

  const lines: string[] = [
    `# ${machineName} Lifecycle Specification`,
    "",
    "## Design / Runtime Boundary",
    "",
    "- **Semantic model**: the SMDF definition preserves state, event, transition, payload, condition, and action intent.",
    "- **Runtime substrate**: generated Python/TypeScript code executes the machine while `ObserverTrace` captures ordered provenance.",
    "- **Design artifact**: this specification translates the same machine into a reviewable contract for agents and humans.",
    "",
    "## Canonical Lifecycle",
    "",
    formatLifecyclePath(definition.state),
    "",
    "## State Definitions",
    "",
    "| State | Kind | Purpose | Entry behavior | Exit behavior |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const state of definition.state.states ?? []) {
    lines.push(
      `| ${state.name} | ${state.kind ?? "normal"} | ${state.description ?? "—"} | ${formatActions(state.onEntry?.actions)} | ${formatActions(state.onExit?.actions)} |`,
    );
  }

  lines.push("", "## Transition Events and Payload Contracts", "");

  for (const { source, event } of events) {
    lines.push(`### ${event.id}`);
    lines.push(`- Source: ${source}`);
    lines.push(`- Description: ${event.description ?? "—"}`);
    lines.push(`- Payload contract:\n${formatParameters(event.parameters)}`);
    lines.push(`- Optional pre-hook: ${event.preAction ?? "none"}`);
    lines.push(`- Optional post-hook: ${event.postAction ?? "none"}`);
    lines.push("");
  }

  lines.push("## Transition Contracts", "");
  lines.push("| From | Event | Payload | Intent | Preconditions | Hook behavior | Trace emitted | HITL | Next state | Failure / retry path |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const state of states) {
    for (const transition of state.transitions ?? []) {
      const event = events.find((candidate) => candidate.event.id === transition.event)?.event;
      const nextState = transition.nextState ? stateMap.get(transition.nextState) : undefined;
      const hook = formatActions(transition.actions);
      const trace = `ObserverTrace transition_begin/transition_end for ${transition.event}`;
      lines.push(
        `| ${state.name} | ${transition.event} | ${(event?.parameters ?? []).map((parameter) => `\`${parameter.name}: ${parameter.type}\``).join("<br/>") || "none"} | ${transition.description ?? event?.description ?? "—"} | ${transition.condition ?? "none"} | ${hook} | ${trace} | ${inferHumanReview(transition, nextState)} | ${transition.nextState ?? "self"} | ${summarizeNextPaths(stateMap, transition.nextState)} |`,
      );
    }
  }

  lines.push(
    "",
    "## Agent / Workflow Scaffold",
    "",
    ...((definition.state.states ?? []).map((state) => `- In \`${state.name}\`, the agent/system should: ${state.description ?? "document the intended work."}`)),
    "",
    "## HITL Review Checklist",
    "",
  );

  const hitlStates = (definition.state.states ?? []).filter((state) => /hitl|review/i.test(`${state.name} ${state.description ?? ""}`));
  if (hitlStates.length === 0) {
    lines.push("- No explicit HITL state defined.");
  } else {
    for (const state of hitlStates) {
      lines.push(`### ${state.name}`);
      lines.push("- Confirm the review payload contains enough evidence to approve or reject.");
      lines.push("- Record reviewer identity, rationale, and the triggering event payload.");
      lines.push("- Verify the chosen next event preserves provenance and retry intent.");
      lines.push("");
    }
  }

  lines.push(
    "## Provenance / Observer Expectations",
    "",
    "- `ObserverTrace` should expose immutable snapshots for downstream storage or replay.",
    "- Every state transition should produce ordered `transition_begin` and `transition_end` records with sequence and timestamp.",
    "- Entry/exit events should bracket state activation so downstream systems can reconstruct lifecycle history.",
    "- Timer events, if used, should appear in the same trace stream for retry and SLA analysis.",
  );

  return lines.join("\n");
}

export function generateTransitionContracts(definition: StateMachineDefinition): string {
  const events = new Map<string, EventDef>();
  for (const source of definition.events) {
    for (const event of source.events ?? []) {
      events.set(event.id, event);
    }
  }

  const lines = ["# Transition / Event Contract Notes", ""];
  for (const state of collectStates(definition.state)) {
    for (const transition of state.transitions ?? []) {
      const event = events.get(transition.event);
      lines.push(`## ${state.name} -> ${transition.nextState ?? state.name} via ${transition.event}`);
      lines.push(`- Intent: ${transition.description ?? event?.description ?? "—"}`);
      lines.push(`- Payload: ${formatParameters(event?.parameters)}`);
      lines.push(`- Preconditions: ${transition.condition ?? "none"}`);
      lines.push(`- Hook behavior: ${formatActions(transition.actions)}`);
      lines.push(`- Trace: ObserverTrace transition_begin/transition_end for ${transition.event}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
