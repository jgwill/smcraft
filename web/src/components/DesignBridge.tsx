"use client";

import BridgeProvider from "@/components/BridgeProvider";
import SocketBridgeProvider from "@/components/SocketBridgeProvider";

/**
 * Runtime bridge picker. When NEXT_PUBLIC_STATELOOM_BRIDGE_URL (legacy twin
 * NEXT_PUBLIC_SMCRAFT_BRIDGE_URL) is a non-empty
 * string the app joins the real-time socket hub (live patches + presence +
 * outbound emit); otherwise it falls back to the existing file-backed SSE
 * bridge. With the env unset, behaviour is identical to before WS7a.
 */
export default function DesignBridge() {
  // NEXT_PUBLIC_* is inlined at build time from literal accesses only, so the
  // rename alias is an explicit twin chain here (envAlias cannot apply).
  const url =
    process.env.NEXT_PUBLIC_STATELOOM_BRIDGE_URL ??
    process.env.NEXT_PUBLIC_SMCRAFT_BRIDGE_URL;
  if (typeof url === "string" && url.length > 0) {
    return <SocketBridgeProvider />;
  }
  return <BridgeProvider />;
}
