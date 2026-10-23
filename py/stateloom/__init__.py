"""
Stateloom — the Python state machine engine
=========================================

A framework for designing, generating, and running hierarchical state machines.
Implements Specs 60-62 from the RISE specifications.

Modules:
  - model: State machine definition model (dataclasses)
  - parser: JSON/XML parser for .smdf files
  - runtime: Runtime engine (Context, State, Event, Observer)
  - codegen: Code generator (SMCG) producing Python/TypeScript
  - cli: Command-line interface for code generation
"""

__version__ = "0.2.1"

from stateloom.model import (
    StateMachineDefinition,
    SettingsModel,
    EventSourceDef,
    EventDef,
    TimerDef,
    ParameterDef,
    StateDef,
    TransitionDef,
    ActionDef,
    ParallelDef,
    ObjectRef,
    ContextConfig,
    StateKindType,
)

from stateloom.parser import StateMachineParser
from stateloom.runtime import (
    ContextBase,
    Context,
    ContextAsync,
    State,
    StateKind,
    TransitionHelper,
    IObserver,
    ObserverNull,
    ObserverConsole,
    ObserverTrace,
    TraceEvent,
)
from stateloom.skills import (
    get_agent_lifecycle_template,
    install_skill,
    list_skills,
)

__all__ = [
    "StateMachineDefinition",
    "SettingsModel",
    "EventSourceDef",
    "EventDef",
    "TimerDef",
    "ParameterDef",
    "StateDef",
    "TransitionDef",
    "ActionDef",
    "ParallelDef",
    "ObjectRef",
    "ContextConfig",
    "StateKindType",
    "StateMachineParser",
    "ContextBase",
    "Context",
    "ContextAsync",
    "State",
    "StateKind",
    "TransitionHelper",
    "IObserver",
    "ObserverNull",
    "ObserverConsole",
    "ObserverTrace",
    "TraceEvent",
    "get_agent_lifecycle_template",
    "install_skill",
    "list_skills",
]
