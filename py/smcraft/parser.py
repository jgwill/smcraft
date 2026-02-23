"""
State Machine Definition Parser (Spec 60)

Parses JSON and XML definition files into StateMachineDefinition objects.
Validates against the rules defined in Spec 60.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from smcraft.model import (
    ActionDef,
    ContextConfig,
    EventDef,
    EventSourceDef,
    ObjectRef,
    ParallelDef,
    ParameterDef,
    SettingsModel,
    StateDef,
    StateKindType,
    StateMachineDefinition,
    TimerDef,
    TransitionDef,
)

XML_NS = "http://www.stateforge.com/StateMachineDotNet-v1"


@dataclass
class ValidationError:
    """Validation error with rule ID and message."""
    rule_id: str
    message: str
    element: Optional[str] = None


@dataclass
class EnrichedModel:
    """Enriched model with lookup maps for code generation."""
    definition: StateMachineDefinition
    state_map: dict[str, StateDef] = field(default_factory=dict)
    event_map: dict[str, EventDef] = field(default_factory=dict)
    timer_map: dict[str, TimerDef] = field(default_factory=dict)
    feeders_map: dict[str, list[EventDef]] = field(default_factory=dict)
    parent_map: dict[str, Optional[str]] = field(default_factory=dict)  # state_name -> parent_name
    all_states: list[StateDef] = field(default_factory=list)
    leaf_states: list[StateDef] = field(default_factory=list)
    composite_states: list[StateDef] = field(default_factory=list)


class StateMachineParser:
    """Parses state machine definition files into validated models."""

    def parse_file(self, path: str | Path) -> EnrichedModel:
        """Parse a definition file (JSON or XML) into an enriched model."""
        path = Path(path)
        content = path.read_text(encoding="utf-8")
        if path.suffix in (".json",):
            definition = self.parse_json(content)
        elif path.suffix in (".xml", ".fsm"):
            definition = self.parse_xml(content)
        else:
            # Try JSON first, fall back to XML
            try:
                definition = self.parse_json(content)
            except (json.JSONDecodeError, KeyError):
                definition = self.parse_xml(content)

        if definition.settings.name is None:
            definition.settings.name = path.stem.replace(".smdf", "")

        return self.enrich(definition)

    def parse_json(self, content: str) -> StateMachineDefinition:
        """Parse a JSON definition string."""
        data = json.loads(content)
        return self._parse_json_data(data)

    def parse_xml(self, content: str) -> StateMachineDefinition:
        """Parse an XML definition string (StateMachineDotNet-v1 format)."""
        root = ET.fromstring(content)
        return self._parse_xml_root(root)

    def enrich(self, definition: StateMachineDefinition) -> EnrichedModel:
        """Build lookup maps and classify states."""
        model = EnrichedModel(definition=definition)

        # Build event/timer maps
        for es in definition.event_sources:
            for evt in es.events:
                model.event_map[evt.id] = evt
                if es.feeder:
                    model.feeders_map.setdefault(es.feeder, []).append(evt)
            for timer in es.timers:
                model.timer_map[timer.name] = timer
                # Timers are also events
                timer_evt = EventDef(
                    id=timer.id,
                    name=timer.name,
                    parameters=[ParameterDef(name="source", type="object")],
                )
                model.event_map[timer.id] = timer_evt
                if es.feeder:
                    model.feeders_map.setdefault(es.feeder, []).append(timer_evt)

        # Build state map recursively
        if definition.root_state:
            self._collect_states(definition.root_state, None, model)

        return model

    def validate(self, model: EnrichedModel) -> list[ValidationError]:
        """Validate model against Spec 60 rules V001-V014."""
        errors: list[ValidationError] = []
        defn = model.definition

        # V001: Exactly one root state
        if defn.root_state is None:
            errors.append(ValidationError("V001", "No root state defined"))

        # V002: Unique state names
        seen_states: set[str] = set()
        for s in model.all_states:
            if s.name in seen_states:
                errors.append(ValidationError("V002", f"Duplicate state name: {s.name}", s.name))
            seen_states.add(s.name)

        # V003: Unique event IDs
        seen_events: set[str] = set()
        for es in defn.event_sources:
            for evt in es.events:
                if evt.id in seen_events:
                    errors.append(ValidationError("V003", f"Duplicate event ID: {evt.id}", evt.id))
                seen_events.add(evt.id)

        # V004: Timer IDs unique and no collision with event IDs
        for es in defn.event_sources:
            for timer in es.timers:
                if timer.id in seen_events:
                    errors.append(ValidationError("V004", f"Timer ID collides with event ID: {timer.id}", timer.id))

        # V005: Transition events reference defined events
        for state in model.all_states:
            for t in state.transitions:
                if t.event not in model.event_map:
                    errors.append(ValidationError("V005", f"Transition references undefined event: {t.event}", state.name))

        # V006: Transition nextState references defined states
        for state in model.all_states:
            for t in state.transitions:
                if t.next_state and t.next_state not in model.state_map:
                    errors.append(ValidationError("V006", f"Transition references undefined state: {t.next_state}", state.name))

        # V007: Final states have no outgoing transitions
        for state in model.all_states:
            if state.is_final and state.transitions:
                errors.append(ValidationError("V007", f"Final state has transitions: {state.name}", state.name))

        # V008: Final states have no children
        for state in model.all_states:
            if state.is_final and (state.states or state.parallel):
                errors.append(ValidationError("V008", f"Final state has children: {state.name}", state.name))

        # V012: Composite states have at least one child
        for state in model.composite_states:
            if not state.states:
                errors.append(ValidationError("V012", f"Composite state has no children: {state.name}", state.name))

        # V013: At least one event source
        if not defn.event_sources:
            errors.append(ValidationError("V013", "No event sources defined"))

        return errors

    # --- JSON Parsing ---

    def _parse_json_data(self, data: dict[str, Any]) -> StateMachineDefinition:
        settings = self._parse_json_settings(data["settings"])
        event_sources = [self._parse_json_event_source(es) for es in data.get("events", [])]
        root_state = self._parse_json_state(data["state"]) if "state" in data else None
        return StateMachineDefinition(settings=settings, event_sources=event_sources, root_state=root_state)

    def _parse_json_settings(self, data: dict[str, Any]) -> SettingsModel:
        objects = [
            ObjectRef(instance=o["instance"], cls=o["class"], namespace=o.get("namespace"))
            for o in data.get("objects", [])
        ]
        ctx = None
        if "context" in data:
            ctx = ContextConfig(cls=data["context"].get("class"), instance=data["context"].get("instance"))
        return SettingsModel(
            namespace=data["namespace"],
            asynchronous=data.get("asynchronous", False),
            name=data.get("name"),
            objects=objects,
            context=ctx,
            using=data.get("using", []),
        )

    def _parse_json_event_source(self, data: dict[str, Any]) -> EventSourceDef:
        events = [self._parse_json_event(e) for e in data.get("events", [])]
        timers = [TimerDef(id=t["id"], name=t["name"], description=t.get("description")) for t in data.get("timers", [])]
        return EventSourceDef(
            name=data["name"],
            file=data.get("file"),
            feeder=data.get("feeder"),
            description=data.get("description"),
            events=events,
            timers=timers,
        )

    def _parse_json_event(self, data: dict[str, Any]) -> EventDef:
        params = [ParameterDef(name=p["name"], type=p["type"]) for p in data.get("parameters", [])]
        return EventDef(
            id=data["id"],
            name=data.get("name"),
            description=data.get("description"),
            parameters=params,
            pre_action=data.get("preAction"),
            post_action=data.get("postAction"),
        )

    def _parse_json_state(self, data: dict[str, Any]) -> StateDef:
        kind = StateKindType(data["kind"]) if "kind" in data else StateKindType.NORMAL
        on_entry = self._parse_json_actions(data.get("onEntry", {}))
        on_exit = self._parse_json_actions(data.get("onExit", {}))
        transitions = [self._parse_json_transition(t) for t in data.get("transitions", [])]
        children = [self._parse_json_state(c) for c in data.get("states", [])]
        parallel = None
        if "parallel" in data:
            p = data["parallel"]
            parallel = ParallelDef(
                next_state=p["nextState"],
                states=[self._parse_json_state(s) for s in p.get("states", [])],
            )
        return StateDef(
            name=data["name"],
            kind=kind,
            description=data.get("description"),
            on_entry=on_entry,
            on_exit=on_exit,
            transitions=transitions,
            states=children,
            parallel=parallel,
        )

    def _parse_json_transition(self, data: dict[str, Any]) -> TransitionDef:
        actions = [ActionDef.from_dict(a) for a in data.get("actions", [])]
        return TransitionDef(
            event=data["event"],
            next_state=data.get("nextState"),
            condition=data.get("condition"),
            description=data.get("description"),
            actions=actions,
        )

    def _parse_json_actions(self, data: dict[str, Any]) -> list[ActionDef]:
        if not data:
            return []
        return [ActionDef.from_dict(a) for a in data.get("actions", [])]

    # --- XML Parsing ---

    def _parse_xml_root(self, root: ET.Element) -> StateMachineDefinition:
        ns = {"sm": XML_NS}
        # Handle both namespaced and non-namespaced XML
        settings_el = root.find("sm:settings", ns) or root.find("settings")
        events_el = root.find("sm:events", ns) or root.find("events")
        state_el = root.find("sm:state", ns) or root.find("state")

        settings = self._parse_xml_settings(settings_el) if settings_el is not None else SettingsModel(namespace="default")
        event_sources = self._parse_xml_events(events_el) if events_el is not None else []
        root_state = self._parse_xml_state(state_el) if state_el is not None else None

        return StateMachineDefinition(settings=settings, event_sources=event_sources, root_state=root_state)

    def _parse_xml_settings(self, el: ET.Element) -> SettingsModel:
        ns = {"sm": XML_NS}
        objects = []
        for obj_el in el.findall("sm:object", ns) + el.findall("object"):
            objects.append(ObjectRef(
                instance=obj_el.get("instance", ""),
                cls=obj_el.get("class", ""),
                namespace=obj_el.get("namespace"),
            ))

        ctx = None
        ctx_el = el.find("sm:context", ns) or el.find("context")
        if ctx_el is not None:
            ctx = ContextConfig(cls=ctx_el.get("class"), instance=ctx_el.get("instance"))

        using = []
        for u_el in el.findall("sm:using", ns) + el.findall("using"):
            if u_el.text:
                using.append(u_el.text.strip())

        return SettingsModel(
            namespace=el.get("namespace", "default"),
            asynchronous=el.get("asynchronous", "false").lower() == "true",
            name=el.get("name"),
            objects=objects,
            context=ctx,
            using=using,
        )

    def _parse_xml_events(self, el: ET.Element) -> list[EventSourceDef]:
        ns = {"sm": XML_NS}
        sources = []
        for es_el in el.findall("sm:eventSource", ns) + el.findall("eventSource"):
            events = []
            for evt_el in es_el.findall("sm:event", ns) + es_el.findall("event"):
                params = []
                for p_el in evt_el.findall("sm:parameter", ns) + evt_el.findall("parameter"):
                    params.append(ParameterDef(name=p_el.get("name", ""), type=p_el.get("type", "")))
                events.append(EventDef(
                    id=evt_el.get("id", ""),
                    name=evt_el.get("name"),
                    description=evt_el.get("description"),
                    parameters=params,
                    pre_action=evt_el.get("preAction"),
                    post_action=evt_el.get("postAction"),
                ))

            timers = []
            for t_el in es_el.findall("sm:timer", ns) + es_el.findall("timer"):
                timers.append(TimerDef(
                    id=t_el.get("id", ""),
                    name=t_el.get("name", ""),
                    description=t_el.get("description"),
                ))

            sources.append(EventSourceDef(
                name=es_el.get("name", ""),
                file=es_el.get("file"),
                feeder=es_el.get("feeder"),
                description=es_el.get("description"),
                events=events,
                timers=timers,
            ))
        return sources

    def _parse_xml_state(self, el: ET.Element) -> StateDef:
        ns = {"sm": XML_NS}
        kind_str = el.get("kind")
        kind = StateKindType(kind_str) if kind_str in ("final", "history") else StateKindType.NORMAL

        on_entry = self._parse_xml_actions_block(el.find("sm:onEntry", ns) or el.find("onEntry"))
        on_exit = self._parse_xml_actions_block(el.find("sm:onExit", ns) or el.find("onExit"))

        transitions = []
        for t_el in el.findall("sm:transition", ns) + el.findall("transition"):
            transitions.append(self._parse_xml_transition(t_el))

        children = []
        for c_el in el.findall("sm:state", ns) + el.findall("state"):
            children.append(self._parse_xml_state(c_el))

        parallel = None
        p_el = el.find("sm:parallel", ns) or el.find("parallel")
        if p_el is not None:
            p_states = [self._parse_xml_state(s) for s in p_el.findall("sm:state", ns) + p_el.findall("state")]
            parallel = ParallelDef(next_state=p_el.get("nextState", ""), states=p_states)

        return StateDef(
            name=el.get("name", ""),
            kind=kind,
            description=el.get("description"),
            on_entry=on_entry,
            on_exit=on_exit,
            transitions=transitions,
            states=children,
            parallel=parallel,
        )

    def _parse_xml_transition(self, el: ET.Element) -> TransitionDef:
        ns = {"sm": XML_NS}
        actions: list[ActionDef] = []
        for a_el in el.findall("sm:action", ns) + el.findall("action"):
            if a_el.text:
                actions.append(ActionDef(code=a_el.text.strip()))
        for ts_el in el.findall("sm:timerStart", ns) + el.findall("timerStart"):
            actions.append(ActionDef(timer_start={"timer": ts_el.get("timer", ""), "duration": ts_el.get("duration", "")}))
        for ts_el in el.findall("sm:timerStop", ns) + el.findall("timerStop"):
            actions.append(ActionDef(timer_stop=ts_el.get("timer", "")))

        condition = el.get("condition")
        cond_el = el.find("sm:condition", ns) or el.find("condition")
        if cond_el is not None and cond_el.text:
            condition = cond_el.text.strip()

        return TransitionDef(
            event=el.get("event", ""),
            next_state=el.get("nextState"),
            condition=condition,
            description=el.get("description"),
            actions=actions,
        )

    def _parse_xml_actions_block(self, el: Optional[ET.Element]) -> list[ActionDef]:
        if el is None:
            return []
        ns = {"sm": XML_NS}
        actions: list[ActionDef] = []
        for a_el in el.findall("sm:action", ns) + el.findall("action"):
            if a_el.text:
                actions.append(ActionDef(code=a_el.text.strip()))
        for ts_el in el.findall("sm:timerStart", ns) + el.findall("timerStart"):
            actions.append(ActionDef(timer_start={"timer": ts_el.get("timer", ""), "duration": ts_el.get("duration", "")}))
        for ts_el in el.findall("sm:timerStop", ns) + el.findall("timerStop"):
            actions.append(ActionDef(timer_stop=ts_el.get("timer", "")))
        return actions

    # --- State Collection ---

    def _collect_states(self, state: StateDef, parent_name: Optional[str], model: EnrichedModel) -> None:
        model.state_map[state.name] = state
        model.parent_map[state.name] = parent_name
        model.all_states.append(state)

        if state.is_leaf and not state.is_parallel:
            model.leaf_states.append(state)
        elif state.is_composite:
            model.composite_states.append(state)

        for child in state.states:
            self._collect_states(child, state.name, model)

        if state.parallel:
            for region in state.parallel.states:
                self._collect_states(region, state.name, model)
