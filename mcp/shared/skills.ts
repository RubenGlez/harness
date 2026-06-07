import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface Skill {
  id: string;
  name: string;
  description: string;
  stageOrder: number | null;
}

function parseFrontmatter(file: string): Record<string, string> {
  const text = readFileSync(file, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadSkills(skillsDir: string): Skill[] {
  const skills: Skill[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const md = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(md)) continue;
    const fm = parseFrontmatter(md);
    const stageOrder = fm.stage_order ? Number.parseInt(fm.stage_order, 10) : null;
    skills.push({
      id: entry.name,
      name: fm.name || entry.name,
      description: fm.description || "",
      stageOrder: Number.isFinite(stageOrder) ? stageOrder : null,
    });
  }
  return skills.sort((a, b) => {
    if (a.stageOrder !== null && b.stageOrder !== null) return a.stageOrder - b.stageOrder;
    if (a.stageOrder !== null) return -1;
    if (b.stageOrder !== null) return 1;
    return a.id.localeCompare(b.id);
  });
}

export function pipelineStages(skillsDir: string): string[] {
  return loadSkills(skillsDir)
    .filter((s) => s.stageOrder !== null)
    .map((s) => s.id);
}
