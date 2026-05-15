from __future__ import annotations

import json
import os
from pathlib import Path

from smcraft.cli import main

EXAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "examples")
AGENT_LIFECYCLE_JSON = os.path.join(EXAMPLE_DIR, "agent_lifecycle.smdf.json")


def test_skills_list(capsys):
    rc = main(["skills", "list"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "agent-lifecycle" in out
    assert "observer-trace" in out


def test_install_agent_lifecycle_skill(tmp_path: Path, capsys):
    rc = main(["skills", "install", "agent-lifecycle", "--output", str(tmp_path)])
    out = capsys.readouterr().out

    installed = tmp_path / "agent_lifecycle.smdf.json"
    assert rc == 0
    assert installed.exists()
    assert json.loads(installed.read_text())["settings"]["name"] == "AgentLifecycle"
    assert "Installed skill 'agent-lifecycle'" in out


def test_report_issue_template(capsys):
    rc = main(
        [
            "report-issue",
            "--title",
            "Lifecycle edge case",
            "--context",
            "Retry branch loses reviewer notes.",
            "--include-env",
        ]
    )
    out = capsys.readouterr().out
    assert rc == 0
    assert "# Lifecycle edge case" in out
    assert "Retry branch loses reviewer notes." in out
    assert "## Environment" in out


def test_legacy_generate_entrypoint_validate_only(capsys):
    rc = main([AGENT_LIFECYCLE_JSON, "--validate-only"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Validation passed." in out
