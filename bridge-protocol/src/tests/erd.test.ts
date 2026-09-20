/**
 * ERDF (Spec 80): the validator's five rules, the Mermaid `erDiagram` render,
 * the link check against an SMDF document, and the two shipped examples.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  emptyErd,
  isErdDefinition,
  isErdfPath,
  parseReference,
  stateOfList,
  type EntityRelationshipDefinition,
} from "../erd/definition.js";
import { validateErd } from "../erd/validate.js";
import { checkLinks, checkStateOf, guardFields } from "../erd/links.js";
import { renderMermaidEr } from "../render/mermaidEr.js";
import {
  addAttribute,
  addEntity,
  addRelationship,
  removeAttribute,
  removeEntity,
  removeRelationship,
  summarizeErd,
} from "../erd/edit.js";
import type { StateMachineDefinition } from "../definition.js";

const LIBRARY: EntityRelationshipDefinition = {
  settings: { namespace: "demo", name: "Library" },
  entities: [
    {
      name: "Member",
      attributes: [
        { name: "member_id", type: "int", key: "pk" },
        { name: "email", type: "string", key: "uk" },
      ],
    },
    {
      name: "Loan",
      attributes: [
        { name: "loan_id", type: "int", key: "pk" },
        { name: "member_id", type: "int", references: "Member.member_id" },
        { name: "status", type: "string", stateOf: "LoanLifecycle" },
        { name: "renewal_count", type: "int" },
        { name: "max_renewals", type: "int" },
      ],
    },
    { name: "Shelf" },
  ],
  relationships: [{ from: "Member", to: "Loan", cardinality: "1:N", label: "takes out" }],
};

const LOAN_MACHINE: StateMachineDefinition = {
  settings: {
    namespace: "demo",
    name: "LoanLifecycle",
    asynchronous: false,
    objects: [{ instance: "loan", class: "Loan" }],
  },
  events: [{ name: "Desk", feeder: "Desk", events: [{ id: "Renew" }, { id: "Return" }] }],
  state: {
    name: "Root",
    states: [
      {
        name: "Out",
        transitions: [
          { event: "Renew", nextState: "Out", condition: "loan.renewal_count < loan.max_renewals" },
          { event: "Return", nextState: "Returned" },
        ],
      },
      { name: "Returned", kind: "final" },
    ],
  },
};

const rules = (errors: { ruleId: string }[]): string[] => errors.map((e) => e.ruleId);

test("a well-formed definition has no errors", () => {
  assert.deepEqual(validateErd(LIBRARY), []);
});

test("E001 — duplicate and unnamed entities", () => {
  const def = structuredClone(LIBRARY);
  def.entities.push({ name: "Member" }, { name: "" });
  assert.deepEqual(rules(validateErd(def)), ["E001", "E001"]);
});

test("E002 — duplicate attribute within one entity; the same name in two entities is fine", () => {
  const def = structuredClone(LIBRARY);
  def.entities[1].attributes!.push({ name: "status", type: "string" });
  const errors = validateErd(def);
  assert.deepEqual(rules(errors), ["E002"]);
  assert.equal(errors[0].element, "Loan.status");
});

test("E003 and E004 — relationship ends and cardinality", () => {
  const def = structuredClone(LIBRARY);
  def.relationships.push({ from: "Member", to: "Ghost", cardinality: "many" as never });
  assert.deepEqual(rules(validateErd(def)), ["E003", "E004"]);
});

test("E005 — references to a missing entity, and to a missing attribute of a real one", () => {
  const def = structuredClone(LIBRARY);
  def.entities[1].attributes!.push(
    { name: "copy_id", type: "int", references: "Copy.copy_id" },
    { name: "who", type: "int", references: "Member.nope" },
    { name: "whole", type: "int", references: "Member" },
  );
  const errors = validateErd(def);
  assert.deepEqual(rules(errors), ["E005", "E005"]);
  assert.match(errors[0].message, /undefined entity "Copy"/);
  assert.match(errors[1].message, /undefined attribute "Member\.nope"/);
});

test("a document with its arrays missing is reported on, never thrown on", () => {
  const broken = { settings: { namespace: "x", name: "y" } } as unknown as EntityRelationshipDefinition;
  assert.deepEqual(validateErd(broken), []);
  assert.equal(renderMermaidEr(broken), "erDiagram");
});

test("mermaid — relationships, keys, stateOf comment, and the entity nothing mentions", () => {
  const out = renderMermaidEr(LIBRARY).split("\n");
  assert.equal(out[0], "erDiagram");
  assert.ok(out.includes('    Member ||--o{ Loan : "takes out"'));
  assert.ok(out.includes("        int member_id PK"));
  assert.ok(out.includes("        string email UK"));
  assert.ok(out.includes("        int member_id FK"));
  assert.ok(out.includes('        string status "stateOf LoanLifecycle"'));
  assert.ok(out.includes("    Shelf"), "an entity with no attributes and no relationship still gets a line");
});

test("mermaid — every cardinality, an unlabelled relationship, and names mermaid cannot take bare", () => {
  const def = emptyErd("demo", "Shapes");
  def.entities.push(
    { name: "A", attributes: [{ name: "pk fk", type: "dict[str, int]", key: "pk", references: "B" }] },
    { name: "B" },
    { name: "Order Line" },
  );
  def.relationships.push(
    { from: "A", to: "B", cardinality: "1:1" },
    { from: "A", to: "B", cardinality: "N:1", label: 'say "hi"' },
    { from: "A", to: "Order Line", cardinality: "N:M", label: "lists" },
  );
  const out = renderMermaidEr(def);
  assert.ok(out.includes('A ||--|| B : ""'));
  assert.ok(out.includes("A }o--|| B : \"say 'hi'\""));
  assert.ok(out.includes('A }o--o{ "Order Line" : "lists"'));
  assert.ok(out.includes("dict[str_int] pk_fk PK, FK"));
});

test("guardFields reads <instance>.<field>, skips calls and other instances", () => {
  assert.deepEqual(guardFields("loan.renewal_count < loan.max_renewals", "loan"), ["renewal_count", "max_renewals"]);
  assert.deepEqual(guardFields("loan.can_renew(today) and loan.due_at > now", "loan"), ["due_at"]);
  assert.deepEqual(guardFields("payload.loan.id == 3 or myloan.x", "loan"), []);
});

test("links — a machine whose names all resolve reports nothing", () => {
  assert.deepEqual(checkLinks(LOAN_MACHINE, LIBRARY), []);
});

test("L001 — an object class that is no entity; its guard fields are not reported a second time", () => {
  const smdf = structuredClone(LOAN_MACHINE);
  smdf.settings.objects = [{ instance: "loan", class: "LoanEntity" }];
  const errors = checkLinks(smdf, LIBRARY);
  // Loan.status says it stores this machine's state, and Loan is no longer one of its objects.
  assert.deepEqual(rules(errors), ["L001", "L003"]);
});

test("L001 — a service object no guard reads a field of is left alone", () => {
  const smdf = structuredClone(LOAN_MACHINE);
  smdf.settings.objects!.push({ instance: "desk", class: "DeskService" });
  smdf.state.states![0].transitions![1].condition = "desk.is_open()";
  assert.deepEqual(checkLinks(smdf, LIBRARY), []);
});

test("L002 — a guard reads a field the entity does not have", () => {
  const smdf = structuredClone(LOAN_MACHINE);
  smdf.state.states![0].transitions![0].condition = "loan.renewals < loan.max_renewals";
  const errors = checkLinks(smdf, LIBRARY);
  assert.deepEqual(rules(errors), ["L002"]);
  assert.match(errors[0].message, /"loan\.renewals".*"Loan"/);
});

test("L002 — guards inside parallel regions are read too", () => {
  const smdf = structuredClone(LOAN_MACHINE);
  smdf.state.states!.push({
    name: "Tracking",
    parallel: {
      nextState: "Returned",
      states: [
        { name: "R1", states: [{ name: "R1a", transitions: [{ event: "Renew", condition: "loan.ghost > 0" }] }] },
        { name: "R2", states: [{ name: "R2a" }] },
      ],
    },
  });
  assert.deepEqual(rules(checkLinks(smdf, LIBRARY)), ["L002"]);
});

test("L004 — stateOf names a machine that is not among those checked", () => {
  assert.deepEqual(checkStateOf(LIBRARY, ["LoanLifecycle"]), []);
  assert.deepEqual(rules(checkStateOf(LIBRARY, ["Other"])), ["L004"]);
});

test("edits return a new definition and leave the input alone", () => {
  const start = emptyErd("demo", "Shop");
  let def = addEntity(start, { name: "Customer" });
  def = addEntity(def, { name: "Order", description: "One purchase" });
  def = addAttribute(def, "Order", { name: "order_id", type: "int", key: "pk", nullable: undefined });
  def = addAttribute(def, "Order", { name: "customer_id", type: "int", references: "Customer" });
  def = addRelationship(def, { from: "Customer", to: "Order", cardinality: "1:N", label: "places" });
  assert.deepEqual(start.entities, [], "the input is untouched");
  assert.deepEqual(validateErd(def), []);
  assert.ok(!("nullable" in def.entities[1].attributes![0]), "undefined never reaches the JSON");
  assert.equal(summarizeErd(def), "Customer — 0 attribute(s)\nOrder — 2 attribute(s)\nCustomer 1:N Order : places");

  def = removeAttribute(def, "Order", "customer_id");
  assert.equal(def.entities[1].attributes!.length, 1);
  def = removeEntity(def, "Customer");
  assert.deepEqual(def.relationships, [], "removing an entity removes the relationships that touch it");
});

test("edits that cannot be made say why", () => {
  const def = addEntity(emptyErd("demo", "Shop"), { name: "Customer" });
  assert.throws(() => addEntity(def, { name: "Customer" }), /already exists/);
  assert.throws(() => addEntity(def, { name: " " }), /needs a name/);
  assert.throws(() => addAttribute(def, "Ghost", { name: "x", type: "int" }), /Entity 'Ghost' not found\. Entities: Customer\./);
  assert.throws(() => addRelationship(def, { from: "Customer", to: "Ghost", cardinality: "1:N" }), /'Ghost' not found/);
  assert.throws(() => addRelationship(def, { from: "Customer", to: "Customer", cardinality: "lots" as never }), /is not one of/);
  assert.throws(() => removeAttribute(def, "Customer", "nope"), /not found/);
  assert.throws(() => removeRelationship(def, "Customer", "Customer"), /No relationship/);
});

test("removeRelationship takes every match, or only the labelled one", () => {
  let def = addEntity(addEntity(emptyErd("demo", "G"), { name: "A" }), { name: "B" });
  def = addRelationship(def, { from: "A", to: "B", cardinality: "1:N", label: "owns" });
  def = addRelationship(def, { from: "A", to: "B", cardinality: "N:M", label: "likes" });
  assert.equal(removeRelationship(def, "A", "B", "likes").relationships.length, 1);
  assert.equal(removeRelationship(def, "A", "B").relationships.length, 0);
});

test("small helpers", () => {
  assert.deepEqual(parseReference("Member.member_id"), { entity: "Member", attribute: "member_id" });
  assert.deepEqual(parseReference("Member"), { entity: "Member" });
  assert.deepEqual(stateOfList({ name: "s", type: "int", stateOf: ["A", "B"] }), ["A", "B"]);
  assert.deepEqual(stateOfList({ name: "s", type: "int" }), []);
  assert.ok(isErdfPath("/x/Data.ERDF.json"));
  assert.ok(!isErdfPath("/x/machine.smdf.json"));
  assert.ok(isErdDefinition(LIBRARY));
  assert.ok(!isErdDefinition(LOAN_MACHINE));
});

test("the shipped examples validate and render", () => {
  for (const name of ["library_lending", "trading_strategy"]) {
    const url = new URL(`../../../examples/${name}.erdf.json`, import.meta.url);
    const def = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as EntityRelationshipDefinition;
    assert.ok(isErdDefinition(def), name);
    assert.deepEqual(validateErd(def), [], name);
    assert.ok(renderMermaidEr(def).startsWith("erDiagram\n"), name);
  }
});
