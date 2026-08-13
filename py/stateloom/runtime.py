"""
State Machine Runtime Engine (Spec 61)

Provides Context, State, Event, Observer, and TransitionHelper
for executing state machines at runtime.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from abc import ABC, abstractmethod
from collections import deque
from enum import IntEnum, IntFlag
from typing import Any, Callable, Optional, Protocol

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

class StateKind(IntEnum):
    """State classification."""
    LEAF = 0
    COMPOSITE = 1
    ROOT = 2
    FINAL = 3
    PARALLEL = 4
    HISTORY = 5


class State:
    """
    A state in the state machine hierarchy.

    Each state has on_entry/on_exit callbacks and knows its parent.
    Generated code creates subclasses with event handler methods.
    """

    def __init__(self, name: str, kind: StateKind = StateKind.LEAF, parent: Optional["State"] = None):
        self.name = name
        self.kind = kind
        self.parent = parent

    def on_entry(self, context: "ContextBase") -> None:
        """Called when entering this state. Override in subclasses."""
        pass

    def on_exit(self, context: "ContextBase") -> None:
        """Called when leaving this state. Override in subclasses."""
        pass

    def __repr__(self) -> str:
        return f"State({self.name!r}, {self.kind.name})"


# ---------------------------------------------------------------------------
# Observer
# ---------------------------------------------------------------------------

class IObserver(Protocol):
    """Observer interface for monitoring state machine lifecycle events."""

    def on_entry(self, context_name: str, state_name: str) -> None: ...
    def on_exit(self, context_name: str, state_name: str) -> None: ...
    def on_transition_begin(self, context_name: str, state_prev: str, state_next: str, transition_name: str) -> None: ...
    def on_transition_end(self, context_name: str, state_prev: str, state_next: str, transition_name: str) -> None: ...
    def on_timer_start(self, context_name: str, timer_name: str, duration: int) -> None: ...
    def on_timer_stop(self, context_name: str, timer_name: str) -> None: ...


class ObserverNull:
    """No-op observer. Default."""

    _instance: Optional["ObserverNull"] = None

    @classmethod
    def instance(cls) -> "ObserverNull":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def on_entry(self, context_name: str, state_name: str) -> None:
        pass

    def on_exit(self, context_name: str, state_name: str) -> None:
        pass

    def on_transition_begin(self, context_name: str, state_prev: str, state_next: str, transition_name: str) -> None:
        pass

    def on_transition_end(self, context_name: str, state_prev: str, state_next: str, transition_name: str) -> None:
        pass

    def on_timer_start(self, context_name: str, timer_name: str, duration: int) -> None:
        pass

    def on_timer_stop(self, context_name: str, timer_name: str) -> None:
        pass


class ObserverConsole:
    """Logs state machine events to stdout."""

    _instance: Optional["ObserverConsole"] = None

    @classmethod
    def instance(cls) -> "ObserverConsole":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def on_entry(self, context_name: str, state_name: str) -> None:
        print(f"{context_name}: enter {state_name}")

    def on_exit(self, context_name: str, state_name: str) -> None:
        print(f"{context_name}: exit {state_name}")

    def on_transition_begin(self, context_name: str, state_prev: str, state_next: str, transition_name: str) -> None:
        print(f"{context_name}: transition begin {state_prev} -> {state_next} [{transition_name}]")

    def on_transition_end(self, context_name: str, state_prev: str, state_next: str, transition_name: str) -> None:
        print(f"{context_name}: transition end {state_prev} -> {state_next} [{transition_name}]")

    def on_timer_start(self, context_name: str, timer_name: str, duration: int) -> None:
        print(f"{context_name}: timer start {timer_name} ({duration}ms)")

    def on_timer_stop(self, context_name: str, timer_name: str) -> None:
        print(f"{context_name}: timer stop {timer_name}")


class ObserverLogger:
    """Logs state machine events via Python logging."""

    def __init__(self, logger_name: str = "statemachine"):
        self._logger = logging.getLogger(logger_name)

    def on_entry(self, context_name: str, state_name: str) -> None:
        self._logger.debug("%s: enter %s", context_name, state_name)

    def on_exit(self, context_name: str, state_name: str) -> None:
        self._logger.debug("%s: exit %s", context_name, state_name)

    def on_transition_begin(self, context_name: str, state_prev: str, state_next: str, transition_name: str) -> None:
        self._logger.info("%s: transition %s -> %s [%s]", context_name, state_prev, state_next, transition_name)

    def on_transition_end(self, context_name: str, state_prev: str, state_next: str, transition_name: str) -> None:
        self._logger.debug("%s: transition complete %s -> %s", context_name, state_prev, state_next)

    def on_timer_start(self, context_name: str, timer_name: str, duration: int) -> None:
        self._logger.debug("%s: timer start %s (%dms)", context_name, timer_name, duration)

    def on_timer_stop(self, context_name: str, timer_name: str) -> None:
        self._logger.debug("%s: timer stop %s", context_name, timer_name)


# ---------------------------------------------------------------------------
# Transition Helper
# ---------------------------------------------------------------------------

class TransitionHelper:
    """Processes state transitions with correct hierarchical entry/exit ordering."""

    @staticmethod
    def find_common_ancestor(state_a: State, state_b: State) -> Optional[State]:
        """Find the lowest common ancestor of two states."""
        ancestors_a: set[str] = set()
        s = state_a
        while s is not None:
            ancestors_a.add(s.name)
            s = s.parent
        s = state_b
        while s is not None:
            if s.name in ancestors_a:
                return s
            s = s.parent
        return None

    @staticmethod
    def process_transition_begin(
        context: "ContextBase",
        state_prev: State,
        state_next: State,
        transition_name: str,
    ) -> None:
        """Exit states up to common ancestor and notify observer."""
        context.transition_name = transition_name
        lca = TransitionHelper.find_common_ancestor(state_prev, state_next)
        # Walk exit chain from state_prev up to (but not including) LCA
        TransitionHelper._walk_chain_exit(context, state_prev, lca)
        context.observer.on_transition_begin(context.name, state_prev.name, state_next.name, transition_name)

    @staticmethod
    def process_transition_end(
        context: "ContextBase",
        state_prev: State,
        state_next: State,
    ) -> None:
        """Enter states from common ancestor down to target and notify observer."""
        lca = TransitionHelper.find_common_ancestor(state_prev, state_next)
        # Walk entry chain from LCA down to state_next
        TransitionHelper._walk_chain_entry(context, state_next, lca)
        context.observer.on_transition_end(
            context.name, state_prev.name, state_next.name, context.transition_name
        )
        context.transition_name = ""
        # Check if we entered a final state
        if state_next.kind == StateKind.FINAL:
            context._on_end()

    @staticmethod
    def _walk_chain_exit(context: "ContextBase", state_from: State, state_to: Optional[State]) -> None:
        """Recursively call on_exit from state_from up to state_to (exclusive)."""
        if state_from is None or state_from is state_to:
            return
        context.observer.on_exit(context.name, state_from.name)
        state_from.on_exit(context)
        if state_from.parent is not None and state_from.parent is not state_to:
            TransitionHelper._walk_chain_exit(context, state_from.parent, state_to)

    @staticmethod
    def _walk_chain_entry(context: "ContextBase", state_to: State, state_from: Optional[State]) -> None:
        """Recursively call on_entry from state_from down to state_to."""
        # Build path from LCA to target
        path: list[State] = []
        s = state_to
        while s is not None and s is not state_from:
            path.append(s)
            s = s.parent
        # Enter in top-down order
        for state in reversed(path):
            context.observer.on_entry(context.name, state.name)
            state.on_entry(context)


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------

class ContextBase(ABC):
    """Abstract base for all state machine contexts."""

    def __init__(self, name: str = "Context"):
        self.name = name
        self.transition_name = ""
        self.observer: IObserver = ObserverNull.instance()
        self._end_handlers: list[Callable[["ContextBase"], None]] = []
        self._children: list["ContextBase"] = []
        self._timers: dict[str, threading.Timer] = {}

    def set_observer(self, observer: IObserver) -> None:
        """Attach an observer to this context."""
        self.observer = observer
        for child in self._children:
            child.set_observer(observer)

    def register_end_handler(self, handler: Callable[["ContextBase"], None]) -> None:
        """Register a callback for when the state machine completes."""
        self._end_handlers.append(handler)

    def _on_end(self) -> None:
        """Called when a final state is reached."""
        for handler in self._end_handlers:
            handler(self)

    def add_child(self, child: "ContextBase") -> None:
        """Register a child context (for parallel regions)."""
        self._children.append(child)

    # Timer support
    def start_timer(self, timer_name: str, duration_ms: int, callback: Callable[[], None]) -> None:
        """Start a named timer."""
        self.stop_timer(timer_name)
        duration_s = duration_ms / 1000.0
        t = threading.Timer(duration_s, callback)
        t.daemon = True
        self._timers[timer_name] = t
        t.start()
        self.observer.on_timer_start(self.name, timer_name, duration_ms)

    def stop_timer(self, timer_name: str) -> None:
        """Stop a named timer."""
        if timer_name in self._timers:
            self._timers[timer_name].cancel()
            del self._timers[timer_name]
            self.observer.on_timer_stop(self.name, timer_name)

    def stop_all_timers(self) -> None:
        """Stop all active timers."""
        for name in list(self._timers.keys()):
            self.stop_timer(name)

    @abstractmethod
    def enter_initial_state(self) -> None:
        """Enter the state machine's initial state."""
        ...

    def serialize(self) -> dict[str, Any]:
        """Serialize current state for persistence."""
        return {"state": getattr(self, "state_current", None) and self.state_current.name}

    def deserialize(self, data: dict[str, Any]) -> None:
        """Restore state from serialized data."""
        state_name = data.get("state")
        if state_name:
            self.set_state(state_name)

    def set_state(self, state_name: str) -> None:
        """Set current state by name (for deserialization). Override in generated code."""
        pass


class Context(ContextBase):
    """
    Synchronous state machine context.
    Events are processed immediately on the calling thread.
    """

    def __init__(self, name: str = "Context"):
        super().__init__(name)
        self.state_current: Optional[State] = None
        self.state_previous: Optional[State] = None
        self.state_next: Optional[State] = None
        self.state_history: Optional[State] = None

    def enter_initial_state(self) -> None:
        """Override in generated code to set and enter the initial state."""
        pass

    def leave_current_state(self) -> None:
        """Exit all states up to root."""
        if self.state_current:
            s = self.state_current
            while s is not None:
                self.observer.on_exit(self.name, s.name)
                s.on_exit(self)
                s = s.parent

    def save_state(self) -> None:
        """Save current state for history state support."""
        self.state_history = self.state_current

    def serialize(self) -> dict[str, Any]:
        data = super().serialize()
        if self.state_history:
            data["history"] = self.state_history.name
        return data


class ContextAsync(Context):
    """
    Asynchronous state machine context with event queuing.
    Events are enqueued and processed sequentially from a background thread.
    """

    def __init__(self, name: str = "Context", max_events: int = 1024):
        super().__init__(name)
        self.max_events = max_events
        self._event_queue: deque[tuple[Callable[..., None], tuple[Any, ...]]] = deque()
        self._lock = threading.Lock()
        self._processing = False

    def schedule_event(self, handler: Callable[..., None], *args: Any) -> None:
        """Enqueue an event for asynchronous processing."""
        with self._lock:
            self._event_queue.append((handler, args))
            if not self._processing:
                self._processing = True
                threading.Thread(target=self._process_events, daemon=True).start()

    def _process_events(self) -> None:
        """Process queued events sequentially."""
        processed = 0
        while processed < self.max_events:
            with self._lock:
                if not self._event_queue:
                    self._processing = False
                    return
                handler, args = self._event_queue.popleft()
            try:
                handler(*args)
            except Exception:
                logger.exception("Error processing event in %s", self.name)
            processed += 1
        # If more events remain, schedule another processing cycle
        with self._lock:
            if self._event_queue:
                threading.Thread(target=self._process_events, daemon=True).start()
            else:
                self._processing = False
