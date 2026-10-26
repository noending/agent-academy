#!/usr/bin/env node
// 存量课题课程补「本章一图流」:解析旧页(quality-align 同一模板)→ 生成 flow → 重渲染正文 → 校验写回。
// 与新生成课程的差异只在时序:老页面用本脚本补齐,新课程由 make-course-from-topic 生而带图。
// 幂等:已有 flow-v1 标记的页跳过。用法:
//   node scripts/enrich-gen-course.mjs --skill <slug>   单门课程
//   node scripts/enrich-gen-course.mjs --all            manifest 里全部课题课程
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { readManifest } from "./factory-common.mjs";
import { parseChapterBody, chapterPageBody, generateFlow } from "./quality-align.mjs";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = getModel("deepseek", "deepseek-v4-flash");

const args = process.argv.slice(2);
const slug = args.includes("--all") ? null : args[args.indexOf("--skill") + 1];
if (!slug && !args.includes("--all")) { console.error("✗ --skill <slug> 或 --all 二选一"); process.exit(1); }
if (!KEY) { console.error("✗ 缺少 DEEPSEEK_API_KEY"); process.exit(1); }

async function callLLM(system, user, maxTokens) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await completeSimple(MODEL, {
        systemPrompt: system,
        messages: [{ role: "user", content: user, timestamp: Date.now() }],
      }, { apiKey: KEY, maxTokens, temperature: 0 });
      const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
      if (!text) throw new Error("空输出");
      return text;
    } catch (e) { if (attempt === 2) throw e; }
  }
}

// 标签平衡粗检(与 align-course-quality 同目的:写坏页面前最后一道闸)
function balanceIssue(html) {
  const opens = (html.match(/<div[\s>]/g) || []).length;
  const closes = (html.match(/<\/div>/g) || []).length;
  return opens === closes ? null : `div ${opens}/${closes}`;
}

const manifest = readManifest();
const courses = (manifest.courses || []).filter((c) => c.kind === "topic" && (c.chapters || []).length && (!slug || c.slug === slug));
if (!courses.length) { console.error(`✗ 找不到可处理的课题课程(${slug || "any"})`); process.exit(1); }

let total = 0, added = 0, skipped = 0, failed = 0;
for (const course of courses) {
  console.log(`\n── ${course.slug}(${(course.chapters || []).length} 章) ──`);
  for (const ch of course.chapters) {
    const file = join(SITE, ch.file);
    total++;
    if (!existsSync(file)) { console.log(`  ✗ ${ch.file} 不存在`); failed++; continue; }
    const html = readFileSync(file, "utf8");
    if (html.includes("<!--flow-v1-->")) { console.log(`  · 第${ch.no}章 已有一图流,跳过`); skipped++; continue; }
    const hStart = html.indexOf('<header class="chapter-head">');
    const tailAnchor = "    </div>\n  </main>";
    const tIdx = html.indexOf(tailAnchor);
    if (hStart < 0 || tIdx < 0) { console.log(`  ✗ 第${ch.no}章 非标准章节模板,跳过`); failed++; continue; }
    let res;
    try {
      res = parseChapterBody(html.slice(hStart, tIdx));
    } catch (e) { console.log(`  ✗ 第${ch.no}章 解析失败(${e.message})`); failed++; continue; }
    const flow = await generateFlow({ callLLM, ch: { no: ch.no, title: ch.title, goal: ch.goal || "", outline: ch.outline || [] } });
    if (!flow) { console.log(`  ✗ 第${ch.no}章 一图流生成失败`); failed++; continue; }
    res.flow = flow;
    const nextBody = chapterPageBody({ ch: { no: ch.no, title: ch.title, goal: ch.goal || "" }, res }).replace(/^\n/, "");
    const nextHtml = html.slice(0, hStart) + nextBody + "\n" + html.slice(tIdx);
    const bad = balanceIssue(nextHtml); // 全文平衡(align 同口径;局部切片会把 content-inner 的闭合算成多余)
    if (bad) { console.log(`  ✗ 第${ch.no}章 重渲染后标签不平衡(${bad}),保留原稿`); failed++; continue; }
    writeFileSync(file, nextHtml);
    added++;
    console.log(`  ✓ 第${ch.no}章 +${flow.nodes.length} 节点一图流`);
  }
}
console.log(`\n✓ 完成:处理 ${total} 章 · 补图 ${added} · 已有跳过 ${skipped} · 失败 ${failed}`);
if (failed) process.exit(1);
