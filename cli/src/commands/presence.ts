/**
 * `smcx presence` — join the room, print the live peer roster, disconnect.
 */
import { createBridgeClient } from "@miadi/stateloom-client";

export interface PresenceOpts {
  doc: string;
  bridgeUrl?: string;
  name?: string;
}

export async function presenceCommand(opts: PresenceOpts): Promise<void> {
  if (!opts.bridgeUrl) {
    console.error("presence: no bridge URL — set --bridge or SMCRAFT_BRIDGE_URL");
    process.exitCode = 1;
    return;
  }

  const client = createBridgeClient({
    url: opts.bridgeUrl,
    role: "cli",
    docId: opts.doc,
    name: opts.name,
  });

  try {
    const res = await client.join();
    const list = res.presence ?? [];
    console.log(`presence @ ${opts.doc} — ${list.length} peer(s):`);
    for (const p of list) {
      console.log(`  ${p.role.padEnd(8)} ${p.name ?? p.clientId}`);
    }
  } finally {
    client.disconnect();
  }
}
