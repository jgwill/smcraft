"""smcraft — renamed to ``miadi-stateloom-engine``.

This package is a compatibility shim. Every name it exports comes from
``stateloom``, the import package of `miadi-stateloom-engine
<https://pypi.org/project/miadi-stateloom-engine/>`_, so existing code keeps
running while it moves::

    pip install miadi-stateloom-engine

    from stateloom.parser import StateMachineParser   # was smcraft.parser
    from stateloom.runtime import Context, State      # was smcraft.runtime
    from stateloom.codegen import generate_python     # was smcraft.codegen

The ``smcg`` command is unchanged and now ships with the new package.

Nothing new lands here. The shim exists so an install that predates the rename
says so out loud instead of failing at an import three files deep, and it will
be removed once the name has been quiet for a while.
"""

import sys
import warnings

__version__ = "0.1.7"

_MESSAGE = (
    "The PyPI package 'smcraft' has been renamed to 'miadi-stateloom-engine', "
    "and its import package from 'smcraft' to 'stateloom'. This shim re-exports "
    "the new package so your code keeps working. To move: "
    "pip install miadi-stateloom-engine, then change 'smcraft.X' imports to "
    "'stateloom.X'. See https://github.com/jgwill/smcraft"
)

warnings.warn(_MESSAGE, DeprecationWarning, stacklevel=2)

try:
    import stateloom as _stateloom
except ImportError as exc:  # pragma: no cover - only when the dependency is absent
    raise ImportError(
        "smcraft is a shim for miadi-stateloom-engine, which is not installed. "
        "Run: pip install miadi-stateloom-engine"
    ) from exc

# Submodule aliasing, so `import smcraft.parser` and
# `from smcraft.runtime import Context` both resolve to the real module object
# rather than a copy — one module, one set of classes, so isinstance() across
# the old and new names still agrees.
for _name in ("model", "parser", "runtime", "codegen", "cli"):
    try:
        _module = __import__(f"stateloom.{_name}", fromlist=["*"])
    except ImportError:  # pragma: no cover - a submodule the new package dropped
        continue
    sys.modules[f"{__name__}.{_name}"] = _module
    globals()[_name] = _module

# Re-export the top-level public API exactly as `stateloom` defines it.
for _attr in getattr(_stateloom, "__all__", None) or [
    _a for _a in dir(_stateloom) if not _a.startswith("_")
]:
    globals().setdefault(_attr, getattr(_stateloom, _attr))

__all__ = [_a for _a in globals() if not _a.startswith("_")]
