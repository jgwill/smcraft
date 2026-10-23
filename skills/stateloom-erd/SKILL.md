---
name: stateloom-erd
description: Design an entity-relationship diagram (ERD) conversationally through the stateloom MCP tools, as the data model beside a system's state machines. Use when creating or editing a .erdf.json document, calling create_erd, add_entity, update_entity, add_attribute, add_relationship, remove_entity, remove_attribute, remove_relationship, validate_erd or check_links, modelling entities, attributes, primary and foreign keys, cardinality (1:1, 1:N, N:1, N:M) or weak entities, fixing E001-E005 validation errors or L001-L004 link errors, reading or leaving notes with get_notes and set_notes, linking an entity to a state machine with stateOf, choosing between crow's foot and Chen notation, or conceptualizing a system's data with a human on the live canvas.
---

# Designing an ERD through the MCP tools

An ERD here is a `.erdf.json` document: **ERDF**, the sibling of SMDF. A `.smdf.json`
describes one behaviour; a `.erdf.json` describes the data every behaviour acts on —
entities, their attributes, and the relationships between them. One ERD accompanies any
number of state machines, so an entity shared by several machines is written once.

It is a design document, written during conceptualization, before code exists. A human can
watch and edit the same document live on the canvas while you work.

Full specification: `rispecs/80-erdf-format.spec.md` in `jgwill/smcraft`.

---

## Step 0 — The active document's type is its extension

The loom weaves ONE active document at a time. `.smdf.json` is a state machine; `.erdf.json`
is an ERD. The ERD tools act only while the active document is an `.erdf.json`.

```
get_project_file
```

`create_erd` is the one tool that also MOVES the active document — naming an ERD is how its
first version is written. To go back to a machine afterwards:

```
set_project_file  { "path": "/abs/path/to/loan-lifecycle.smdf.json" }
```

While an ERD is active, `create_state_machine` and `load_definition` of a machine **refuse**:
they will not write a machine over an ERD. `get_definition`, `load_definition` and
`render_diagram` answer for the ERD instead.

---

## The 10 ERD tools

| Group | Tools |
|---|---|
| Create | `create_erd(namespace, name, description?, path?, overwrite?)` |
| Build | `add_entity(name, description?, weak?)`, `add_attribute(entity, name, type, key?, references?, nullable?, stateOf?, description?)`, `add_relationship(from, to, cardinality, label?, description?)` |
| Correct | `update_entity(name, description?, weak?)`, `remove_entity(name)`, `remove_attribute(entity, name)`, `remove_relationship(from, to, label?)` |
| Check | `validate_erd()`, `check_links(erd_path?, smdf_paths?)` |
| Notes (shared with state machines) | `get_notes()`, `set_notes(target?, notes)` |

Every edit is `read file → edit → write file → push the whole document to the live bridge`.
The file is the session.

---

## The order that works

### 1. Create

```
create_erd  { "namespace": "Examples.Library", "name": "LibraryLending" }
```

Without `path` it lands beside the active document as `<name>.erdf.json` and becomes the
active document. It refuses to replace an ERD that already has entities unless
`overwrite: true` — use `set_project_file` to keep working on an existing one.

### 2. Entities first, all of them

```
add_entity  { "name": "Member", "description": "A person who may borrow" }
add_entity  { "name": "Loan" }
add_entity  { "name": "Copy", "weak": true }
```

`weak` marks an entity that exists only through another (a copy without its book, an order
line without its order). Add every entity before any relationship — a relationship whose end
does not exist is refused, and the error lists the entities that do.

### 3. Attributes

```
add_attribute  { "entity": "Loan", "name": "loan_id",   "type": "int", "key": "pk" }
add_attribute  { "entity": "Loan", "name": "member_id", "type": "int", "references": "Member.member_id" }
add_attribute  { "entity": "Loan", "name": "status",    "type": "string", "stateOf": "LoanLifecycle" }
```

- `type` is a free string (`int`, `string`, `decimal(10,5)`, `json`).
- `key` is `pk` or `uk`. **A foreign key is stated by `references`**, not by `key` — so one
  attribute can be both a primary key and a foreign key (a join table).
- `references` is `"Entity"` or `"Entity.attribute"`.
- `stateOf` names the state machine (its `settings.name`) whose current state this attribute
  stores. It may be a list when one column serves several machines.

### 4. Relationships

```
add_relationship  { "from": "Member", "to": "Loan", "cardinality": "1:N", "label": "takes out" }
```

Cardinality reads **left to right**: one `from` has many `to` is `1:N`. Values: `1:1`, `1:N`,
`N:1`, `N:M`. The label is the verb between them.

### 5. Validate, then look

```
validate_erd
render_diagram          # an ERD renders as mermaid (erDiagram); svg/png are not drawn yet
```

---

## Reading validation output

| Rule | Meaning | Usual fix |
|---|---|---|
| E001 | entity name empty or duplicated | rename or `remove_entity` |
| E002 | attribute name empty or duplicated within its entity | `remove_attribute` then re-add |
| E003 | a relationship end names an entity that does not exist | it was removed or mistyped — `remove_relationship`, re-add |
| E004 | cardinality is not one of `1:1`, `1:N`, `N:1`, `N:M` | re-add with a valid value |
| E005 | `references` names a missing entity, or a missing attribute of a real one | add the target first, or fix the name |

The ids carry an `E` so they are never confused with the state machine's `V` rules.
`remove_entity` takes the entity's relationships with it, but leaves attributes elsewhere
that reference it — `validate_erd` then names them as E005.

---

## The link to the state machines

Two documents, linked **by name only** — neither holds a path to the other:

| In the machine (SMDF) | In the ERD | Meaning |
|---|---|---|
| `settings.objects[].class` | an entity's `name` | the object the machine is built with IS this entity |
| a guard containing `<instance>.<field>` | an attribute of that entity | the guard reads this field |
| `settings.name` | an attribute's `stateOf` | this attribute stores that machine's state |

```
check_links
```

From an active ERD with no arguments, it checks **every `.smdf.json` in the same folder**.
From an active machine, pass `erd_path`.

| Rule | Meaning |
|---|---|
| L001 | an object a guard reads fields of has a class that is no entity. An object no guard reads is treated as a service (a broker, a data provider) and left alone |
| L002 | a guard reads `<instance>.<field>` and the entity has no such attribute |
| L003 | an attribute says it stores this machine's state, but its entity is not the class of any of the machine's objects |
| L004 | `stateOf` names a machine that is not among those checked |

This is where the ERD earns its place: a machine that reads a field the data does not have is
reported while both are still drawings. Guards are free text, so only the
`<instance>.<field>` shape is read and method calls (`strategy.validate(...)`) are skipped.

---

## Notes — read them first, leave your own

A person discussing the diagram writes notes into it: on the whole diagram, or on one entity.
They are saved in the document (`settings.notes`, `entities[].notes`) for whoever opens it
next — a future self, or you.

```
get_notes                                                   # every note, the diagram's own first
set_notes  { "target": "Loan", "notes": "Needs a grace period — ask the desk." }
set_notes  { "notes": "Decided: 'Member', not 'Patron'." }   # no target = the whole diagram
set_notes  { "target": "Loan", "notes": "" }                 # an empty string clears it
```

**Call `get_notes` before changing a diagram someone else has worked on** — it is where they
left what they were thinking. `set_notes` replaces the text, so to add to a note, read it and
write back the whole thing. `description` says what an entity IS; notes are the conversation
about it. On the canvas a shape with notes carries a small tab on its top edge. Notes are not
part of the model: nothing that generates code from the document reads them.

---

## Two notations — a view, never data

The canvas draws the same document two ways, chosen with the ▤ / ◇ switch in its header:

- **Crow's foot** (default): attributes are rows inside the entity box; `PK` / `UK` / `FK`
  badges; a bar or a crow's foot at each end of a line. Compact — right once attribute lists
  grow.
- **Chen**: the entity is a rectangle (double when `weak`), each attribute an oval with the
  primary key underlined, each relationship a diamond carrying its verb, `1` / `N` / `M`
  beside the line. Right early on, when entities have a handful of attributes and the
  relationships are the subject.

The notation is the viewer's choice, kept in their browser. **It is never written to the
file**, so nothing you do changes with it, and nothing that reads the file (tools,
`check_links`, a code generator) depends on it. Do not model anything "for Chen" or "for
crow's foot".

---

## Common mistakes

- **Putting entities inside the state machine.** They belong in the sibling `.erdf.json`; an
  entity is usually shared by several machines.
- **`key: "fk"`.** There is no such value. A foreign key is `references`.
- **Relationships before entities.** Add every entity first.
- **Reading cardinality backwards.** `from: Member, to: Loan, 1:N` — one member, many loans.
- **Forgetting to switch back.** After `create_erd` the active document is the ERD; the
  state-machine tools report "no state machine" until you `set_project_file` to the machine.
- **Naming an object class something the model never has** (`LoanEntity` for `Loan`).
  `check_links` reports it as L001 + L003; use the entity's own name.

---

## Worked example — a lending library

```
create_erd        { "namespace": "Examples.Library", "name": "LibraryLending" }
add_entity        { "name": "Member" }
add_entity        { "name": "Book" }
add_entity        { "name": "Copy", "weak": true }
add_entity        { "name": "Loan" }
add_attribute     { "entity": "Member", "name": "member_id", "type": "int", "key": "pk" }
add_attribute     { "entity": "Member", "name": "email", "type": "string", "key": "uk" }
add_attribute     { "entity": "Book", "name": "book_id", "type": "int", "key": "pk" }
add_attribute     { "entity": "Copy", "name": "copy_id", "type": "int", "key": "pk" }
add_attribute     { "entity": "Copy", "name": "book_id", "type": "int", "references": "Book.book_id" }
add_attribute     { "entity": "Loan", "name": "loan_id", "type": "int", "key": "pk" }
add_attribute     { "entity": "Loan", "name": "member_id", "type": "int", "references": "Member.member_id" }
add_attribute     { "entity": "Loan", "name": "copy_id", "type": "int", "references": "Copy.copy_id" }
add_attribute     { "entity": "Loan", "name": "status", "type": "string", "stateOf": "LoanLifecycle" }
add_attribute     { "entity": "Loan", "name": "renewal_count", "type": "int" }
add_attribute     { "entity": "Loan", "name": "max_renewals", "type": "int" }
add_relationship  { "from": "Book", "to": "Copy", "cardinality": "1:N", "label": "is held as" }
add_relationship  { "from": "Member", "to": "Loan", "cardinality": "1:N", "label": "takes out" }
add_relationship  { "from": "Copy", "to": "Loan", "cardinality": "1:N", "label": "is lent as" }
validate_erd
```

Then the machine that acts on it, in the same folder, built with `loan: Loan` as its object
and the guard `loan.renewal_count < loan.max_renewals` — and `check_links` confirms every
name resolves. The shipped file is `examples/library_lending.erdf.json`.

---

## When the live canvas is running

Every edit is pushed to the hub as a whole document, so a human watching
`<canvas>/?doc=/abs/path/to/LibraryLending.erdf.json` sees each entity arrive. They can edit
the same document from its panel; their edits are written to disk first, so your next tool
call reads them. Add entities and relationships in small, narratable steps rather than one
`load_definition` dump — the human is reading the board while you work. An attribute with
`stateOf` shows a ◉, and activating it opens that state machine. The loop itself is the
subject of the `stateloom-live-loop` skill.
