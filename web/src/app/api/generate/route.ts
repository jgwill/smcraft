import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export async function POST(request: NextRequest) {
  try {
    const { definition, language } = await request.json();
    const lang = language === "typescript" ? "typescript" : "python";

    // Parse the definition (may be wrapped in { stateMachine: ... })
    const parsed = typeof definition === "string" ? JSON.parse(definition) : definition;
    const def = parsed.stateMachine ?? parsed.StateMachine ?? parsed;
    // Ensure settings has required fields for smcg CLI
    if (!def.settings) def.settings = {};
    if (!def.settings.name) def.settings.name = def.state?.name ?? "machine";
    if (!def.settings.namespace) def.settings.namespace = def.settings.name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const name = def.settings.name;

    const tmpDir = mkdtempSync(join(tmpdir(), "smcraft-web-"));
    const inputFile = join(tmpDir, `${name}.smdf.json`);
    const outputDir = join(tmpDir, "output");

    try {
      writeFileSync(inputFile, JSON.stringify(def, null, 2));
      execSync(`smcg "${inputFile}" -l ${lang} -o "${outputDir}"`, {
        encoding: "utf-8",
        timeout: 30000,
      });

      const ext = lang === "python" ? "py" : "ts";
      // smcg outputs snake_case filenames (e.g. TestMachine -> test_machine_fsm.py)
      const snakeName = name.replace(/([A-Z])/g, (m: string, p1: string, offset: number) => (offset ? "_" : "") + p1.toLowerCase()).replace(/[^a-z0-9_]/g, "_");
      const outputFile = join(outputDir, `${snakeName}_fsm.${ext}`);
      const code = readFileSync(outputFile, "utf-8");

      return NextResponse.json({ code, language: lang });
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message ?? "Code generation failed" },
      { status: 500 }
    );
  }
}
