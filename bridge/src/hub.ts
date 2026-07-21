/**
 * The socket.io hub — a pure sequencer + broadcaster + external-edit differ.
 *
 * INVARIANT: the hub never writes disk. Each mutating client persists through
 * its own durable channel and stamps the resulting `mtimeMs` on the socket
 * event it emits. The hub assigns the authoritative monotonic `seq`, keeps an
 * in-memory `def` per room, dedups a client's own persist echoes via a small
 * `{mtime, hash}` ring, and broadcasts granular `def:patch` / `def:full`.
 *
 * One socket.io room per `docId` (a normalized absolute file path). The hub
 * serves multiple docs simultaneously; each room owns its own state + watcher.
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server, type Socket } from "socket.io";
import {
  applyPatchOps,
  hashDef,
  colorFor,
  EV,
  type StateMachineDefinition,
  type Presence,
  type PatchEnvelope,
  type FullEnvelope,
} from "@smcraft/bridge-protocol";
import { normalizeDocId, readDefFile, mtimeOf } from "./docio.js";
import { watchRoom, type RoomWatcher } from "./watcher.js";

/** Last N committed `{mtime, hash}` pairs — the dedup ring for self-write echoes. */
export interface RingEntry {
  mtime: number;
  hash: string;
}

/** Presence plus the optional cursor/selection payload merged by `presence:update`. */
export type LivePresence = Presence & {
  cursor?: unknown;
  selection?: unknown;
};

/** Per-room authoritative state. `def` may be null until a def exists on disk or is sent. */
export interface Room {
  docId: string;
  def: StateMachineDefinition | null;
  seq: number;
  mtime: number;
  ring: RingEntry[];
  presence: Map<string, LivePresence>;
  watcher: RoomWatcher | null;
}

export interface StartBridgeOpts {
  port?: number;
  host?: string;
  docId?: string;
  file?: string;
  token?: string;
  cors?: boolean;
}

export interface BridgeHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

const RING_SIZE = 20;

/** How many entries the dedup ring retains (exported for tests/consumers). */
export const DEDUP_RING_SIZE = RING_SIZE;

function pushRing(room: Room, entry: RingEntry): void {
  room.ring.push(entry);
  if (room.ring.length > RING_SIZE) room.ring.splice(0, room.ring.length - RING_SIZE);
}

function ringHasMtime(room: Room, mtime: number): boolean {
  return room.ring.some((e) => e.mtime === mtime);
}

/** A best-effort mtime for a self-stamp when a client omitted one. */
function statish(room: Room): number {
  return mtimeOf(room.docId) || Date.now();
}

export function startBridge(opts: StartBridgeOpts = {}): Promise<BridgeHandle> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 0;
  const defaultDocId = normalizeDocId(
    opts.docId ?? opts.file ?? process.env.SMCRAFT_PROJECT_FILE ?? "./statemachine.smdf.json",
  );
  const token = opts.token;

  const rooms = new Map<string, Room>();

  const httpServer: HttpServer = createServer();
  const io = new Server(httpServer, {
    // socket.io-client from node does not require CORS; browsers do.
    cors: opts.cors ? { origin: "*" } : undefined,
    serveClient: false,
  });

  /** Create (seeding from disk) or fetch the room for a docId, wiring its watcher. */
  function getRoom(rawDocId: string): Room {
    const docId = normalizeDocId(rawDocId);
    let room = rooms.get(docId);
    if (room) return room;
    const def = readDefFile(docId);
    room = {
      docId,
      def,
      seq: 0,
      mtime: mtimeOf(docId),
      ring: [],
      presence: new Map(),
      watcher: null,
    };
    rooms.set(docId, room);
    room.watcher = watchRoom(io, room);
    return room;
  }

  // Seed the default room eagerly so its watcher is live from boot.
  getRoom(defaultDocId);

  function roomOfSocket(socket: Socket): Room | undefined {
    const docId = socket.data.roomId as string | undefined;
    return docId ? rooms.get(docId) : undefined;
  }

  function broadcastPresenceList(roomId: string, room: Room): void {
    io.to(roomId).emit(EV.PRESENCE_LIST, [...room.presence.values()]);
  }

  io.on("connection", (socket: Socket) => {
    socket.on(EV.JOIN, (payload: { role: Presence["role"]; name?: string; docId?: string; sinceSeq?: number }, ack?: (res: unknown) => void) => {
      if (token && socket.handshake.auth?.token !== token) {
        socket.emit(EV.ERROR, { message: "bridge: invalid or missing auth token" });
        socket.disconnect(true);
        return;
      }
      const room = getRoom(payload.docId ?? defaultDocId);
      const roomId = room.docId;
      socket.data.roomId = roomId;
      socket.join(roomId);

      const presence: LivePresence = {
        clientId: socket.id,
        role: payload.role,
        name: payload.name,
        color: colorFor(socket.id),
        joinedAt: new Date(Date.now()).toISOString(),
      };
      room.presence.set(socket.id, presence);

      if (typeof ack === "function") {
        ack({
          selfId: socket.id,
          snapshot: { docId: roomId, def: room.def, seq: room.seq, mtime: room.mtime },
          presence: [...room.presence.values()],
        });
      }

      io.to(roomId).emit(EV.PRESENCE_JOIN, presence);
      broadcastPresenceList(roomId, room);
    });

    socket.on(EV.PATCH_IN, (env: PatchEnvelope) => {
      const room = roomOfSocket(socket);
      if (!room) return;
      const roomId = room.docId;

      // mtime dedup: the file-watch already processed this persist → only ack.
      if (env.mtime !== undefined && ringHasMtime(room, env.mtime)) {
        socket.emit(EV.ACK, { docId: roomId, baseSeq: env.baseSeq, seq: room.seq });
        return;
      }

      // No base def yet (fresh project, file not seen at room-seed time). A
      // mutating client persists BEFORE it emits (durable-first), so recover
      // the authoritative full state from disk and broadcast that, rather than
      // apply a patch onto nothing. Never broadcast a null def to the room.
      if (!room.def) {
        const recovered = readDefFile(roomId);
        if (recovered) {
          room.def = recovered;
          room.seq += 1;
          room.mtime = mtimeOf(roomId);
          pushRing(room, { mtime: env.mtime ?? statish(room), hash: hashDef(room.def) });
          io.to(roomId).emit(EV.FULL_OUT, {
            docId: roomId,
            seq: room.seq,
            def: room.def,
            origin: socket.id,
            mtime: env.mtime,
          });
          socket.emit(EV.ACK, { docId: roomId, baseSeq: env.baseSeq, seq: room.seq });
        } else {
          socket.emit(EV.ERROR, {
            docId: roomId,
            message: "bridge: no base definition to patch (send def:full first)",
          });
        }
        return;
      }

      try {
        room.def = applyPatchOps(room.def, env.ops);
        room.seq += 1;
        pushRing(room, { mtime: env.mtime ?? statish(room), hash: hashDef(room.def) });
        io.to(roomId).emit(EV.PATCH_OUT, {
          docId: roomId,
          seq: room.seq,
          ops: env.ops,
          origin: socket.id,
          mtime: env.mtime,
        });
        socket.emit(EV.ACK, { docId: roomId, baseSeq: env.baseSeq, seq: room.seq });
      } catch (err) {
        socket.emit(EV.ERROR, {
          docId: roomId,
          message: err instanceof Error ? err.message : String(err),
        });
        // Resync everyone to the current authoritative def (never null).
        if (room.def) {
          io.to(roomId).emit(EV.FULL_OUT, {
            docId: roomId,
            seq: room.seq,
            def: room.def,
            origin: "hub",
          });
        }
      }
    });

    socket.on(EV.FULL_IN, (env: FullEnvelope) => {
      const room = roomOfSocket(socket);
      if (!room) return;
      const roomId = room.docId;

      if (env.mtime !== undefined && ringHasMtime(room, env.mtime)) {
        socket.emit(EV.ACK, { docId: roomId, baseSeq: undefined, seq: room.seq });
        return;
      }

      room.def = env.def;
      room.seq += 1;
      pushRing(room, { mtime: env.mtime ?? statish(room), hash: hashDef(room.def) });
      io.to(roomId).emit(EV.FULL_OUT, {
        docId: roomId,
        seq: room.seq,
        def: room.def,
        origin: socket.id,
        mtime: env.mtime,
      });
      socket.emit(EV.ACK, { docId: roomId, baseSeq: undefined, seq: room.seq });
    });

    socket.on(EV.REQUEST, (payload: { docId?: string; sinceSeq?: number }) => {
      const room = payload.docId ? getRoom(payload.docId) : roomOfSocket(socket);
      if (!room) return;
      socket.emit(EV.FULL_OUT, {
        docId: room.docId,
        seq: room.seq,
        def: room.def,
        origin: "hub",
      });
    });

    socket.on(EV.PRESENCE_IN, (payload: { cursor?: unknown; selection?: unknown }) => {
      const room = roomOfSocket(socket);
      if (!room) return;
      const current = room.presence.get(socket.id);
      if (!current) return;
      const merged: LivePresence = { ...current, ...payload };
      room.presence.set(socket.id, merged);
      io.to(room.docId).emit(EV.PRESENCE_UPDATE, { clientId: socket.id, ...payload });
    });

    function leave(): void {
      const room = roomOfSocket(socket);
      if (!room) return;
      room.presence.delete(socket.id);
      io.to(room.docId).emit(EV.PRESENCE_LEAVE, { clientId: socket.id });
      broadcastPresenceList(room.docId, room);
    }

    socket.on(EV.LEAVE, leave);
    socket.on("disconnect", leave);
  });

  return new Promise<BridgeHandle>((resolvePromise, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      const address = httpServer.address() as AddressInfo;
      const boundPort = address.port;
      const url = `http://${host}:${boundPort}`;

      const handle: BridgeHandle = {
        url,
        port: boundPort,
        async close(): Promise<void> {
          // Stop file watchers first so no post-close broadcast races.
          await Promise.all(
            [...rooms.values()].map((r) => (r.watcher ? r.watcher.close() : Promise.resolve())),
          );
          // io.close() disconnects every socket and closes the http server.
          await new Promise<void>((res) => io.close(() => res()));
        },
      };
      resolvePromise(handle);
    });
  });
}
