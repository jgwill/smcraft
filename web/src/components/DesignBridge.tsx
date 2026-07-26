"use client";

import BridgeProvider from "@/components/BridgeProvider";
import SocketBridgeProvider from "@/components/SocketBridgeProvider";

/**
 * Runtime bridge picker. When NEXT_PUBLIC_SMCRAFT_BRIDGE_URL is a non-empty
 * string the app joins the real-time socket hub (live patches + presence +
 * outbound emit); otherwise it falls back to the existing file-backed SSE
 * bridge. With the env unset, behaviour is identical to before WS7a.
 */
export default function DesignBridge() {
  const url = process.env.NEXT_PUBLIC_SMCRAFT_BRIDGE_URL;
  if (typeof url === "string" && url.length > 0) {
    return <SocketBridgeProvider />;
  }
  return <BridgeProvider />;
}
