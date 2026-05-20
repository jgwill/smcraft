from __future__ import annotations

import json
from pathlib import Path

import pytest

from smcraft.cli import main
from smcraft.skills import install_skill

EXAMPLE_DIR = Path(__file__).resolve().parents[2] / "examples"
AGENT_LIFECYCLE_JSON = EXAMPLE_DIR / "agent_lifecycle.smdf.json"


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
    rc = main([str(AGENT_LIFECYCLE_JSON), "--validate-only"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Validation passed." in out


def test_install_skill_rejects_unknown_name(tmp_path: Path):
    with pytest.raises(ValueError, match="Unknown skill: unknown"):
        install_skill("unknown", tmp_path)


def test_install_observer_trace_skill(tmp_path: Path):
    rc = main(["skills", "install", "observer-trace", "--output", str(tmp_path)])
    installed = tmp_path / "observer_trace_example.py"
    assert rc == 0
    assert installed.exists()
    assert "ObserverTrace" in installed.read_text()
