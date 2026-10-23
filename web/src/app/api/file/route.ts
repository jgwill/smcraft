import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "fs";
import { resolveDocPath, writeDocFile } from "@/lib/projectFile";

export const dynamic = "force-dynamic";

// Optional `?doc=<absolute .json path>` selects the document; omitted, the
// default project file answers exactly as before. Every doc passes the root
// allowlist in lib/projectFile.ts — parameter and guard are one surface
// (chart chart_1785683022927). A refusal names its reason and is a 403,
// never a write. A request the file system cannot serve (a directory, a file
// that vanished) is a 4xx with the reason, never a 500 and a stack trace.

function reason(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === "EISDIR") return "that path is a directory, not a document";
  if (code === "ELOOP") return "that path is a symbolic link, which is not written through";
  if (code === "ENOENT") return "that document's folder does not exist";
  if (code === "EACCES" || code === "EPERM") return "the server may not access that document";
  return e instanceof Error ? e.message : String(e);
}

export async function GET(req: NextRequest) {
  const resolution = resolveDocPath(req.nextUrl.searchParams.get("doc"));
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.error }, { status: 403 });
  }
  const path = resolution.path;
  try {
    if (!existsSync(path)) {
      return NextResponse.json({ path, content: null, mtime: 0, exists: false });
    }
    if (statSync(path).isDirectory()) {
      return NextResponse.json({ error: reason({ code: "EISDIR" }) }, { status: 400 });
    }
    const content = readFileSync(path, "utf8");
    const mtime = statSync(path).mtimeMs;
    return NextResponse.json({ path, content, mtime, exists: true });
  } catch (e) {
    return NextResponse.json({ error: reason(e) }, { status: 400 });
  }
}

/**
 * Body: `{ content: string, mtime?: number }`. With `mtime` — the one the
 * writer read the document at — the write happens only if the file has not
 * changed since; otherwise 409 with the current mtime, and the writer reloads.
 * That is what keeps a page from writing back over an agent's edit it never saw.
 */
export async function PUT(req: NextRequest) {
  const resolution = resolveDocPath(req.nextUrl.searchParams.get("doc"));
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.error }, { status: 403 });
  }
  const path = resolution.path;
  let body: { content?: unknown; mtime?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { content: string }" }, { status: 400 });
  }
  if (typeof body?.content !== "string") {
    return NextResponse.json(
      { error: "Body must be { content: string }" },
      { status: 400 }
    );
  }
  try {
    const exists = existsSync(path);
    if (exists && statSync(path).isDirectory()) {
      return NextResponse.json({ error: reason({ code: "EISDIR" }) }, { status: 400 });
    }
    if (typeof body.mtime === "number") {
      const now = exists ? statSync(path).mtimeMs : 0;
      if (now !== body.mtime) {
        return NextResponse.json(
          { error: "the document changed on disk since it was read", mtime: now, conflict: true },
          { status: 409 }
        );
      }
    }
    writeDocFile(path, body.content);
    const mtime = statSync(path).mtimeMs;
    return NextResponse.json({ path, mtime, ok: true });
  } catch (e) {
    return NextResponse.json({ error: reason(e) }, { status: 400 });
  }
}
