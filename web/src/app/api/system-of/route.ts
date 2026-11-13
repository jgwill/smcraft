/**
 * GET /api/system-of?doc=<absolute path>[&system=<.sysdf.json>] — the system
 * that lists the document.
 *
 * `{ doc, system }`: `doc` as the server resolved it, `system` the given system
 * when it lists the document, else the nearest `.sysdf.json` that does, else
 * null (lib/systemOf.ts). A doc the file API would refuse is refused here the
 * same way, a 403 with its reason.
 */
import { NextRequest, NextResponse } from "next/server";
import { systemOfDoc } from "@/lib/systemOf";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest): Promise<Response> {
  const doc = req.nextUrl.searchParams.get("doc");
  if (!doc) return NextResponse.json({ error: "doc is required" }, { status: 400 });
  const found = systemOfDoc(doc, req.nextUrl.searchParams.get("system"));
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: 403 });
  return NextResponse.json({ doc: found.doc, system: found.system }, { headers: { "cache-control": "no-store" } });
}
