from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path


AGENT_LIFECYCLE_TEMPLATE = {
    "settings": {
        "namespace": "Agent.Runtime",
        "name": "AgentLifecycle",
        "asynchronous": True,
        "context": {"class": "AgentLifecycleContext"},
    },
    "events": [
        {
            "name": "WorkUnitEvents",
            "feeder": "WorkUnitFeeder",
            "events": [
                {
                    "id": "WorkUnitPlanned",
                    "description": "Planning metadata has been captured.",
                    "parameters": [
                        {"name": "workUnitId", "type": "string", "description": "Stable identifier for the work unit."},
                        {
                            "name": "planSummary",
                            "type": "object",
                            "description": "Planning output, routing notes, and dependencies.",
                        },
                    ],
                    "postAction": "Suggested provenance expectation: implementations may emit ObserverTrace transition_begin/transition_end around Created -> Planned.",
                },
                {
                    "id": "WorkUnitStarted",
                    "description": "Execution has started.",
                    "parameters": [
                        {
                            "name": "executor",
                            "type": "string",
                            "description": "Runtime or agent responsible for execution.",
                        },
                        {
                            "name": "attempt",
                            "type": "integer",
                            "description": "Execution attempt number for retry-aware flows.",
                        },
                    ],
                    "preAction": "Validate the planning envelope before entering Running.",
                },
                {
                    "id": "HitlRequested",
                    "description": "Execution is waiting for human review.",
                    "parameters": [
                        {
                            "name": "reviewPacket",
                            "type": "object",
                            "description": "Human review bundle, evidence, and rationale.",
                        }
                    ],
                    "preAction": "Pause execution and prepare a human-readable review artifact.",
                    "postAction": "Queue the work unit for HITL review and emit provenance.",
                },
                {
                    "id": "HitlApproved",
                    "description": "A human approved the pending work.",
                    "parameters": [
                        {"name": "reviewer", "type": "string", "description": "Human reviewer identity."},
                        {"name": "notes", "type": "string", "description": "Optional approval notes."},
                    ],
                },
                {
                    "id": "HitlRejected",
                    "description": "A human rejected the pending work.",
                    "parameters": [
                        {"name": "reviewer", "type": "string", "description": "Human reviewer identity."},
                        {"name": "reason", "type": "string", "description": "Why the work unit was rejected."},
                    ],
                },
                {
                    "id": "ExecutionResumed",
                    "description": "Approved work resumed execution.",
                    "parameters": [
                        {
                            "name": "resumeToken",
                            "type": "string",
                            "description": "Correlation token proving the review gate was cleared.",
                        }
                    ],
                },
                {
                    "id": "RetryScheduled",
                    "description": "A failed or rejected unit was rescheduled.",
                    "parameters": [
                        {"name": "attempt", "type": "integer", "description": "The next attempt number."},
                        {"name": "reason", "type": "string", "description": "Why the retry was scheduled."},
                    ],
                },
                {
                    "id": "WorkUnitCompleted",
                    "description": "Execution completed successfully.",
                    "parameters": [
                        {
                            "name": "resultSummary",
                            "type": "object",
                            "description": "Runtime outputs and completion metadata.",
                        }
                    ],
                },
                {
                    "id": "WorkUnitFailed",
                    "description": "Execution failed and needs recovery.",
                    "parameters": [
                        {"name": "errorCode", "type": "string", "description": "Failure category or code."},
                        {"name": "details", "type": "string", "description": "Human-readable failure context."},
                    ],
                    "postAction": "Persist failure provenance before routing to retry or archive.",
                },
                {
                    "id": "WorkUnitArchived",
                    "description": "Execution provenance was archived.",
                    "parameters": [
                        {
                            "name": "archiveUri",
                            "type": "string",
                            "description": "Location of archived provenance or artifacts.",
                        }
                    ],
                },
            ],
        }
    ],
    "state": {
        "name": "Root",
        "states": [
            {
                "name": "Created",
                "description": "A work unit exists but has not been planned yet.",
                "transitions": [
                    {
                        "event": "WorkUnitPlanned",
                        "nextState": "Planned",
                        "description": "Capture planning intent, payload contracts, and retry metadata before execution begins.",
                    }
                ],
            },
            {
                "name": "Planned",
                "description": "The work unit has inputs, routing, and retry metadata.",
                "transitions": [
                    {
                        "event": "WorkUnitStarted",
                        "nextState": "Running",
                        "description": "Promote the planned work unit into active execution when runtime preconditions pass.",
                    }
                ],
            },
            {
                "name": "Running",
                "description": "Runtime adapters are actively executing the work unit.",
                "transitions": [
                    {
                        "event": "HitlRequested",
                        "nextState": "WaitingForHITL",
                        "description": "Pause autonomous execution and route the work unit into a human review checkpoint.",
                    },
                    {
                        "event": "WorkUnitCompleted",
                        "nextState": "Completed",
                        "description": "Finalize the successful execution branch before archival.",
                    },
                    {
                        "event": "WorkUnitFailed",
                        "nextState": "Failed",
                        "description": "Capture runtime failure context so recovery or archival can be decided explicitly.",
                    },
                ],
            },
            {
                "name": "WaitingForHITL",
                "description": "Execution is paused behind a human review gate.",
                "transitions": [
                    {
                        "event": "HitlApproved",
                        "nextState": "Approved",
                        "description": "Record approval provenance and allow the work unit to continue.",
                    },
                    {
                        "event": "HitlRejected",
                        "nextState": "Rejected",
                        "description": "Record rejection rationale so the workflow can retry or terminate safely.",
                    },
                ],
            },
            {
                "name": "Approved",
                "description": "The work unit passed human review and can resume.",
                "transitions": [
                    {
                        "event": "ExecutionResumed",
                        "nextState": "Running",
                        "description": "Resume the autonomous path after human approval has been preserved in provenance.",
                    }
                ],
            },
            {
                "name": "Rejected",
                "description": "The work unit was rejected and must be replanned or abandoned.",
                "transitions": [
                    {
                        "event": "RetryScheduled",
                        "nextState": "Planned",
                        "description": "Route rejected work back through planning with explicit retry context.",
                    },
                    {
                        "event": "WorkUnitArchived",
                        "nextState": "Archived",
                        "description": "Archive rejected work units that should not be retried.",
                    },
                ],
            },
            {
                "name": "Completed",
                "description": "Execution finished successfully and is ready for archival.",
                "transitions": [
                    {
                        "event": "WorkUnitArchived",
                        "nextState": "Archived",
                        "description": "Persist provenance, outputs, and terminal metadata for completed work.",
                    }
                ],
            },
            {
                "name": "Failed",
                "description": "Execution failed and can either be retried or archived.",
                "transitions": [
                    {
                        "event": "RetryScheduled",
                        "nextState": "Planned",
                        "description": "Re-enter planning with failure context so the next attempt is intentional.",
                    },
                    {
                        "event": "WorkUnitArchived",
                        "nextState": "Archived",
                        "description": "Close out failed work units whose provenance should be retained without another attempt.",
                    },
                ],
            },
            {
                "name": "Archived",
                "kind": "final",
                "description": "Execution lineage has been captured for provenance and replay.",
            },
        ],
    },
}

OBSERVER_TRACE_EXAMPLE = '''"""Minimal runtime provenance example for consumers.

This snippet demonstrates how to attach ObserverTrace to a context,
run a transition, and inspect the ordered immutable trace snapshot.
"""

from smcraft import Context, ObserverTrace, State, StateKind, TransitionHelper

root = State("Root", StateKind.ROOT)
created = State("Created", StateKind.LEAF, root)
running = State("Running", StateKind.LEAF, root)

trace = ObserverTrace()
ctx = Context("AgentLifecycle")
ctx.state_current = created
ctx.set_observer(trace)

TransitionHelper.process_transition_begin(ctx, created, running, "WorkUnitStarted")
ctx.state_current = running
TransitionHelper.process_transition_end(ctx, created, running)

for event in trace.snapshot():
    print(event)
'''


@dataclass(frozen=True)
class SkillDefinition:
    name: str
    summary: str
    files: tuple[str, ...]


SKILLS = {
    "agent-lifecycle": SkillDefinition(
        name="agent-lifecycle",
        summary="Install the durable agent work-unit lifecycle starter as an SMDF definition.",
        files=("agent_lifecycle.smdf.json",),
    ),
    "observer-trace": SkillDefinition(
        name="observer-trace",
        summary="Install a runnable Python example that demonstrates immutable runtime provenance capture.",
        files=("observer_trace_example.py",),
    ),
}


def list_skills() -> list[SkillDefinition]:
    return [SKILLS[name] for name in sorted(SKILLS)]


def get_agent_lifecycle_template() -> dict:
    return deepcopy(AGENT_LIFECYCLE_TEMPLATE)


def install_skill(name: str, output_dir: str | Path) -> list[Path]:
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    if name == "agent-lifecycle":
        output_file = target_dir / "agent_lifecycle.smdf.json"
        output_file.write_text(json.dumps(get_agent_lifecycle_template(), indent=2) + "\n", encoding="utf-8")
        return [output_file]

    if name == "observer-trace":
        output_file = target_dir / "observer_trace_example.py"
        output_file.write_text(OBSERVER_TRACE_EXAMPLE, encoding="utf-8")
        return [output_file]

    available = ", ".join(f"'{skill}'" for skill in sorted(SKILLS))
    raise ValueError(f"Unknown skill: {name}. Available skills: {available}")
