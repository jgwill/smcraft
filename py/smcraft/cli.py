"""SMCG — State Machine Code Generator CLI."""

from __future__ import annotations

import argparse
import platform
import sys
from pathlib import Path

from smcraft.codegen import PythonCodeGenerator, to_snake_case
from smcraft.parser import StateMachineParser
from smcraft.skills import SKILLS, install_skill, list_skills
from smcraft import __version__

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="smcg",
        description="State Machine Code Generator — generate code, install starter skills, and prepare contribution reports",
    )
    subparsers = parser.add_subparsers(dest="command")

    generate = subparsers.add_parser("generate", help="Generate runtime code from a state machine definition")
    generate.add_argument("input", help="Input definition file (.smdf.json, .smdf.xml, .fsm)")
    generate.add_argument("-o", "--output", help="Output directory (default: current directory)", default=".")
    generate.add_argument("-l", "--language", choices=["python"], default="python", help="Target language")
    generate.add_argument("-n", "--name", help="Override state machine name")
    generate.add_argument("--validate-only", action="store_true", help="Only validate, don't generate")
    generate.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    skills = subparsers.add_parser("skills", help="List and install built-in starter skills")
    skills_subparsers = skills.add_subparsers(dest="skills_command")

    skills_subparsers.add_parser("list", help="List built-in skills")

    install = skills_subparsers.add_parser("install", help="Install a built-in skill into a directory")
    install.add_argument("skill", choices=sorted(SKILLS), help="Skill to install")
    install.add_argument("-o", "--output", default=".", help="Target directory for installed files")

    report = subparsers.add_parser("report-issue", help="Print a terminal-friendly issue report template")
    report.add_argument("--title", default="Describe the issue", help="Short issue title")
    report.add_argument("--context", default="Describe what you were trying to create.", help="Current reality / scenario")
    report.add_argument("--machine", help="Path to the machine definition involved in the issue")
    report.add_argument("--trace", help="Path to a trace / log artifact, if available")
    report.add_argument("--spec", help="Path to a specification artifact, if available")
    report.add_argument("--include-env", action="store_true", help="Include CLI and Python environment details")

    return parser


def _run_generate(args: argparse.Namespace) -> int:
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


def _run_skills(args: argparse.Namespace) -> int:
    if args.skills_command in (None, "list"):
        print("Built-in skills:")
        for skill in list_skills():
            print(f"- {skill.name}: {skill.summary}")
            print(f"  files: {', '.join(skill.files)}")
        return 0

    installed = install_skill(args.skill, args.output)
    print(f"Installed skill '{args.skill}' into {Path(args.output).resolve()}:")
    for path in installed:
        print(f"- {path}")
    if args.skill == "agent-lifecycle":
        print(
            f"Next step: cd {Path(args.output).resolve()} && smcg generate agent_lifecycle.smdf.json -o output -v"
        )
    return 0


def _run_report_issue(args: argparse.Namespace) -> int:
    print(f"# {args.title}")
    print("")
    print("## Current reality")
    print(args.context)
    print("")
    print("## Desired outcome")
    print("- Describe what you expected to create or achieve.")
    print("")
    print("## Reproduction artifacts")
    print(f"- Machine definition: {args.machine or 'attach the .smdf file or generated JSON'}")
    print(f"- Specification artifact: {args.spec or 'attach generated lifecycle/spec output if relevant'}")
    print(f"- Trace / provenance: {args.trace or 'attach ObserverTrace or terminal logs if available'}")
    print("")
    print("## Steps to reproduce")
    print("1. Provide the exact command or runtime action.")
    print("2. Describe the transition or state where behavior diverged.")
    print("3. Include any generated code/spec output that demonstrates the problem.")
    print("")
    print("## Contribution notes")
    print("- Highlight the state, event payload, and transition contract involved.")
    print("- Call out any edge case, retry path, or HITL branch that triggered the issue.")
    if args.include_env:
        print("")
        print("## Environment")
        print(f"- smcraft: {__version__}")
        print(f"- python: {platform.python_version()}")
        print(f"- platform: {platform.platform()}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    raw_args = sys.argv[1:] if argv is None else argv
    subparser_action = next(action for action in parser._actions if isinstance(action, argparse._SubParsersAction))
    valid_commands = set(subparser_action.choices) | {"-h", "--help"}
    if raw_args and raw_args[0] not in valid_commands:
        raw_args = ["generate", *raw_args]
    args = parser.parse_args(raw_args)

    if args.command == "generate":
        return _run_generate(args)
    if args.command == "skills":
        return _run_skills(args)
    if args.command == "report-issue":
        return _run_report_issue(args)

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
