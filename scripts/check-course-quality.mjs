#!/usr/bin/env node
// 课程质量报告(零依赖):主课基线 vs 全部课题课程,逐章结构体检。
//   node scripts/check-course-quality.mjs
// 输出:控制台对比表 + drafts/evals/course-quality-REPORT.md
// 结构 rubric 与对齐工具共用 tutor/scripts/quality-align.mjs(纯函数,无 LLM 调用)。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "../tutor/scripts/factory-common.mjs";
import { parseChapterBody, structureIssues } from "../tutor/scripts/quality-align.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const strip = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, "").length;

// 主课基线章节 = app.js NAV 中 cat 为 main 的 10 章
const appJs = readFileSync(join(ROOT, "assets", "js", "app.js"), "utf8");
const mainFiles = [...appJs.matchAll(/\{ id: "ch\d+", file: "([^"]+)", no: "\d+"/g)].map((m) => m[1]);
const manifest = readManifest();
const genCourses = (manifest.courses || []).filter((c) => c.kind === "topic" && c.page && (c.chapters || []).length);

function metrics(file) {
  const html = readFileSync(join(ROOT, file), "utf8");
  const m = html.match(/<div class="content-inner">([\s\S]*?)<\/main>/);
  const body = m ? m[1] : html;
  return {
    text: strip(body),
    h3: (body.match(/<h3>/g) || []).length,
    code: (body.match(/<div class="codeblock">/g) || []).length,
    quiz: (body.match(/<details class="quiz">/g) || []).length,
    fold: (body.match(/<details class="fold">/g) || []).length,
  };
}

const courses = [{ slug: "从零开发智能体(基线)", kind: "main", chapters: mainFiles.map((f, i) => ({ no: i + 1, file: f })) }]
  .concat(genCourses.map((c) => ({ slug: c.slug, title: c.title, kind: "topic", chapters: c.chapters })));

const rows = [];
for (const course of courses) {
  const per = [];
  for (const ch of course.chapters) {
    if (!existsSync(join(ROOT, ch.file))) { per.push({ no: ch.no, file: ch.file, missing: true }); continue; }
    const met = metrics(ch.file);
    let issues = [];
    if (course.kind === "topic") {
      try { issues = structureIssues(parseChapterBody(readFileSync(join(ROOT, ch.file), "utf8").match(/<div class="content-inner">([\s\S]*?)<\/main>/)?.[1] || "")); }
      catch (e) { issues = ["模板解析失败: " + e.message]; }
    }
    per.push({ no: ch.no, file: ch.file, ...met, issues });
  }
  const okCh = per.filter((p) => !p.missing);
  rows.push({
    slug: course.slug, kind: course.kind, title: course.title,
    chapters: per.length,
    avgText: Math.round(okCh.reduce((a, p) => a + p.text, 0) / (okCh.length || 1)),
    avgCode: (okCh.reduce((a, p) => a + p.code, 0) / (okCh.length || 1)).toFixed(1),
    avgQuiz: (okCh.reduce((a, p) => a + p.quiz, 0) / (okCh.length || 1)).toFixed(1),
    avgFold: (okCh.reduce((a, p) => a + p.fold, 0) / (okCh.length || 1)).toFixed(1),
    clean: per.filter((p) => p.issues && p.issues.length === 0).length,
    per,
  });
}

// ---------- 控制台 ----------
const base = rows[0];
const fmt = (r) =>
  `${r.slug.padEnd(18)} ${String(r.chapters).padStart(2)}章  平均字数${String(r.avgText).padStart(5)}  代码块${String(r.avgCode).padStart(4)}/章  自测${String(r.avgQuiz).padStart(4)}  练习${r.avgFold}  ` +
  (r.kind === "main" ? "(基线)" : `结构达标 ${r.clean}/${r.chapters}`);
console.log("课程质量对比(主课为基线,结构达标=零 rubric 问题):\n");
rows.forEach((r) => console.log(fmt(r)));

console.log("\n课题课程未达标章节明细:");
for (const r of rows.slice(1)) {
  const bad = r.per.filter((p) => p.issues && p.issues.length);
  if (!bad.length) { console.log(`  ${r.slug}: 全部达标 ✓`); continue; }
  console.log(`  ${r.slug}:`);
  for (const p of bad) console.log(`    第${p.no}章(${p.file}): ${p.issues.join("; ")}`);
}

// ---------- Markdown 报告 ----------
const genDate = new Date().toISOString().slice(0, 16).replace("T", " ");
let md = `# 课程质量报告 · ${genDate}

结构 rubric 与对齐工具见 \`tutor/scripts/quality-align.mjs\`;对齐执行 \`node tutor/scripts/align-course-quality.mjs --all\`。

| 课程 | 章 | 平均正文字数 | 代码块/章 | 自测/章 | 练习/章 | 结构达标 |
|---|---|---|---|---|---|---|
`;
for (const r of rows) {
  md += `| ${r.slug}${r.kind === "main" ? "(基线)" : ""} | ${r.chapters} | ${r.avgText} | ${r.avgCode} | ${r.avgQuiz} | ${r.avgFold} | ${r.kind === "main" ? "—" : `${r.clean}/${r.chapters}`} |\n`;
}
md += "\n## 未达标明细\n\n";
for (const r of rows.slice(1)) {
  const bad = r.per.filter((p) => p.issues && p.issues.length);
  md += `### ${r.slug}\n\n`;
  if (!bad.length) { md += "全部达标 ✓\n\n"; continue; }
  for (const p of bad) md += `- 第${p.no}章(${p.file}): ${p.issues.join("; ")}\n`;
  md += "\n";
}
mkdirSync(join(ROOT, "drafts", "evals"), { recursive: true });
writeFileSync(join(ROOT, "drafts", "evals", "course-quality-REPORT.md"), md);
console.log("\n报告已写入 drafts/evals/course-quality-REPORT.md");
// 退出码:任一课题课未 100% 达标 → 1(可用于 CI/发布前脚本化检查)
const anyFail = rows.slice(1).some((r) => r.clean < r.chapters);
if (anyFail) { console.log("✗ 存在未达标课程(见上)——对齐: node tutor/scripts/align-course-quality.mjs --all"); process.exitCode = 1; }
