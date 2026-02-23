"""
State Machine Definition Model (Spec 60)

Dataclass-based model for state machine definitions.
Supports both JSON and XML serialization.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class StateKindType(str, Enum):
    """State classification types."""
    NORMAL = "normal"
    FINAL = "final"
    HISTORY = "history"


@dataclass
class ParameterDef:
    """Event parameter definition."""
    name: str
    type: str  # Language-neutral type: string, int, float, bool, object, or custom


@dataclass
class EventDef:
    """Event definition within an event source."""
    id: str
    name: Optional[str] = None
    description: Optional[str] = None
    parameters: list[ParameterDef] = field(default_factory=list)
    pre_action: Optional[str] = None
    post_action: Optional[str] = None


@dataclass
class TimerDef:
    """Timer definition — a specialized event that fires after a duration."""
    id: str
    name: str
    description: Optional[str] = None


@dataclass
class EventSourceDef:
    """Groups related events together. Optionally generates a feeder class."""
    name: str
    file: Optional[str] = None
    feeder: Optional[str] = None
    description: Optional[str] = None
    events: list[EventDef] = field(default_factory=list)
    timers: list[TimerDef] = field(default_factory=list)


@dataclass
class ActionDef:
    """An action executed during state entry/exit or transitions."""
    code: Optional[str] = None
    timer_start: Optional[dict[str, str]] = None  # {"timer": name, "duration": ms}
    timer_stop: Optional[str] = None  # timer name

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "ActionDef":
        if isinstance(d, str):
            return ActionDef(code=d)
        return ActionDef(
            code=d.get("code"),
            timer_start=d.get("timerStart"),
            timer_stop=d.get("timerStop"),
        )


@dataclass
class TransitionDef:
    """A transition triggered by an event, with optional guard and actions."""
    event: str
    next_state: Optional[str] = None
    condition: Optional[str] = None
    description: Optional[str] = None
    actions: list[ActionDef] = field(default_factory=list)


@dataclass
class ParallelDef:
    """Parallel region containing orthogonal sub-states."""
    next_state: str
    states: list["StateDef"] = field(default_factory=list)


@dataclass
class StateDef:
    """State definition — can be leaf, composite, final, history, or parallel."""
    name: str
    kind: StateKindType = StateKindType.NORMAL
    description: Optional[str] = None
    on_entry: list[ActionDef] = field(default_factory=list)
    on_exit: list[ActionDef] = field(default_factory=list)
    transitions: list[TransitionDef] = field(default_factory=list)
    states: list["StateDef"] = field(default_factory=list)  # child states
    parallel: Optional[ParallelDef] = None

    @property
    def is_leaf(self) -> bool:
        return len(self.states) == 0 and self.parallel is None

    @property
    def is_composite(self) -> bool:
        return len(self.states) > 0

    @property
    def is_final(self) -> bool:
        return self.kind == StateKindType.FINAL

    @property
    def is_history(self) -> bool:
        return self.kind == StateKindType.HISTORY

    @property
    def is_parallel(self) -> bool:
        return self.parallel is not None


@dataclass
class ObjectRef:
    """Reference to a domain object accessible in actions/conditions."""
    instance: str
    cls: str  # 'class' is reserved in Python
    namespace: Optional[str] = None


@dataclass
class ContextConfig:
    """Override context class/instance naming."""
    cls: Optional[str] = None
    instance: Optional[str] = None


@dataclass
class SettingsModel:
    """State machine settings."""
    namespace: str
    asynchronous: bool = False
    name: Optional[str] = None
    objects: list[ObjectRef] = field(default_factory=list)
    context: Optional[ContextConfig] = None
    using: list[str] = field(default_factory=list)


@dataclass
class StateMachineDefinition:
    """
    Complete state machine definition (Spec 60).

    The canonical representation of a state machine, consisting of:
    - settings: namespace, name, async mode, object references
    - event_sources: grouped events with parameters and timers
    - root_state: hierarchical state tree
    """
    settings: SettingsModel
    event_sources: list[EventSourceDef] = field(default_factory=list)
    root_state: Optional[StateDef] = None

    def to_json(self, indent: int = 2) -> str:
        """Serialize to JSON string."""
        return json.dumps(self._to_dict(), indent=indent)

    def _to_dict(self) -> dict[str, Any]:
        return {
            "settings": self._settings_to_dict(),
            "events": [self._event_source_to_dict(es) for es in self.event_sources],
            "state": self._state_to_dict(self.root_state) if self.root_state else None,
        }

    def _settings_to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "namespace": self.settings.namespace,
            "asynchronous": self.settings.asynchronous,
        }
        if self.settings.name:
            d["name"] = self.settings.name
        if self.settings.objects:
            d["objects"] = [
                {"instance": o.instance, "class": o.cls, **({"namespace": o.namespace} if o.namespace else {})}
                for o in self.settings.objects
            ]
        if self.settings.context:
            ctx: dict[str, str] = {}
            if self.settings.context.cls:
                ctx["class"] = self.settings.context.cls
            if self.settings.context.instance:
                ctx["instance"] = self.settings.context.instance
            if ctx:
                d["context"] = ctx
        if self.settings.using:
            d["using"] = self.settings.using
        return d

    def _event_source_to_dict(self, es: EventSourceDef) -> dict[str, Any]:
        d: dict[str, Any] = {"name": es.name}
        if es.file:
            d["file"] = es.file
        if es.feeder:
            d["feeder"] = es.feeder
        if es.events:
            d["events"] = [self._event_to_dict(e) for e in es.events]
        if es.timers:
            d["timers"] = [{"id": t.id, "name": t.name} for t in es.timers]
        return d

    def _event_to_dict(self, e: EventDef) -> dict[str, Any]:
        d: dict[str, Any] = {"id": e.id}
        if e.name:
            d["name"] = e.name
        if e.parameters:
            d["parameters"] = [{"name": p.name, "type": p.type} for p in e.parameters]
        return d

    def _state_to_dict(self, s: StateDef) -> dict[str, Any]:
        d: dict[str, Any] = {"name": s.name}
        if s.kind != StateKindType.NORMAL:
            d["kind"] = s.kind.value
        if s.on_entry:
            d["onEntry"] = {"actions": [self._action_to_dict(a) for a in s.on_entry]}
        if s.on_exit:
            d["onExit"] = {"actions": [self._action_to_dict(a) for a in s.on_exit]}
        if s.transitions:
            d["transitions"] = [self._transition_to_dict(t) for t in s.transitions]
        if s.states:
            d["states"] = [self._state_to_dict(c) for c in s.states]
        if s.parallel:
            d["parallel"] = {
                "nextState": s.parallel.next_state,
                "states": [self._state_to_dict(ps) for ps in s.parallel.states],
            }
        return d

    def _transition_to_dict(self, t: TransitionDef) -> dict[str, Any]:
        d: dict[str, Any] = {"event": t.event}
        if t.next_state:
            d["nextState"] = t.next_state
        if t.condition:
            d["condition"] = t.condition
        if t.actions:
            d["actions"] = [self._action_to_dict(a) for a in t.actions]
        return d

    def _action_to_dict(self, a: ActionDef) -> dict[str, Any]:
        if a.code:
            return {"code": a.code}
        if a.timer_start:
            return {"timerStart": a.timer_start}
        if a.timer_stop:
            return {"timerStop": a.timer_stop}
        return {}
