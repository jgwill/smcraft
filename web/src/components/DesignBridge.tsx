"use client";

import { useEffect, useState } from "react";
import BridgeProvider from "@/components/BridgeProvider";
import SocketBridgeProvider from "@/components/SocketBridgeProvider";
import { buildTimeBridgeUrl, loadRuntimeConfig } from "@/lib/runtimeConfig";

/**
 * Runtime bridge picker. With a bridge URL the app joins the real-time socket
 * hub (live patches + presence + outbound emit); without one it falls back to
 * the file-backed SSE bridge. With nothing configured anywhere, behaviour is
 * identical to before WS7a.
 *
 * The URL is asked of the server rather than read out of the bundle, so a
 * *published* build can point at whatever hub the operator is running —
 * NEXT_PUBLIC_* is inlined at build time and would otherwise bake in the URL of
 * whoever ran the build. A copy built from source with the env already set uses
 * that value on the first render, exactly as it always did.
 */
export default function DesignBridge() {
  const baked = buildTimeBridgeUrl();
  const [url, setUrl] = useState<string | undefined>(baked);

  useEffect(() => {
    // Ask even when a value was baked in: the operator's own environment is the
    // more specific answer, and /api/config only overrides when it has one.
    let live = true;
    loadRuntimeConfig().then((c) => {
      if (live && c.bridgeUrl) setUrl(c.bridgeUrl);
    });
    return () => {
      live = false;
    };
  }, []);

  // While the fetch is in flight the file-backed bridge renders, so the canvas
  // is never blank waiting on configuration.
  if (typeof url === "string" && url.length > 0) {
    return <SocketBridgeProvider url={url} />;
  }
  return <BridgeProvider />;
}
