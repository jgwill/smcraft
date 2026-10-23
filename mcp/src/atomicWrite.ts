/**
 * Write a document whole or not at all: to a temp file beside it, then rename.
 *
 * A reader (the hub's file watch, a canvas, another tool) never sees half a
 * file. An existing file that is not writable stays refused — a rename would
 * replace it regardless of its mode, and a read-only document is a person's
 * word that it should not change — and the new file keeps the old one's mode.
 */
import { accessSync, chmodSync, constants, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

/**
 * Create the folder a document is about to be written into, one level only.
 *
 * Earned 2026-10-01 (Episode 550, L1): `miadi-chronicle://550/screenwalk`
 * resolves to `<episode>/diagrams/screenwalk.smdf.json`, and naming a missing
 * file is how an episode's first diagram is created — but a fresh episode has
 * no `diagrams/` yet, so the first write failed with ENOENT. The folder is
 * created only when ITS parent exists (an episode's `diagrams/` room, a new
 * folder beside existing work); a path whose ancestors are missing is a typo,
 * and it still fails loudly instead of growing a tree.
 */
export function ensureParentFolder(path: string): void {
  const dir = dirname(path);
  if (existsSync(dir)) return;
  if (!existsSync(dirname(dir))) return;
  mkdirSync(dir);
}

export function writeFileAtomic(path: string, text: string): void {
  ensureParentFolder(path);
  let mode: number | undefined;
  if (existsSync(path)) {
    accessSync(path, constants.W_OK);
    mode = statSync(path).mode & 0o7777;
  }
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`);
  try {
    writeFileSync(temp, text, "utf8");
    if (mode !== undefined) chmodSync(temp, mode);
    renameSync(temp, path);
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
}
