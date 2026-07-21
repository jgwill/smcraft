/**
 * chokidar file-watch → external-edit differ (one watcher per room).
 *
 * A raw external edit of the `docId` file (a human editing JSON, or a
 * standalone MCP writing the whole file) becomes granular animated patches:
 * read → parse → `diffDefinition(hub.def, fileDef)` → broadcast `def:patch`.
 *
 * DEDUP + RACE: every committed state records `{mtime, hash}` in `room.ring`.
 * When a client persists then emits a `def:patch` stamped with that same
 * `mtime`, the two paths (this watch tick, and the socket handler) run on the
 * single Node event loop and each ring check/push is synchronous — whichever
 * fires first commits and rings the mtime; the other sees it in the ring and
 * only acks. Double-apply is therefore impossible.
 */
import { readFileSync, statSync } from "node:fs";
import chokidar from "chokidar";
import {
  diffDefinition,
  hashDef,
  EV,
  type StateMachineDefinition,
} from "@smcraft/bridge-protocol";
import type { Server } from "socket.io";
import type { Room } from "./hub.js";

/** The concrete watcher handle type, without depending on chokidar's named type exports. */
export type RoomWatcher = ReturnType<typeof chokidar.watch>;

interface ParsedFile {
  def: StateMachineDefinition;
  mtime: number;
}

/** Read + parse the docId file; returns null when absent or unparseable. */
function parseFile(docId: string): ParsedFile | null {
  try {
    const raw = readFileSync(docId, "utf8");
    const mtime = statSync(docId).mtimeMs;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const def = (parsed.stateMachine ?? parsed.StateMachine ?? parsed) as StateMachineDefinition;
    return { def, mtime };
  } catch {
    return null;
  }
}

export function watchRoom(io: Server, room: Room): RoomWatcher {
  const watcher = chokidar.watch(room.docId, {
    ignoreInitial: true,
    // Give a slow/large write a moment to settle before we read it.
    awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 10 },
  });

  const onFsEvent = (): void => {
    const parsed = parseFile(room.docId);
    // Transiently invalid (mid-write / unparseable): skip; a later valid tick reconciles.
    if (!parsed) return;

    const { def: fileDef, mtime } = parsed;
    const h = hashDef(fileDef);

    // Dedup: mtime OR hash already committed → echo of a client's own persist.
    if (room.ring.some((e) => e.mtime === mtime || e.hash === h)) return;

    const roomId = room.docId;
    try {
      const ops = diffDefinition(room.def, fileDef);
      // An identical-content external write yields no ops — nothing to animate.
      if (ops.length > 0) {
        room.seq += 1;
        io.to(roomId).emit(EV.PATCH_OUT, {
          docId: roomId,
          seq: room.seq,
          ops,
          origin: "file",
          mtime,
        });
      }
    } catch {
      room.seq += 1;
      io.to(roomId).emit(EV.FULL_OUT, {
        docId: roomId,
        seq: room.seq,
        def: fileDef,
        origin: "file",
        mtime,
      });
    }

    room.def = fileDef;
    room.mtime = mtime;
    room.ring.push({ mtime, hash: h });
    if (room.ring.length > 20) room.ring.splice(0, room.ring.length - 20);
  };

  watcher.on("change", onFsEvent);
  watcher.on("add", onFsEvent);
  return watcher;
}
