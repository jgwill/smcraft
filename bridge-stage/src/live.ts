"use client";

/**
 * The stage, live: an agent's `show` reaches the stage through the hub.
 *
 * The MCP `show` tool emits `view:show` to the room of a system file
 * (Spec 82). A stage that joins the same room receives it as a cue — which
 * member to open, what to light, the sentence to say — without anything new
 * on the agent's side. A separate entry point so a host that plays only
 * tours never loads socket.io.
 */
import { useEffect, useRef, useState } from "react";
import { createBridgeClient, type BridgeStatus } from "@miadi/stateloom-client";
import type { ViewEnvelope } from "@miadi/stateloom-protocol";
import type { StageCue } from "./DiagramStage.js";

export interface LoomCueOptions {
  /** The hub, as the browser reaches it (`http://127.0.0.1:4599`, or `/` behind one origin). */
  url: string | null | undefined;
  /** The room: the system file's absolute path, as the hub names it. */
  docId: string | null | undefined;
  /** How this stage shows in the room's presence (`eury episode room`). */
  name?: string;
  token?: string;
  /**
   * The member path the hub sends (relative to the system, or absolute),
   * turned into the path the stage knows the drawing by. Default: unchanged.
   */
  memberPath?: (member: string) => string;
}

export interface LoomCue {
  cue: StageCue | null;
  status: BridgeStatus | "off";
}

/** Join a hub room and turn every `view:show` into a stage cue. */
export function useLoomCue({ url, docId, name = "stage", token, memberPath }: LoomCueOptions): LoomCue {
  const [cue, setCue] = useState<StageCue | null>(null);
  const [status, setStatus] = useState<LoomCue["status"]>("off");
  const seq = useRef(0);
  const mapPath = useRef(memberPath);
  mapPath.current = memberPath;

  useEffect(() => {
    if (!url || !docId) {
      setStatus("off");
      return;
    }
    const client = createBridgeClient({ url, docId, role: "web", name, token });
    // Joined again on every connect: a restarted hub has forgotten the room.
    const offStatus = client.on("status", (s: BridgeStatus) => {
      setStatus(s);
      if (s === "connected") client.join().catch(() => {});
    });
    const offView = client.on("view", (view: ViewEnvelope) => {
      seq.current += 1;
      setCue({
        seq: seq.current,
        member: view.member ? (mapPath.current ? mapPath.current(view.member) : view.member) : undefined,
        focus: view.focus ? [view.focus] : [],
        text: view.note,
        from: view.origin,
      });
    });
    client.connect().catch(() => setStatus("error"));
    return () => {
      offStatus();
      offView();
      client.disconnect();
    };
  }, [url, docId, name, token]);

  return { cue, status };
}
