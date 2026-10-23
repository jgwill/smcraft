/**
 * /api/marks — a drawing's marks (Spec 83), kept beside it in its sidecar
 * (`wave.smdf.json` → `wave.smdf.marks.json`).
 *
 * GET  `?doc=<drawing>` → `{ doc, path, marks }`. No sidecar yet reads as no marks.
 * POST `?doc=<drawing>` with one change:
 *   `{ action: "add", mark: { elements?, region?, level?, text, kind?, author } }`
 *   `{ action: "reply", id, text, author }`
 *   `{ action: "resolve" | "reopen" | "remove", id }`
 *   → `{ doc, path, marks, change: { action, id } }`
 *
 * The drawing passes the same root allowlist as the file API, and so does the
 * sidecar itself — it sits in the same folder, so whatever admits the drawing
 * admits its marks, and a symlink placed at the sidecar is refused the same
 * way. The page tells the hub after the write (durable first, as every edit).
 */
import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";
import {
  addMark,
  marksPathOf,
  readMarksFile,
  removeMark,
  reopenMark,
  replyToMark,
  resolveMark,
  type MarkAuthor,
  type MarkInput,
  type MarksChange,
  type MarksFile,
} from "@miadi/stateloom-protocol";
import { getProjectFilePath, resolveDocPath, writeDocFile } from "@/lib/projectFile";

export const dynamic = "force-dynamic";

type Resolved = { ok: true; doc: string; path: string } | { ok: false; error: string };

function resolveMarks(doc: string | null): Resolved {
  const drawing = resolveDocPath(doc ?? getProjectFilePath());
  if (!drawing.ok) return { ok: false, error: drawing.error };
  const sidecar = resolveDocPath(marksPathOf(drawing.path));
  if (!sidecar.ok) return { ok: false, error: sidecar.error };
  return { ok: true, doc: drawing.path, path: sidecar.path };
}

function read(r: { doc: string; path: string }): MarksFile {
  if (!existsSync(r.path)) return { doc: basename(r.doc), marks: [] };
  try {
    return readMarksFile(JSON.parse(readFileSync(r.path, "utf8")), basename(r.doc));
  } catch {
    // A sidecar that does not parse is not overwritten by a reader: it reads as
    // empty, and the next write says so instead of replacing it silently.
    return { doc: basename(r.doc), marks: [] };
  }
}

const unreadable = (path: string): boolean => {
  if (!existsSync(path)) return false;
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return false;
  } catch {
    return true;
  }
};

function author(v: unknown): MarkAuthor {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 80) : "someone";
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim().slice(0, 80) : name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  // A page speaks for a person. An agent writes through MCP or the CLI.
  return { id, name, role: "person" };
}

export async function GET(req: NextRequest) {
  const r = resolveMarks(req.nextUrl.searchParams.get("doc"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 403 });
  return NextResponse.json({ doc: r.doc, path: r.path, marks: read(r).marks }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const r = resolveMarks(req.nextUrl.searchParams.get("doc"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { action, ... }" }, { status: 400 });
  }
  if (unreadable(r.path)) {
    return NextResponse.json({ error: `${r.path} is not readable JSON; fix or move it before marking again` }, { status: 409 });
  }
  const at = new Date().toISOString();
  const file = read(r);
  const id = typeof body.id === "string" ? body.id : "";
  let next: MarksFile;
  let change: { action: MarksChange; id: string };
  try {
    switch (body.action) {
      case "add": {
        const m = (body.mark && typeof body.mark === "object" ? body.mark : {}) as Partial<MarkInput>;
        next = addMark(
          file,
          {
            text: typeof m.text === "string" ? m.text.slice(0, 4000) : "",
            kind: m.kind,
            elements: Array.isArray(m.elements) ? m.elements.filter((e): e is string => typeof e === "string").slice(0, 50) : undefined,
            region: m.region,
            level: typeof m.level === "string" ? m.level : undefined,
            author: author(m.author),
          },
          at,
        );
        change = { action: "add", id: next.marks[next.marks.length - 1].id };
        break;
      }
      case "reply":
        next = replyToMark(file, id, { author: author(body.author), text: typeof body.text === "string" ? body.text.slice(0, 4000) : "" }, at);
        change = { action: "reply", id };
        break;
      case "resolve":
        next = resolveMark(file, id);
        change = { action: "resolve", id };
        break;
      case "reopen":
        next = reopenMark(file, id);
        change = { action: "reopen", id };
        break;
      case "remove":
        next = removeMark(file, id);
        change = { action: "remove", id };
        break;
      default:
        return NextResponse.json({ error: "action is one of add, reply, resolve, reopen, remove" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  try {
    writeDocFile(r.path, JSON.stringify(next, null, 2) + "\n");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  return NextResponse.json({ doc: r.doc, path: r.path, marks: next.marks, change });
}
