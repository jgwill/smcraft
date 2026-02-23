"""
SMCG — State Machine Code Generator CLI

Usage:
    smcg <input-file> [options]

Options:
    --output, -o <dir>       Output directory (default: current directory)
    --language, -l <lang>    Target language: python (default: python)
    --name, -n <name>        Override state machine name
    --validate-only          Only validate, don't generate code
    --verbose, -v            Verbose output
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from smcraft.codegen import PythonCodeGenerator, to_snake_case
from smcraft.parser import StateMachineParser


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="smcg",
        description="State Machine Code Generator — generates code from state machine definitions",
    )
    parser.add_argument("input", help="Input definition file (.smdf.json, .smdf.xml, .fsm)")
    parser.add_argument("-o", "--output", help="Output directory (default: current directory)", default=".")
    parser.add_argument("-l", "--language", choices=["python"], default="python", help="Target language")
    parser.add_argument("-n", "--name", help="Override state machine name")
    parser.add_argument("--validate-only", action="store_true", help="Only validate, don't generate")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    args = parser.parse_args()
    input_path = Path(args.input)

    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}", file=sys.stderr)
        return 1

    # Parse
    sm_parser = StateMachineParser()
    try:
        model = sm_parser.parse_file(input_path)
    except Exception as e:
        print(f"Error parsing {input_path}: {e}", file=sys.stderr)
        return 1

    # Override name
    if args.name:
        model.definition.settings.name = args.name

    # Validate
    errors = sm_parser.validate(model)
    if errors:
        print(f"Validation errors in {input_path}:")
        for err in errors:
            element = f" ({err.element})" if err.element else ""
            print(f"  [{err.rule_id}] {err.message}{element}")
        if args.validate_only:
            return 1
        # Continue with warnings for non-fatal errors
        print(f"  {len(errors)} error(s) found")
    elif args.verbose:
        print(f"Validation passed: {len(model.all_states)} states, {len(model.event_map)} events")

    if args.validate_only:
        if not errors:
            print("Validation passed.")
        return 0 if not errors else 1

    # Generate
    if args.language == "python":
        generator = PythonCodeGenerator(model)
        code = generator.generate()
        name = model.definition.settings.name or "statemachine"
        output_file = Path(args.output) / f"{to_snake_case(name)}_fsm.py"
    else:
        print(f"Unsupported language: {args.language}", file=sys.stderr)
        return 1

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(code, encoding="utf-8")
    print(f"Generated: {output_file}")

    if args.verbose:
        print(f"  States: {len(model.all_states)}")
        print(f"  Events: {len(model.event_map)}")
        print(f"  Feeders: {len(model.feeders_map)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
