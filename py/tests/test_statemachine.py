"""
End-to-end test for the State Machine Framework.

Tests the full pipeline: definition → parse → validate → generate → run.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from smcraft.model import StateMachineDefinition, SettingsModel
from smcraft.parser import StateMachineParser
from smcraft.codegen import generate_python, PythonCodeGenerator
from smcraft.runtime import (
    Context,
    ContextBase,
    State,
    StateKind,
    TransitionHelper,
    ObserverConsole,
    ObserverNull,
)

EXAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "examples")
BDBO_JSON = os.path.join(EXAMPLE_DIR, "bdbo_strategy.smdf.json")


def test_parse_json():
    """Test JSON parsing of the BDBO strategy definition."""
    parser = StateMachineParser()
    model = parser.parse_file(BDBO_JSON)

    assert model.definition.settings.name == "BDBOStrategy"
    assert model.definition.settings.namespace == "Trading.Strategies"
    assert model.definition.settings.asynchronous is False
    assert len(model.all_states) == 8
    assert len(model.leaf_states) == 6
    assert len(model.event_map) == 7  # 6 events + 1 timer
    assert "StrategyFeeder" in model.feeders_map
    print("✓ test_parse_json passed")


def test_validation():
    """Test that validation passes for valid definitions."""
    parser = StateMachineParser()
    model = parser.parse_file(BDBO_JSON)
    errors = parser.validate(model)
    assert len(errors) == 0, f"Unexpected errors: {errors}"
    print("✓ test_validation passed")


def test_validation_catches_errors():
    """Test that validation catches common errors."""
    parser = StateMachineParser()

    # Duplicate state names
    bad_json = {
        "settings": {"namespace": "Test", "asynchronous": False},
        "events": [{"name": "TestEvents", "events": [{"id": "go"}]}],
        "state": {
            "name": "Root",
            "states": [
                {"name": "A", "transitions": [{"event": "go", "nextState": "A"}]},
                {"name": "A"},  # Duplicate!
            ],
        },
    }
    defn = parser._parse_json_data(bad_json)
    model = parser.enrich(defn)
    errors = parser.validate(model)
    rule_ids = {e.rule_id for e in errors}
    assert "V002" in rule_ids, "Should catch duplicate state names"
    print("✓ test_validation_catches_errors passed")


def test_code_generation():
    """Test that code generation produces valid Python."""
    code = generate_python(BDBO_JSON)
    assert "class BDBOStrategyStateEnum(IntEnum):" in code
    assert "class StateBDBOStrategy(State):" in code
    assert "class StateIdle(StateBDBOStrategy):" in code
    assert "class BDBOStrategyContext(Context):" in code
    assert "class StrategyFeeder:" in code
    # Verify no duplicate methods — WaitingEntry should have one merged on_strategy_failed
    lines = code.splitlines()
    in_waiting_entry = False
    sf_count = 0
    for line in lines:
        if "class StateActiveWaitingEntry" in line:
            in_waiting_entry = True
            sf_count = 0
        elif in_waiting_entry and line.startswith("class "):
            break
        elif in_waiting_entry and "def on_strategy_failed" in line:
            sf_count += 1
    assert sf_count == 1, f"Expected 1 on_strategy_failed in WaitingEntry, got {sf_count}"
    print("✓ test_code_generation passed")


def test_runtime_basic():
    """Test the runtime engine with manually constructed states."""
    # Create a simple state machine: Idle -> Active -> Done
    root = State("Root", StateKind.ROOT)
    idle = State("Idle", StateKind.LEAF, parent=root)
    active = State("Active", StateKind.LEAF, parent=root)
    done = State("Done", StateKind.FINAL, parent=root)

    ctx = Context(name="TestContext")
    ctx.state_current = idle

    # Track transitions
    transitions_log = []

    class TestObserver:
        def on_entry(self, ctx_name, state_name):
            transitions_log.append(f"enter:{state_name}")
        def on_exit(self, ctx_name, state_name):
            transitions_log.append(f"exit:{state_name}")
        def on_transition_begin(self, ctx_name, sp, sn, tn):
            transitions_log.append(f"begin:{sp}->{sn}")
        def on_transition_end(self, ctx_name, sp, sn, tn):
            transitions_log.append(f"end:{sp}->{sn}")
        def on_timer_start(self, ctx_name, tn, d):
            pass
        def on_timer_stop(self, ctx_name, tn):
            pass

    ctx.set_observer(TestObserver())

    # Transition Idle -> Active
    TransitionHelper.process_transition_begin(ctx, idle, active, "Activate")
    ctx.state_current = active
    TransitionHelper.process_transition_end(ctx, idle, active)

    assert ctx.state_current is active
    assert "exit:Idle" in transitions_log
    assert "enter:Active" in transitions_log
    assert "begin:Idle->Active" in transitions_log
    assert "end:Idle->Active" in transitions_log

    # Transition Active -> Done (final)
    ended = []
    ctx.register_end_handler(lambda c: ended.append(True))
    TransitionHelper.process_transition_begin(ctx, active, done, "Complete")
    ctx.state_current = done
    TransitionHelper.process_transition_end(ctx, active, done)

    assert ctx.state_current is done
    assert len(ended) == 1, "End handler should fire on final state"
    print("✓ test_runtime_basic passed")


def test_runtime_hierarchical_transitions():
    """Test that hierarchical state entry/exit works correctly."""
    root = State("Root", StateKind.ROOT)
    parent_a = State("ParentA", StateKind.COMPOSITE, parent=root)
    child_a1 = State("ChildA1", StateKind.LEAF, parent=parent_a)
    parent_b = State("ParentB", StateKind.COMPOSITE, parent=root)
    child_b1 = State("ChildB1", StateKind.LEAF, parent=parent_b)

    ctx = Context(name="HierTest")
    ctx.state_current = child_a1

    log = []

    class LogObserver:
        def on_entry(self, cn, sn): log.append(f"enter:{sn}")
        def on_exit(self, cn, sn): log.append(f"exit:{sn}")
        def on_transition_begin(self, cn, sp, sn, tn): pass
        def on_transition_end(self, cn, sp, sn, tn): pass
        def on_timer_start(self, cn, tn, d): pass
        def on_timer_stop(self, cn, tn): pass

    ctx.set_observer(LogObserver())

    # Cross-branch transition: ChildA1 -> ChildB1
    # Should exit ChildA1, exit ParentA, enter ParentB, enter ChildB1
    TransitionHelper.process_transition_begin(ctx, child_a1, child_b1, "CrossBranch")
    ctx.state_current = child_b1
    TransitionHelper.process_transition_end(ctx, child_a1, child_b1)

    assert "exit:ChildA1" in log
    assert "exit:ParentA" in log
    assert "enter:ParentB" in log
    assert "enter:ChildB1" in log
    # Exit should happen before enter
    exit_a1_idx = log.index("exit:ChildA1")
    enter_b1_idx = log.index("enter:ChildB1")
    assert exit_a1_idx < enter_b1_idx
    print("✓ test_runtime_hierarchical_transitions passed")


def test_generated_code_runs():
    """Test that generated code is importable and runnable."""
    code = generate_python(BDBO_JSON)

    # Create a mock strategy object
    mock_strategy_code = """
class BDBOStrategyEntity:
    def __init__(self):
        self.monitoring = False
        self.retries = 0
    def start_monitoring(self):
        self.monitoring = True
    def can_retry(self):
        self.retries += 1
        return self.retries <= 2
"""

    # Execute the generated code in a namespace
    namespace = {}
    exec(mock_strategy_code, namespace)
    exec(code, namespace)

    # Create and run the state machine
    strategy = namespace["BDBOStrategyEntity"]()
    ctx = namespace["BDBOStrategyContext"](strategy)
    ctx.set_observer(ObserverConsole.instance())

    print("\n--- Running Generated BDBO Strategy FSM ---")
    ctx.enter_initial_state()
    assert ctx.state_current.name == "Idle"
    assert strategy.monitoring is False

    # Feed events through the feeder
    feeder = namespace["StrategyFeeder"](ctx)
    feeder.strategy_created("strat-001")
    assert ctx.state_current.name == "Active_WaitingBreakout"
    assert strategy.monitoring is True

    feeder.price_breakout(1.2345, "buy")
    assert ctx.state_current.name == "Active_WaitingSignal"

    feeder.signal_found()
    assert ctx.state_current.name == "Active_WaitingEntry"

    feeder.order_filled()
    assert ctx.state_current.name == "Completed"
    print("--- FSM Completed Successfully ---\n")

    print("✓ test_generated_code_runs passed")


def test_serialization():
    """Test state machine serialization and deserialization."""
    code = generate_python(BDBO_JSON)

    mock_code = """
class BDBOStrategyEntity:
    def start_monitoring(self): pass
    def can_retry(self): return True
"""
    namespace = {}
    exec(mock_code, namespace)
    exec(code, namespace)

    strategy = namespace["BDBOStrategyEntity"]()
    ctx = namespace["BDBOStrategyContext"](strategy)
    ctx.enter_initial_state()

    # Advance to WaitingSignal
    feeder = namespace["StrategyFeeder"](ctx)
    feeder.strategy_created("strat-002")
    feeder.price_breakout(1.5, "sell")
    assert ctx.state_current.name == "Active_WaitingSignal"

    # Serialize
    data = ctx.serialize()
    assert data["state"] == "Active_WaitingSignal"

    # Create new context and restore
    strategy2 = namespace["BDBOStrategyEntity"]()
    ctx2 = namespace["BDBOStrategyContext"](strategy2)
    ctx2.deserialize(data)
    assert ctx2.state_current.name == "Active_WaitingSignal"

    # Continue from restored state
    feeder2 = namespace["StrategyFeeder"](ctx2)
    feeder2.signal_found()
    assert ctx2.state_current.name == "Active_WaitingEntry"
    print("✓ test_serialization passed")


def test_model_to_json_roundtrip():
    """Test that model can serialize to JSON and parse back."""
    parser = StateMachineParser()
    model = parser.parse_file(BDBO_JSON)

    # Serialize to JSON
    json_str = model.definition.to_json()
    data = json.loads(json_str)

    # Parse back
    defn2 = parser._parse_json_data(data)
    model2 = parser.enrich(defn2)

    assert len(model2.all_states) == len(model.all_states)
    assert len(model2.event_map) == len(model.event_map)
    assert set(model2.state_map.keys()) == set(model.state_map.keys())
    print("✓ test_model_to_json_roundtrip passed")


def test_cli_validate():
    """Test CLI in validate-only mode."""
    from smcraft.cli import main
    import sys

    old_argv = sys.argv
    sys.argv = ["smcg", BDBO_JSON, "--validate-only", "-v"]
    try:
        result = main()
        assert result == 0, f"CLI validate returned {result}"
    finally:
        sys.argv = old_argv
    print("✓ test_cli_validate passed")


if __name__ == "__main__":
    test_parse_json()
    test_validation()
    test_validation_catches_errors()
    test_code_generation()
    test_runtime_basic()
    test_runtime_hierarchical_transitions()
    test_generated_code_runs()
    test_serialization()
    test_model_to_json_roundtrip()
    test_cli_validate()
    print("\n" + "=" * 50)
    print("All tests passed! ✓")
    print("=" * 50)
