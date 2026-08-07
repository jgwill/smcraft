import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { resolveDocPath } from "@/lib/projectFile";

export const dynamic = "force-dynamic";

// Optional `?doc=<absolute .json path>` selects the document; omitted, the
// default project file answers exactly as before. Every doc passes the root
// allowlist in lib/projectFile.ts — parameter and guard are one surface
// (chart chart_1785683022927). A refusal names its reason and is a 403,
// never a write.

export async function GET(req: NextRequest) {
  const resolution = resolveDocPath(req.nextUrl.searchParams.get("doc"));
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.error }, { status: 403 });
  }
  const path = resolution.path;
  if (!existsSync(path)) {
    return NextResponse.json({ path, content: null, mtime: 0, exists: false });
  }
  const content = readFileSync(path, "utf8");
  const mtime = statSync(path).mtimeMs;
  return NextResponse.json({ path, content, mtime, exists: true });
}

export async function PUT(req: NextRequest) {
  const resolution = resolveDocPath(req.nextUrl.searchParams.get("doc"));
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.error }, { status: 403 });
  }
  const path = resolution.path;
  const body = await req.json();
  if (typeof body?.content !== "string") {
    return NextResponse.json(
      { error: "Body must be { content: string }" },
      { status: 400 }
    );
  }
  writeFileSync(path, body.content, "utf8");
  const mtime = statSync(path).mtimeMs;
  return NextResponse.json({ path, mtime, ok: true });
}
