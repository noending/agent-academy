#!/usr/bin/env node
// 存量课题课程质量对齐:逐章 解析旧页 → 按旗舰基准 LLM 升级 → 重写页面(结构校验不过自动保留原稿)。
// 用法:
//   node scripts/align-course-quality.mjs --course llm-deploy   对齐单门课
//   node scripts/align-course-quality.mjs --all                 对齐全部课题课程
//   加 --dry 只做结构体检不调用 LLM、不改文件
// 对齐后建议: node scripts/check-course-quality.mjs 复查 + node scripts/check-site.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { readManifest } from "./factory-common.mjs";
import { chapterPageBody, parseChapterBody, structureIssues, upgradeChapter } from "./quality-align.mjs";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const MODEL = getModel("deepseek", "deepseek-v4-flash");
const KEY = process.env.DEEPSEEK_API_KEY;

const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry");
const COURSE = argOf("--course");

if (!DRY && !KEY) { console.error("✗ 缺少 DEEPSEEK_API_KEY(--dry 可离线体检)"); process.exit(1); }

async function llm(system, user, maxTokens = 4000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await completeSimple(MODEL, {
        systemPrompt: system,
        messages: [{ role: "user", content: user, timestamp: Date.now() }],
      }, { apiKey: KEY, maxTokens, temperature: 0 });
      const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
      if (!text) throw new Error("空输出");
      return text;
    } catch (e) {
      if (attempt === 2) throw e;
      console.log(`  (重试: ${e.message})`);
    }
  }
}
async function pool(items, worker, n = 3) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx]); }
  }));
}
// 与 check-site 同思路的标签平衡快检:重写页不过检就保留原稿,防 LLM 输出破坏结构
const BALANCE_TAGS = ["div", "details", "main", "aside", "section", "header", "footer",
  "table", "ul", "ol", "pre", "nav", "button", "a", "p", "li", "h1", "h2", "h3", "h4", "code", "span"];
function balanceIssue(html) {
  for (const tag of BALANCE_TAGS) {
    const open = (html.match(new RegExp(`<${tag}(?=[\\s>])`, "gi")) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    if (open !== close) return `<${tag}> 开 ${open} / 闭 ${close}`;
  }
  return null;
}

const manifest = readManifest();
let courses = (manifest.courses || []).filter((c) => c.kind === "topic" && c.page && (c.chapters || []).length);
if (COURSE) courses = courses.filter((c) => c.slug === COURSE);
if (!courses.length) { console.error("✗ 没有匹配的课题课程(manifest 无 kind=topic 且有分章页的条目)"); process.exit(1); }

const totals = { chapters: 0, ok: 0, changed: 0, kept: 0, failed: 0 };
const courseSummary = [];

for (const course of courses) {
  console.log(`\n=== ${course.slug} · ${course.title}(${course.chapters.length} 章) ===`);
  const rows = [];
  await pool(course.chapters, async (chMeta) => {
    const file = join(SITE, chMeta.file);
    if (!existsSync(file)) { console.log(`  ✗ 第${chMeta.no}章 ${chMeta.file} 不存在`); totals.failed++; rows.push({ no: chMeta.no, state: "missing" }); return; }
    const html = readFileSync(file, "utf8");
    let res;
    try { res = parseChapterBody(html); }
    catch (e) { console.log(`  ✗ 第${chMeta.no}章 模板解析失败: ${e.message}`); totals.failed++; rows.push({ no: chMeta.no, state: "parse-fail" }); return; }

    const before = structureIssues(res);
    if (DRY) {
      console.log(`  ○ 第${chMeta.no}章 ${before.length ? "(" + before.length + ") " + before.join("; ") : "结构达标"}`);
      totals.chapters++;
      if (!before.length) totals.ok++;
      rows.push({ no: chMeta.no, before: before.length, issues: before });
      return;
    }
    if (!before.length) { console.log(`  ✓ 第${chMeta.no}章 已达标,跳过`); totals.chapters++; totals.ok++; rows.push({ no: chMeta.no, before: 0, after: 0, state: "skip" }); return; }

    const up = await upgradeChapter(llm, {
      courseTitle: course.title,
      ch: { no: chMeta.no, title: chMeta.title, goal: chMeta.goal || "", outline: [] },
      res,
    });
    if (!up.changed) { console.log(`  – 第${chMeta.no}章 保留初稿(${up.note})`); totals.kept++; rows.push({ no: chMeta.no, before: up.before.length, after: up.after.length, state: "kept" }); return; }

    // 锚点=从 <header 到「content-inner 闭合 + </main>」,保住外层 div 的闭合标签
    const hStart = html.indexOf('<header class="chapter-head">');
    const tailAnchor = "    </div>\n  </main>";
    const tIdx = html.indexOf(tailAnchor);
    if (hStart < 0 || tIdx < 0) { console.log(`  ✗ 第${chMeta.no}章 页面缺少标准锚点,保留原稿`); totals.failed++; return; }
    const nextHtml = html.slice(0, hStart) + chapterPageBody({ ch: { no: chMeta.no, title: chMeta.title, goal: chMeta.goal || "" }, res: up.res }).replace(/^\n/, "") + "\n" + html.slice(tIdx);
    const bad = balanceIssue(nextHtml);
    if (bad) { console.log(`  ✗ 第${chMeta.no}章 重写后标签不平衡(${bad}),保留原稿`); totals.failed++; rows.push({ no: chMeta.no, before: up.before.length, state: "unbalanced" }); return; }
    writeFileSync(file, nextHtml);
    console.log(`  ↻ 第${chMeta.no}章 ${up.before.length}→${up.after.length} 处结构问题${up.after.length ? "(余: " + up.after.join("; ") + ")" : "已清零"}`);
    totals.changed++;
    rows.push({ no: chMeta.no, before: up.before.length, after: up.after.length, state: "changed" });
  }, 3);
  courseSummary.push({ slug: course.slug, title: course.title, rows });
}

// 追加对齐记录到各课 REVIEW.md(人审可见)
if (!DRY) {
  for (const cs of courseSummary) {
    const changed = cs.rows.filter((r) => r.state === "changed").length;
    if (!changed) continue;
    const reviewPath = join(TUTOR, "packs", cs.slug, "REVIEW.md");
    if (!existsSync(reviewPath)) continue;
    const lines = cs.rows.map((r) => `- 第${r.no}章: ${r.state === "changed" ? `结构问题 ${r.before}→${r.after}` : r.state === "skip" ? "已达标" : r.state}`).join("\n");
    writeFileSync(reviewPath, readFileSync(reviewPath, "utf8").replace(/\n*$/, "\n") +
      `\n## 质量对齐记录(${new Date().toISOString().slice(0, 10)})\n\n机器对齐 pass 已跑(${changed}/${cs.rows.length} 章被升级,升级≠事实核实):\n${lines}\n- [ ] 仍需人工核实事实与代码\n`);
  }
}

console.log(`\n========== 对齐${DRY ? "体检" : "完成"} ==========`);
for (const cs of courseSummary) {
  const n = cs.rows.length;
  const clean = cs.rows.filter((r) => (r.after ?? r.before ?? 1) === 0).length;
  console.log(`${cs.slug}: ${clean}/${n} 章结构达标`);
}
console.log(DRY
  ? `章节 ${totals.chapters}(--dry 未改动任何文件;去掉 --dry 执行真实对齐)`
  : `升级 ${totals.changed} · 已达标跳过 ${totals.ok} · 保留初稿 ${totals.kept} · 失败 ${totals.failed}\n复查: node scripts/check-course-quality.mjs && node scripts/check-site.mjs`);
