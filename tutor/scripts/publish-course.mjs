#!/usr/bin/env node
// 发布课程:移除机器初稿标记与草稿工具条,标记清单为已审定。
// 用法: node scripts/publish-course.mjs --skill <slug>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { updateManifest } from "./factory-common.mjs";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const args = process.argv.slice(2);
const skill = args[args.indexOf("--skill") + 1];

if (!skill || skill === "agent-dev") { console.error("✗ --skill 必填且不可为 agent-dev"); process.exit(1); }
const page = join(SITE, `full-${skill}.html`);
if (!existsSync(page)) { console.error(`✗ 页面不存在: ${page}`); process.exit(1); }

let html = readFileSync(page, "utf8");
const before = html.length;

// 1) 移除草稿工具条与人审须知(draft-only 包裹块)
html = html.replace(/<div class="draft-only">[\s\S]*?<\/div>\s*<\/div>\s*/g, "");

// 2) 移除初稿标记
html = html.replace(/<span style="color:var\(--warn\)">\(机器初稿\)<\/span>/g, "");
html = html.replace(/课题生成课程 · 机器初稿 · 未审勿发布/g, "课题生成课程 · 已审核发布");
html = html.replace(/机器初稿,未经人工审校/g, "已人工审核");
html = html.replace(/(\n *)?<b style="color:var\(--warn\)">本课程由内容工厂按课题自动生成[^<]*<\/b>/g, "");

// 3) 标题里的初稿字样兜底
html = html.replace(/(机器初稿)/g, "");

// 4) 移除可能残留的空 draft-only
html = html.replace(/<div class="draft-only">\s*<\/div>\s*/g, "");

writeFileSync(page, html);
updateManifest({ slug: skill, approved: true, published: true });
console.log(`✓ ${skill} 已发布(移除初稿标记 ${(before - html.length)} 字符;清单标记已审定)`);
console.log("  建议仍按 REVIEW.md 完成事实核对的记录留档。");
