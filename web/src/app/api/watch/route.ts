import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync, watch } from "fs";
import { resolveDocPath } from "@/lib/projectFile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Same optional `?doc=` and the same allowlist as /api/file — the watch
  // stream follows whichever document the page asked for (step 2 of
  // chart_1785683010290). A refusal is a named 403, not a stream.
  const resolution = resolveDocPath(req.nextUrl.searchParams.get("doc"));
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.error }, { status: 403 });
  }
  const path = resolution.path;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const initialMtime = existsSync(path) ? statSync(path).mtimeMs : 0;
      send("hello", { path, mtime: initialMtime });

      let watcher: ReturnType<typeof watch> | null = null;
      try {
        watcher = watch(path, { persistent: false }, () => {
          if (!existsSync(path)) return;
          const mtime = statSync(path).mtimeMs;
          send("change", { path, mtime });
        });
      } catch {
        send("error", { message: `Cannot watch ${path}` });
      }

      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* stream closed */
        }
      }, 15000);

      const cleanup = () => {
        clearInterval(ping);
        watcher?.close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Closed by client → AbortController fires on the request
      // Next.js handles it via cancel() below
      (controller as unknown as { _cleanup?: () => void })._cleanup = cleanup;
    },
    cancel() {
      const c = this as unknown as { _cleanup?: () => void };
      c._cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
