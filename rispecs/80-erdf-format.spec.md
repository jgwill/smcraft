# ERDF — Entity-Relationship Definition Format

> RISE Framework Specification
> References: Spec 70 (SMDF Format), Spec 73 (MCP Server), Spec 74 (Web Designer), Spec 77 (Real-Time Design Bridge)

**Spec ID**: 80
**Version**: 1.0
**Status**: format, validator, edits, Mermaid render and link check landed in `bridge-protocol/src/erd/`; MCP tools landed in `mcp/src/erd.ts`. The canvas follows (see Slices).
**Implementation**: TypeScript (`bridge-protocol/src/erd/`, `mcp/src/erd.ts`)

## Creative Intent

**What ERDF Enables Users to Create:**
A declarative JSON document where humans and LLM agents describe the data of a system — entities, their attributes, and the relationships between them — beside the SMDF documents that describe its behaviour. The two are designed in the same loom, during conceptualization, before code exists.

**Desired Outcomes:**
1. A user or an agent writes one `.erdf.json` file and reads it back as an entity-relationship diagram
2. An ERDF document is domain-neutral: the same format serves a trading platform, a film pipeline, or any other system
3. One ERDF document accompanies any number of SMDF documents; an entity shared by several machines is written once
4. The names an SMDF document uses for its data (object classes, guard fields) can be checked against the ERDF document at design time

## Core Concepts

### EntityRelationshipDefinition
Root container holding `settings`, `entities`, and `relationships`.

```json
{
  "settings": { "namespace": "...", "name": "...", "description": "..." },
  "entities": [ { "name": "...", "attributes": [...] } ],
  "relationships": [ { "from": "...", "to": "...", "cardinality": "1:N", "label": "..." } ]
}
```

ERDF is a **sibling** of SMDF, never a section inside it. A machine is one behaviour; an entity is shared by every machine that touches it.

### ErdEntity

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique entity identifier |
| `description` | string | Human-readable purpose |
| `attributes` | ErdAttribute[] | The entity's fields |

### ErdAttribute

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique within its entity |
| `type` | string | Free string, as SMDF `ParameterDef.type` is (`int`, `string`, `decimal(10,5)`) |
| `key` | `"pk"` \| `"uk"` | Primary key or unique key. A foreign key is stated by `references`, so one attribute can be both |
| `references` | string | `"Entity"` or `"Entity.attribute"` — makes this attribute a foreign key |
| `nullable` | boolean | May be absent |
| `stateOf` | string | The `settings.name` of the SMDF machine whose current state this attribute stores |
| `description` | string | Human-readable purpose |

### ErdRelationship

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Entity name |
| `to` | string | Entity name |
| `cardinality` | `"1:1"` \| `"1:N"` \| `"N:1"` \| `"N:M"` | Read left to right: one `from` has many `to` is `1:N` |
| `label` | string | The verb between them (`has`, `places`) |
| `description` | string | Human-readable purpose |

Relationships are addressed positionally by index, as SMDF transitions are.

## The link to SMDF

Both links are by name. Neither document holds a path to the other.

| SMDF side | ERDF side | Meaning |
|---|---|---|
| `settings.objects[].class` | `entities[].name` | The object a machine is constructed with is this entity |
| `transitions[].condition` containing `<instance>.<field>` | an attribute of the entity that `<instance>`'s class names | The guard reads this field |
| `settings.name` | `attributes[].stateOf` | This attribute stores that machine's current state |

`checkLinks(smdf, erdf)` reports each name on the SMDF side that the ERDF side does not carry. A guard is a free string, so the check reads only the `<instance>.<field>` shape, for instances declared in `settings.objects[]`, and skips method calls (`strategy.validate_mpr(...)`).

## Validation Rules

Rule IDs carry their own prefix so they are never mistaken for the SMDF `V` rules.

| Rule | Description |
|------|-------------|
| E001 | Entity names are non-empty and unique |
| E002 | Attribute names are non-empty and unique within their entity |
| E003 | Relationship `from` and `to` each name a defined entity |
| E004 | Relationship `cardinality` is one of `1:1`, `1:N`, `N:1`, `N:M` |
| E005 | Attribute `references` names a defined entity, and a defined attribute of it when `Entity.attribute` is given |

Link rules, reported by `checkLinks`:

| Rule | Description |
|------|-------------|
| L001 | SMDF `objects[].class` names a defined entity, for every object a guard reads a field of. An object no guard reads is usually a service (a broker, a data provider) and is left alone |
| L002 | A guard's `<instance>.<field>` names a defined attribute of that instance's entity |
| L003 | An attribute whose `stateOf` names the machine being checked belongs to an entity that is the class of one of that machine's objects |
| L004 | Each `stateOf` names one of the machines at hand (`checkStateOf`, when several SMDF documents are checked together) |

## File Format

**Canonical**: `.erdf.json` (JSON). Tools pick the document type from the extension; `isErdDefinition()` tells the two shapes apart when only content is at hand.

## Rendering

`renderMermaidEr(def)` produces a Mermaid `erDiagram`. Cardinality maps `1:1` → `||--||`, `1:N` → `||--o{`, `N:1` → `}o--||`, `N:M` → `}o--o{`. Attribute keys render as `PK`, `UK`, `FK`; `stateOf` renders as the attribute's comment. An entity with no attributes and no relationship still gets a line of its own, because an entity Mermaid never hears about is one it never draws.

## Slices

| Slice | Scope | State |
|---|---|---|
| S1 | This spec | landed |
| S2 | `bridge-protocol/src/erd/` — types, validator, Mermaid render, examples | landed |
| S3 | MCP tools in `mcp/src/erd.ts`, document type by extension | landed |
| S4 | `<EntityRelationshipCanvas>` in `bridge-canvas`, live over the hub's `full` envelope | pending |
| S5 | `checkLinks` in the protocol, `check_links` MCP tool | landed |

## MCP Tools

The loom weaves one active document, and its type is its extension. `set_project_file` takes either; the state-machine tools refuse to write over an ERD.

**Build** — `create_erd(namespace, name, description?, path?, overwrite?)` (also makes it the active document), `add_entity(name, description?)`, `add_attribute(entity, name, type, key?, references?, nullable?, stateOf?, description?)`, `add_relationship(from, to, cardinality, label?, description?)`

**Correct** — `remove_entity(name)` (takes its relationships with it), `remove_attribute(entity, name)`, `remove_relationship(from, to, label?)`

**Check** — `validate_erd()` (E001–E005), `check_links(erd_path?, smdf_paths?)` (L001–L004). With no arguments from an ERD, every `.smdf.json` beside it is checked.

**By extension** — `get_definition`, `load_definition` and `render_diagram` answer for the ERD when the active document is one. An ERD renders as `mermaid` only, to `<name>.erd.mmd`.

Every edit is written to disk, then mirrored to the bridge room as a whole document. The edits themselves are the pure functions in `bridge-protocol/src/erd/edit.ts`, which the canvas uses too.

## Creative Advancement Scenarios

### Scenario: Agent and Human Conceptualize a System
**Desired Outcome**: A system's data and behaviour are drawn side by side before any code is written
**Current Reality**: The loom holds state machines only; entities live in prose or in the head of whoever is speaking
**Natural Progression**: The agent calls `create_erd`, adds entities and relationships as the conversation names them, the human reads the diagram and corrects it, then the machines that act on those entities are drawn as SMDF
**Resolution**: One `.erdf.json` and one or more `.smdf.json` that name the same things

### Scenario: A Guard Names a Field That Does Not Exist
**Desired Outcome**: The mismatch is reported while the diagram is being designed
**Current Reality**: `strategy.fractal_count >= strategy.min_fractal_count` is a free string nothing checks
**Natural Progression**: `checkLinks` resolves `strategy` to its class, the class to an entity, and each field to an attribute
**Resolution**: L002 names the missing field, or the check passes and the guard is known to be readable

## Dependencies

- **Spec 70 (SMDF)**: the sibling format; the link rules read its `settings.objects[]`, `settings.name` and transition `condition`
- **Spec 73 (MCP Server)**: gains the ERD tools in S3
- **Spec 74 (Web Designer)** and **Spec 77 (Bridge)**: gain the ERD canvas and its live sync in S4
