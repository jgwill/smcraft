/**
 * The ERD tools (Spec 80), driven the way an agent drives them: a real
 * McpServer, a real Client, an in-memory transport between them, and a temp
 * directory for the documents. The host is a stand-in for server.ts's state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { EntityRelationshipDefinition } from "@miadi/stateloom-protocol";
import { registerErdTools, erdGetDefinition, erdLoadDefinition, erdRender, type ErdHost } from "../erd.js";

interface Rig {
  dir: string;
  host: ErdHost;
  emitted: EntityRelationshipDefinition[];
  call(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

async function rig(opts: { root?: boolean } = {}): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), "loom-erd-"));
  let active = join(dir, "machine.smdf.json");
  const emitted: EntityRelationshipDefinition[] = [];
  const outsideRoot = (p: string): string | undefined =>
    opts.root && !p.startsWith(dir + "/") ? `Refused: ${p} is outside ${dir}` : undefined;
  const host: ErdHost = {
    projectFile: () => active,
    switchTo: (p) => {
      const denial = outsideRoot(p);
      if (denial) return denial;
      active = p;
      return undefined;
    },
    emitFull: (def) => void emitted.push(def),
    outsideRoot,
  };

  const server = new McpServer({ name: "erd-test", version: "0.0.0" });
  registerErdTools(server, host);
  const client = new Client({ name: "erd-test-client", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);

  return {
    dir,
    host,
    emitted,
    call: async (name, args = {}) => {
      const r = await client.callTool({ name, arguments: args });
      const content = r.content as { type: string; text?: string }[];
      return { text: content.map((c) => c.text ?? "").join("\n"), isError: r.isError === true };
    },
    close: async () => {
      await client.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const LOAN_MACHINE = {
  stateMachine: {
    settings: { namespace: "demo", name: "LoanLifecycle", asynchronous: false, objects: [{ instance: "loan", class: "Loan" }] },
    events: [{ name: "Desk", events: [{ id: "Renew" }] }],
    state: {
      name: "Root",
      states: [
        { name: "Out", transitions: [{ event: "Renew", nextState: "Out", condition: "loan.renewal_count < loan.max_renewals" }] },
      ],
    },
  },
};

test("an agent designs an ERD from nothing, and every edit reaches disk and the bridge", async () => {
  const r = await rig();
  try {
    const created = await r.call("create_erd", { namespace: "demo", name: "Library" });
    assert.equal(created.isError, false, created.text);
    const path = join(r.dir, "Library.erdf.json");
    assert.equal(r.host.projectFile(), path, "create_erd moves the active document next to the old one");

    for (const name of ["Member", "Loan"]) assert.equal((await r.call("add_entity", { name })).isError, false);
    await r.call("add_attribute", { entity: "Member", name: "member_id", type: "int", key: "pk" });
    await r.call("add_attribute", { entity: "Loan", name: "member_id", type: "int", references: "Member.member_id" });
    await r.call("add_attribute", { entity: "Loan", name: "status", type: "string", stateOf: "LoanLifecycle" });
    const rel = await r.call("add_relationship", { from: "Member", to: "Loan", cardinality: "1:N", label: "takes out" });
    assert.equal(rel.isError, false, rel.text);

    const onDisk = JSON.parse(readFileSync(path, "utf8")) as EntityRelationshipDefinition;
    assert.deepEqual(onDisk.entities.map((e) => e.name), ["Member", "Loan"]);
    assert.equal(onDisk.relationships.length, 1);
    assert.ok(!("stateMachine" in onDisk), "an ERD is written bare, never inside the SMDF wrapper");
    assert.equal(r.emitted.length, 7, "create + 2 entities + 3 attributes + 1 relationship");
    assert.deepEqual(r.emitted.at(-1), onDisk);

    const valid = await r.call("validate_erd");
    assert.equal(valid.isError, false, valid.text);
    assert.match(valid.text, /is valid/);
    assert.match(valid.text, /Member 1:N Loan : takes out/);
  } finally {
    await r.close();
  }
});

test("edits that cannot be made come back as tool errors that say why", async () => {
  const r = await rig();
  try {
    const early = await r.call("add_entity", { name: "Member" });
    assert.equal(early.isError, true);
    assert.match(early.text, /is not an ERD\. Use create_erd/);

    await r.call("create_erd", { namespace: "demo", name: "Library" });
    await r.call("add_entity", { name: "Member" });
    assert.match((await r.call("add_entity", { name: "Member" })).text, /already exists/);
    assert.match((await r.call("add_attribute", { entity: "Ghost", name: "x", type: "int" })).text, /Entities: Member/);
    assert.match((await r.call("remove_relationship", { from: "Member", to: "Member" })).text, /No relationship/);

    await r.call("add_attribute", { entity: "Member", name: "boss_id", type: "int", references: "Manager" });
    const invalid = await r.call("validate_erd");
    assert.equal(invalid.isError, true);
    assert.match(invalid.text, /\[E005\]/);

    const again = await r.call("create_erd", { namespace: "demo", name: "Library" });
    assert.equal(again.isError, true, "an ERD with entities is not replaced silently");
    assert.match(again.text, /overwrite: true/);
    assert.equal((await r.call("create_erd", { namespace: "demo", name: "Library", overwrite: true })).isError, false);
  } finally {
    await r.close();
  }
});

test("remove_entity takes its relationships with it; remove_attribute and remove_relationship do as named", async () => {
  const r = await rig();
  try {
    await r.call("create_erd", { namespace: "demo", name: "G" });
    for (const name of ["A", "B", "C"]) await r.call("add_entity", { name });
    await r.call("add_attribute", { entity: "A", name: "x", type: "int" });
    await r.call("add_relationship", { from: "A", to: "B", cardinality: "1:N", label: "owns" });
    await r.call("add_relationship", { from: "A", to: "C", cardinality: "N:M", label: "likes" });
    await r.call("add_relationship", { from: "B", to: "C", cardinality: "1:1" });

    assert.equal((await r.call("remove_attribute", { entity: "A", name: "x" })).isError, false);
    assert.equal((await r.call("remove_relationship", { from: "A", to: "C", label: "likes" })).isError, false);
    assert.equal((await r.call("remove_entity", { name: "B" })).isError, false);

    const def = JSON.parse(erdGetDefinition(r.host).content[0].text) as EntityRelationshipDefinition;
    assert.deepEqual(def.entities.map((e) => e.name), ["A", "C"]);
    assert.deepEqual(def.relationships, []);
  } finally {
    await r.close();
  }
});

test("weak is set at creation or later, and clearing it removes the field", async () => {
  const r = await rig();
  try {
    await r.call("create_erd", { namespace: "demo", name: "Shop" });
    assert.match((await r.call("add_entity", { name: "OrderLine", weak: true })).text, /Added weak entity/);
    await r.call("add_entity", { name: "Order" });
    await r.call("add_attribute", { entity: "Order", name: "order_id", type: "int", key: "pk" });
    assert.equal((await r.call("update_entity", { name: "Order", weak: true, description: "One purchase" })).isError, false);

    let def = JSON.parse(erdGetDefinition(r.host).content[0].text) as EntityRelationshipDefinition;
    assert.deepEqual(def.entities.map((e) => [e.name, e.weak === true]), [["OrderLine", true], ["Order", true]]);
    assert.equal(def.entities[1].attributes!.length, 1, "update_entity keeps the attributes");

    await r.call("update_entity", { name: "Order", weak: false });
    def = JSON.parse(erdGetDefinition(r.host).content[0].text) as EntityRelationshipDefinition;
    assert.ok(!("weak" in def.entities[1]));
    assert.equal(def.entities[1].description, "One purchase", "an omitted field is left alone");
    assert.equal((await r.call("update_entity", { name: "Ghost", weak: true })).isError, true);
  } finally {
    await r.close();
  }
});

test("create_erd and render stay inside the document root", async () => {
  const r = await rig({ root: true });
  try {
    const denied = await r.call("create_erd", { namespace: "demo", name: "X", path: "/elsewhere/x.erdf.json" });
    assert.equal(denied.isError, true);
    assert.match(denied.text, /Refused/);
    assert.ok(!existsSync("/elsewhere/x.erdf.json"));

    await r.call("create_erd", { namespace: "demo", name: "X" });
    assert.match(erdRender(r.host, { path: "/elsewhere/x.mmd" }).content[0].text, /Refused/);
    assert.match((await r.call("create_erd", { namespace: "demo", name: "Y", path: join(r.dir, "y.json") })).text, /ends in \.erdf\.json/);
  } finally {
    await r.close();
  }
});

test("load, get and render answer for the ERD; a machine's JSON is refused", async () => {
  const r = await rig();
  try {
    await r.call("create_erd", { namespace: "demo", name: "Library" });
    const erd = {
      settings: { namespace: "demo", name: "Library" },
      entities: [{ name: "Loan", attributes: [{ name: "loan_id", type: "int", key: "pk" }] }],
    };
    const loaded = erdLoadDefinition(r.host, JSON.stringify(erd));
    assert.equal(loaded.isError, undefined, loaded.content[0].text);
    assert.deepEqual(JSON.parse(erdGetDefinition(r.host).content[0].text).relationships, [], "a missing array is filled in");

    assert.equal(erdLoadDefinition(r.host, JSON.stringify(LOAN_MACHINE)).isError, true);
    assert.equal(erdLoadDefinition(r.host, "{nope").isError, true);

    const rendered = erdRender(r.host, {});
    assert.match(rendered.content[1].text, /^erDiagram\n {4}Loan \{/);
    assert.ok(existsSync(join(r.dir, "Library.erd.mmd")));
    assert.equal(erdRender(r.host, { format: "png" }).isError, true);
  } finally {
    await r.close();
  }
});

test("check_links: from the ERD every machine beside it is checked; from a machine, erd_path is required", async () => {
  const r = await rig();
  try {
    writeFileSync(join(r.dir, "machine.smdf.json"), JSON.stringify(LOAN_MACHINE));
    const needsErd = await r.call("check_links");
    assert.equal(needsErd.isError, true);
    assert.match(needsErd.text, /pass erd_path/);

    await r.call("create_erd", { namespace: "demo", name: "Library" });
    await r.call("add_entity", { name: "Loan" });
    await r.call("add_attribute", { entity: "Loan", name: "renewal_count", type: "int" });
    await r.call("add_attribute", { entity: "Loan", name: "status", type: "string", stateOf: ["LoanLifecycle", "Ghost"] });

    const found = await r.call("check_links");
    assert.equal(found.isError, true);
    assert.match(found.text, /Checked 1 machine\(s\)/);
    assert.match(found.text, /\[L002\].*"loan\.max_renewals"/);
    assert.match(found.text, /\[L004\].*"Ghost"/);

    await r.call("add_attribute", { entity: "Loan", name: "max_renewals", type: "int" });
    await r.call("remove_attribute", { entity: "Loan", name: "status" });
    const clean = await r.call("check_links");
    assert.equal(clean.isError, false, clean.text);
    assert.match(clean.text, /LoanLifecycle: every name resolves/);
  } finally {
    await r.close();
  }
});
