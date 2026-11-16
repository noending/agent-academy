#!/usr/bin/env node
// 发布课程:移除机器初稿标记与草稿工具条(课程首页 + 全部分章页),标记清单为已审定。
// 用法: node scripts/publish-course.mjs --skill <slug>
// 质量门禁: 全部分章页结构达标才允许发布;未达标会被拦下(--force 可跳过)。
//          node scripts/publish-course.mjs --skill <slug> --check-only  只体检不发布
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { updateManifest, readManifest } from "./factory-common.mjs";
import { parseChapterBody, structureIssues, gateChapters } from "./quality-align.mjs";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const args = process.argv.slice(2);
const skill = args[args.indexOf("--skill") + 1];
const CHECK_ONLY = args.includes("--check-only");
const FORCE = args.includes("--force");

if (!skill || skill === "agent-dev") { console.error("✗ --skill 必填且不可为 agent-dev"); process.exit(1); }

// 页面集合: 课程首页 + manifest 登记的分章页 + 目录中的分章页(防漏)
let pages = new Set();
const home = join(SITE, `full-${skill}.html`);
if (existsSync(home)) pages.add(home);
try {
  const m = readManifest();
  const entry = (m.courses || []).find((c) => c.slug === skill);
  if (entry?.page) pages.add(join(SITE, entry.page));
  for (const ch of entry?.chapters || []) if (ch.file) pages.add(join(SITE, ch.file));
} catch {}
const chRe = new RegExp("^" + skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-ch\\d+\\.html$");
for (const f of readdirSync(SITE)) {
  if (chRe.test(f)) pages.add(join(SITE, f));
}
if (!pages.size) { console.error(`✗ 找不到课程页面(full-${skill}.html)`); process.exit(1); }

// ---------- 质量门禁(结构 rubric 见 quality-align.mjs) ----------
const chapterPages = [...pages].filter((p) => /-ch\d+\.html$/.test(p));
const gateItems = chapterPages.map((p) => {
  const no = (basename(p).match(/-ch(\d+)\.html$/) || [])[1] || "?";
  try {
    const html = readFileSync(p, "utf8");
    const body = (html.match(/<div class="content-inner">([\s\S]*?)<\/main>/) || [])[1] || "";
    return { no, title: basename(p), issues: structureIssues(parseChapterBody(body)) };
  } catch (e) {
    return { no, title: basename(p), issues: ["页面解析失败: " + e.message] };
  }
});
const gate = gateChapters(gateItems);

if (CHECK_ONLY) {
  console.log(`质量体检 · ${skill}: ${gate.clean}/${gate.total} 章达标`);
  for (const f of gate.failing) console.log(`  第${f.no}章: ${f.issues.join("; ")}`);
  console.log(gate.pass ? "✓ 门禁通过,可发布" : "✗ 门禁未过——先跑 node tutor/scripts/align-course-quality.mjs --course " + skill);
  process.exit(gate.pass ? 0 : 1);
}
if (!gate.pass && !FORCE) {
  console.error(`✗ 质量门禁未过(${gate.clean}/${gate.total} 章达标)——未发布、未改动任何文件:`);
  for (const f of gate.failing) console.error(`  第${f.no}章: ${f.issues.join("; ")}`);
  console.error(`  先对齐: node tutor/scripts/align-course-quality.mjs --course ${skill}`);
  console.error(`  复检:   node tutor/scripts/publish-course.mjs --skill ${skill} --check-only`);
  console.error(`  确有理由强行发布(如纯展示用途): 加 --force`);
  process.exit(1);
}
console.log(`✓ 质量门禁通过(${gate.clean}/${gate.total} 章达标)${FORCE ? "(--force 跳过)" : ""}`);

let total = 0;
for (const p of pages) {
  let html = readFileSync(p, "utf8");
  const before = html.length;
  html = html.replace(/<div class="draft-only">[\s\S]*?<\/div>\s*<\/div>\s*/g, "");
  html = html.replace(/<span style="color:var\(--warn\)">\(机器初稿\)<\/span>/g, "");
  html = html.replace(/课题生成课程 · 机器初稿 · 未审勿发布/g, "课题生成课程 · 已审核发布");
  html = html.replace(/CHAPTER (\d{2}) · 机器初稿 · 待人审/g, "CHAPTER $1 · 已审核发布");
  html = html.replace(/机器初稿,未经人工审校/g, "已人工审核");
  html = html.replace(/<b style="color:var\(--warn\)">本课程由内容工厂按课题自动生成[^<]*<\/b>/g, "");
  html = html.replace(/(机器初稿)/g, "");
  html = html.replace(/<div class="draft-only">\s*<\/div>\s*/g, "");
  if (html.length !== before) { writeFileSync(p, html); total++; console.log("✓ 已发布", p); }
  else console.log("· 无需变更", p);
}
updateManifest({ slug: skill, approved: true, published: true });
console.log(`✓ ${skill} 已发布(${total} 页更新;清单标记已审定)`);
