import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { getProjectFilePath } from "@/lib/projectFile";

export const dynamic = "force-dynamic";

interface SourceMeta {
  pdeId?: string;
  pdeFolder?: string;
  originalPrompt?: string;
}

interface Definition {
  settings: {
    namespace: string;
    name: string;
    asynchronous: boolean;
    _source?: SourceMeta;
  };
  events: Array<{ name: string; events: Array<{ id: string; description?: string }> }>;
  state: StateDef;
}

interface StateDef {
  name: string;
  kind?: string;
  description?: string;
  transitions?: Array<{ event: string; nextState?: string; condition?: string }>;
  states?: StateDef[];
}

interface PdeSource {
  prompt?: string;
  result?: {
    primary?: { action?: string; target?: string };
    directions?: { east?: Array<{ text: string }>; south?: Array<{ text: string }>; west?: Array<{ text: string }>; north?: Array<{ text: string }> };
    actionStack?: Array<{ text: string; direction?: string }>;
    ambiguities?: Array<{ text: string; suggestion?: string }>;
  };
}

function loadPde(filePath: string, def: Definition): PdeSource | null {
  const folder = def.settings._source?.pdeFolder;
  const id = def.settings._source?.pdeId;
  if (!folder || !id) return null;
  const root = resolve(filePath, "..");
  const candidates = [resolve(root, folder, `pde-${id}.json`), resolve(folder, `pde-${id}.json`)];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      /* try next */
    }
  }
  return null;
}

function collectAll(s: StateDef): StateDef[] {
  const out = [s];
  for (const c of s.states ?? []) out.push(...collectAll(c));
  return out;
}

function depth(s: StateDef, d = 0): number {
  if (!s.states?.length) return d;
  return Math.max(...s.states.map((c) => depth(c, d + 1)));
}

function countTransitions(s: StateDef): number {
  let n = s.transitions?.length ?? 0;
  for (const c of s.states ?? []) n += countTransitions(c);
  return n;
}

function collectTransitions(s: StateDef): Array<{ from: string; event: string; next?: string; condition?: string }> {
  const out: Array<{ from: string; event: string; next?: string; condition?: string }> = [];
  for (const t of s.transitions ?? []) out.push({ from: s.name, event: t.event, next: t.nextState, condition: t.condition });
  for (const c of s.states ?? []) out.push(...collectTransitions(c));
  return out;
}

function renderStateSpec(s: StateDef, lines: string[], depthLevel: number): void {
  const indent = "  ".repeat(depthLevel);
  const kind = s.kind && s.kind !== "normal" ? ` *(${s.kind})*` : "";
  lines.push(`${indent}- **${s.name}**${kind}${s.description ? ` — ${s.description}` : ""}`);
  for (const t of s.transitions ?? []) {
    lines.push(`${indent}  - on \`${t.event}\` ${t.nextState ? `→ \`${t.nextState}\`` : "(internal)"}`);
  }
  for (const c of s.states ?? []) renderStateSpec(c, lines, depthLevel + 1);
}

function glyph(d: string): string {
  return { South: "🔥", East: "🌅", North: "❄️", West: "🌊" }[d] ?? "•";
}

function generateRispec(def: Definition, pde: PdeSource | null, intent: string | null, projectFile: string): string {
  const lines: string[] = [];
  const states = def.state.states ?? [];
  const tagline = intent ?? pde?.result?.primary?.target ?? def.settings._source?.originalPrompt ?? `${def.settings.name} state machine`;

  lines.push(`# ${def.settings.name} — RISE rispec`);
  lines.push("");
  lines.push(`> ${tagline}`);
  lines.push("");
  lines.push(`**Namespace:** \`${def.settings.namespace}\` · **Async:** ${def.settings.asynchronous}`);
  if (def.settings._source?.pdeId) lines.push(`**Source PDE:** \`${def.settings._source.pdeId}\``);
  lines.push("");
  lines.push("---");
  lines.push("");

  const stateCount = collectAll(def.state).length - 1;
  const eventCount = def.events.flatMap((s) => s.events ?? []).length;
  lines.push("## R — Reverse Engineering");
  lines.push("");
  lines.push(`${def.settings.name} is modeled with ${stateCount} non-root states across ${depth(def.state)} level(s) of composition. Events: ${eventCount}. Transitions: ${countTransitions(def.state)}.`);
  lines.push("");
  if (pde?.prompt) {
    lines.push("Originating prompt:");
    lines.push("");
    lines.push(`> ${pde.prompt}`);
    lines.push("");
  }

  lines.push("## I — Intent");
  lines.push("");
  lines.push("**Desired Outcome**");
  lines.push("");
  lines.push(intent ?? pde?.result?.primary?.target ?? "_(no intent supplied)_");
  lines.push("");
  if (pde?.result?.directions?.east?.length) {
    lines.push("**Vision (🌅 East)**");
    lines.push("");
    for (const v of pde.result.directions.east) lines.push(`- ${v.text}`);
    lines.push("");
  }
  lines.push("**Structural Tension**");
  lines.push("");
  const hasFinal = collectAll(def.state).some((s) => s.kind === "final");
  lines.push(`- *Current:* ${def.settings.name} ${hasFinal ? "is designed; terminal state reachable in principle." : "is partially modeled; no terminal state declared."}`);
  lines.push(`- *Desired:* ${intent ?? pde?.result?.primary?.target ?? `${def.settings.name} runs end-to-end and reaches its terminal state.`}`);
  lines.push("");

  lines.push("## S — Specifications");
  lines.push("");
  lines.push("### States");
  lines.push("");
  for (const s of states) renderStateSpec(s, lines, 0);
  lines.push("");

  lines.push("### Events");
  lines.push("");
  for (const src of def.events) {
    if (!src.events?.length) continue;
    lines.push(`**${src.name}**`);
    for (const e of src.events) lines.push(`- \`${e.id}\`${e.description ? ` — ${e.description}` : ""}`);
    lines.push("");
  }

  lines.push("### Transitions (flat)");
  lines.push("");
  for (const t of collectTransitions(def.state)) {
    lines.push(`- \`${t.from}\` --[${t.event}]-- ${t.next ? `→ ${t.next}` : "→ (internal)"}${t.condition ? ` *(when: ${t.condition})*` : ""}`);
  }
  lines.push("");

  const mw = states.filter((s) => ["East", "South", "West", "North"].includes(s.name));
  if (mw.length) {
    lines.push("### Action Steps");
    lines.push("");
    for (const dirName of ["South", "East", "North", "West"]) {
      const dir = states.find((s) => s.name === dirName);
      if (!dir) continue;
      lines.push(`**${glyph(dirName)} ${dirName}** — ${dir.description ?? ""}`);
      for (const c of dir.states ?? []) lines.push(`1. ${c.description ?? c.name}`);
      lines.push("");
    }
  }

  if (pde?.result?.ambiguities?.length) {
    lines.push("### Open Questions");
    lines.push("");
    for (const a of pde.result.ambiguities) lines.push(`- ${a.text}${a.suggestion ? `  \n  → *${a.suggestion}*` : ""}`);
    lines.push("");
  }

  lines.push("## E — Exportation");
  lines.push("");
  lines.push("- Code: smcg / `generate_code` mcp tool (python | typescript)");
  lines.push(`- Visual: this file is bound to \`${projectFile}\` via SMCRAFT_PROJECT_FILE`);
  lines.push("- SMDF: the canonical JSON is the file above");
  lines.push("");

  return lines.join("\n");
}

export async function POST(req: Request) {
  const path = getProjectFilePath();
  if (!existsSync(path)) {
    return NextResponse.json({ error: `No file at ${path}` }, { status: 404 });
  }
  let intent: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.intent === "string") intent = body.intent;
  } catch {
    /* no body */
  }
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  const def: Definition = parsed.stateMachine ?? parsed.StateMachine ?? parsed;
  const pde = loadPde(path, def);
  const md = generateRispec(def, pde, intent, path);
  return NextResponse.json({ rispec: md, projectFile: path });
}
