# smcraft — renamed to `miadi-stateloom-engine`

**This package has moved.** Install the new name:

```bash
pip install miadi-stateloom-engine
```

The distribution `smcraft` is now `miadi-stateloom-engine`, and the import
package `smcraft` is now `stateloom`, matching the
[`@miadi/stateloom-engine`](https://www.npmjs.com/package/@miadi/stateloom-engine)
npm twin and the rest of the `@miadi/stateloom*` family.

| was | now |
|---|---|
| `pip install smcraft` | `pip install miadi-stateloom-engine` |
| `from smcraft.parser import StateMachineParser` | `from stateloom.parser import StateMachineParser` |
| `from smcraft.runtime import Context, State` | `from stateloom.runtime import Context, State` |
| `from smcraft.codegen import generate_python` | `from stateloom.codegen import generate_python` |
| `smcg machine.smdf.json -o out/` | unchanged — `smcg` ships with the new package |

## What this release actually is

A compatibility shim. It depends on `miadi-stateloom-engine` and re-exports it,
aliasing the submodules to the real module objects rather than copying them —
so one class exists under both names and `isinstance` still agrees across the
two. Importing it raises a `DeprecationWarning` naming the new package.

Nothing new will land here. The shim exists so an install predating the rename
says so out loud instead of failing at an import three files deep, and it will
be removed once the name has been quiet for a while.

Generated Python now emits `from stateloom.runtime import …`, so code produced
by the current generator does not go through this shim at all.

Source: https://github.com/jgwill/smcraft

## License

MIT © Guillaume Isabelle
