/**
 * Write a document whole or not at all: to a temp file beside it, then rename.
 *
 * A reader (the hub's file watch, a canvas, another tool) never sees half a
 * file. An existing file that is not writable stays refused — a rename would
 * replace it regardless of its mode, and a read-only document is a person's
 * word that it should not change — and the new file keeps the old one's mode.
 */
import { accessSync, chmodSync, constants, existsSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

export function writeFileAtomic(path: string, text: string): void {
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
