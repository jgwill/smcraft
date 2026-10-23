/**
 * index.ts — the library face of the skill pack.
 *
 * `dist/bin.js` is the command; this is the barrel, and it is deliberately
 * free of side effects. A tool that wants to enumerate the pack, read a
 * description, or install a skill into somewhere the CLI has no opinion about
 * imports from here without a process exiting underneath it.
 */
export { loadCatalog, findSkill, skillsRoot, parseFrontmatter } from "./catalog.js";
export type { Skill } from "./catalog.js";
export { installSkill, installSkills, defaultTargetDir } from "./install.js";
export type { InstallOpts, InstallResult, InstallStatus } from "./install.js";
