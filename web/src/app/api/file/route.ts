import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { getProjectFilePath } from "@/lib/projectFile";

export const dynamic = "force-dynamic";

export async function GET() {
  const path = getProjectFilePath();
  if (!existsSync(path)) {
    return NextResponse.json({ path, content: null, mtime: 0, exists: false });
  }
  const content = readFileSync(path, "utf8");
  const mtime = statSync(path).mtimeMs;
  return NextResponse.json({ path, content, mtime, exists: true });
}

export async function PUT(req: Request) {
  const path = getProjectFilePath();
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
