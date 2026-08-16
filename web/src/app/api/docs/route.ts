/**
 * GET /api/docs — the documents this server would let you open.
 *
 * The `?doc=` parameter and its allowlist shipped together; the way to SEE what
 * the allowlist admits did not, so the switcher was a path prompt with no
 * autocomplete and the paths it wanted were the server's, not the human's. In a
 * container those differ — your `~/diagrams` is the server's `/data` — which
 * made "switch diagrams" a thing you had to already know how to do.
 *
 * Enumeration is bounded in lib/projectFile.ts (depth, count, no dotfiles) and
 * confined to the same roots `resolveDocPath` enforces, so this endpoint can
 * never reveal a path the file API would refuse to serve.
 */
import { NextResponse } from "next/server";
import { allowedDocRoots, getProjectFilePath, listDocuments } from "@/lib/projectFile";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<Response> {
  const { docs, truncated } = listDocuments();
  return NextResponse.json(
    {
      roots: allowedDocRoots(),
      current: getProjectFilePath(),
      docs,
      truncated,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
