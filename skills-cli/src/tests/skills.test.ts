/**
 * skills.test.ts — the install contract, proved against a fixture pack.
 *
 * `STATELOOM_SKILLS_SOURCE` lets the catalog read a temporary directory instead
 * of the bundled one, so these run without a build having mirrored `skills/`
 * and without asserting anything about how many skills happen to ship today.
 *
 * The behaviour worth pinning down is the one a consumer only discovers when it
 * is already too late: a second install must not eat an edited skill.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadCatalog, findSkill, parseFrontmatter } from "../catalog.js";
import { installSkill, installSkills, defaultTargetDir } from "../install.js";

const work = mkdtempSync(join(tmpdir(), "stateloom-skills-"));
const pack = join(work, "pack");

function writeSkill(name: string, description: string, body = "steps go here"): void {
  const dir = join(pack, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`
  );
}

writeSkill("alpha-skill", "Use when alpha.");
writeSkill("beta-skill", "Use when beta.");
mkdirSync(join(pack, "beta-skill", "nested"), { recursive: true });
writeFileSync(join(pack, "beta-skill", "nested", "reference.md"), "# reference\n");
// A directory with no SKILL.md is not a skill and must be skipped, not crash.
mkdirSync(join(pack, "not-a-skill"), { recursive: true });

after(() => rmSync(work, { recursive: true, force: true }));

test("frontmatter yields name and description, quotes stripped", () => {
  const front = parseFrontmatter('---\nname: x\ndescription: "Use when: y, or z."\n---\nbody\n');
  assert.equal(front.name, "x");
  assert.equal(front.description, "Use when: y, or z.");
});

test("frontmatter on a file that has none yields nothing", () => {
  assert.deepEqual(parseFrontmatter("# just a heading\n"), {});
});

test("catalog lists only directories holding a SKILL.md, sorted", () => {
  const catalog = loadCatalog(pack);
  assert.deepEqual(
    catalog.map((s) => s.name),
    ["alpha-skill", "beta-skill"]
  );
  assert.equal(catalog[0]!.description, "Use when alpha.");
  assert.deepEqual(catalog[1]!.files, ["SKILL.md", "nested/reference.md"]);
});

test("catalog on a missing root is empty, not a throw", () => {
  assert.deepEqual(loadCatalog(join(work, "nope")), []);
});

test("findSkill returns undefined for an unknown name", () => {
  assert.equal(findSkill("ghost", pack), undefined);
});

test("install copies the whole directory, nested files included", () => {
  const dest = join(work, "dest-1");
  const result = installSkill("beta-skill", { dir: dest, root: pack });
  assert.equal(result.status, "installed");
  assert.equal(result.files, 2);
  assert.match(readFileSync(join(dest, "beta-skill", "SKILL.md"), "utf8"), /beta-skill/);
  assert.equal(readFileSync(join(dest, "beta-skill", "nested", "reference.md"), "utf8"), "# reference\n");
});

test("a second install keeps the consumer's edits until --force", () => {
  const dest = join(work, "dest-2");
  installSkill("alpha-skill", { dir: dest, root: pack });

  const installed = join(dest, "alpha-skill", "SKILL.md");
  writeFileSync(installed, "MINE\n");

  const again = installSkill("alpha-skill", { dir: dest, root: pack });
  assert.equal(again.status, "exists");
  assert.equal(readFileSync(installed, "utf8"), "MINE\n");

  const forced = installSkill("alpha-skill", { dir: dest, root: pack, force: true });
  assert.equal(forced.status, "replaced");
  assert.match(readFileSync(installed, "utf8"), /alpha-skill/);
});

test("--force removes a stale file rather than leaving it beside the new pack", () => {
  const dest = join(work, "dest-3");
  installSkill("alpha-skill", { dir: dest, root: pack });
  const ghost = join(dest, "alpha-skill", "leftover.md");
  writeFileSync(ghost, "from an older release\n");

  installSkill("alpha-skill", { dir: dest, root: pack, force: true });
  assert.equal(loadCatalog(dest)[0]!.files.includes("leftover.md"), false);
});

test("dry-run reports the write it would make and makes none", () => {
  const dest = join(work, "dest-4");
  const result = installSkill("alpha-skill", { dir: dest, root: pack, dryRun: true });
  assert.equal(result.status, "installed");
  assert.deepEqual(loadCatalog(dest), []);
});

test("an unknown name reports missing instead of throwing", () => {
  const results = installSkills(["alpha-skill", "ghost"], { dir: join(work, "dest-5"), root: pack });
  assert.deepEqual(
    results.map((r) => r.status),
    ["installed", "missing"]
  );
});

test("the default destination is .claude/skills under cwd", () => {
  const previous = process.env.STATELOOM_SKILLS_DIR;
  delete process.env.STATELOOM_SKILLS_DIR;
  try {
    assert.equal(defaultTargetDir("/some/project"), "/some/project/.claude/skills");
  } finally {
    if (previous !== undefined) process.env.STATELOOM_SKILLS_DIR = previous;
  }
});

test("STATELOOM_SKILLS_DIR overrides the default destination", () => {
  const previous = process.env.STATELOOM_SKILLS_DIR;
  process.env.STATELOOM_SKILLS_DIR = join(work, "env-dest");
  try {
    assert.equal(defaultTargetDir("/some/project"), join(work, "env-dest"));
  } finally {
    if (previous === undefined) delete process.env.STATELOOM_SKILLS_DIR;
    else process.env.STATELOOM_SKILLS_DIR = previous;
  }
});
