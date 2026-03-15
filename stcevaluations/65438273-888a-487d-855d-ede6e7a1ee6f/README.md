# Ceremony 65438273-888a-487d-855d-ede6e7a1ee6f

**Date:** 2026-03-15
**Purpose:** First-contact skill-building and quality evaluation of `smcraft-mcp`

## Artifacts

| File | Description |
|------|-------------|
| `creative-session.json` | State machine definition JSON — the source of truth fed to `load_definition` |
| `creative_session.py` | Python codegen output — imports from `smcraft.runtime` (PyPI `smcraft>=0.1.4`) |
| `creative_session.ts` | TypeScript codegen output — imports from `smcraft/runtime` (npm `smcraft@0.1.2`) |

## How to use these artifacts

- **Roundtrip test:** Feed `creative-session.json` to `load_definition`, then `get_definition` and diff
- **Codegen regression:** Compare future codegen output against these files to detect regressions
- **Scaffold gap:** These files demonstrate the missing step — no `main.py`/`index.ts`, no `pyproject.toml`/`package.json`

## Evaluation findings

See [`/b/trading/smcraft/STCEVALUATION.md`](../STCEVALUATION.md) for the full evaluation write-up.
