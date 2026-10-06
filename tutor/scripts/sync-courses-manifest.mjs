#!/usr/bin/env node
// 清单补录:扫描 tutor/packs/*/pack.json,把尚未登记的教学包补进 courses-manifest.json。
// 用途:修复历史生成漏登记的包;不覆盖已有条目。
// 用法: node scripts/sync-courses-manifest.mjs
import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const PACKS = join(TUTOR, "packs");
const MANIFEST = join(SITE, "courses-manifest.json");

const m = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : { courses: [] };
const known = new Set((m.courses || []).map((c) => c.slug));
let added = 0;

for (const dir of readdirSync(PACKS)) {
  if (dir === "agent-dev") continue; // 主课程固定渲染,不入清单
  if (known.has(dir)) continue;
  const pj = join(PACKS, dir, "pack.json");
  if (!existsSync(pj)) continue;
  const pack = JSON.parse(readFileSync(pj, "utf8"));
  m.courses.push({
    kind: pack.generated ? "topic" : "repo",
    slug: dir,
    title: pack.title || dir,
    description: pack.description || "",
    pack: `packs/${dir}`,
    page: existsSync(join(SITE, `full-${dir}.html`)) ? `full-${dir}.html` : null,
    chapters: (pack.curriculum || []).map((c) => ({
      no: c.no, title: c.title, goal: c.goal, questions: c.questions || [],
    })),
    starterQuestions: pack.starterQuestions || [],
    generated: pack.generated === true,
    generatedAt: pack.updatedAt || new Date().toISOString(),
  });
  added++;
  console.log("✓ 补录:", dir, "-", pack.title || dir);
}
m.updatedAt = new Date().toISOString();
writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
console.log(`清单现有 ${m.courses.length} 门课程(本次补录 ${added})`);
