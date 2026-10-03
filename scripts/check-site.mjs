#!/usr/bin/env node
// 站点静态检查(零依赖):node scripts/check-site.mjs
// 覆盖:标签平衡 / 内链与锚点完整性 / 进度口径一致 / 缓存版本一致 / target=_blank 安全
// 约定:章节页 = 根目录 [0-9]*-*.html 与 index/附录页;导航真源 = assets/js/app.js 的 NAV/CHAPTER_IDS
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const fail = (msg) => { console.log("✗ " + msg); failed++; };
const ok = (msg) => console.log("✓ " + msg);

const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const read = (f) => readFileSync(join(ROOT, f), "utf8");

/* ---------- 1. 标签平衡(按标签名计数,启发式) ---------- */
const BALANCE_TAGS = ["div", "details", "main", "aside", "section", "header", "footer",
  "table", "ul", "ol", "pre", "form", "nav", "button", "label", "a", "p", "li",
  "h1", "h2", "h3", "h4", "code", "span", "style", "script"];
let balanceIssues = [];
for (const f of pages) {
  const html = read(f);
  for (const tag of BALANCE_TAGS) {
    const open = (html.match(new RegExp(`<${tag}(?=[\\s>])`, "gi")) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    if (open !== close) balanceIssues.push(`${f}: <${tag}> 开 ${open} / 闭 ${close}`);
  }
}
if (balanceIssues.length) balanceIssues.forEach((m) => fail("标签不平衡 " + m));
else ok(`标签平衡:${pages.length} 个页面全部通过`);

/* ---------- 2. 内链与锚点完整性 ---------- */
const VOID_SRC = ["app.js", "style.css"]; // 无需存在性检查的动态引用已在别处校验
let linkIssues = [];
const anchorIndex = new Map(); // file -> Set(ids)
for (const f of pages) {
  const html = read(f);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  anchorIndex.set(f, ids);
}
for (const f of pages) {
  const html = read(f);
  const refs = [...html.matchAll(/\b(href|src)="([^"]+)"/g)].map((m) => m[2]);
  for (const ref of refs) {
    if (/^(https?:|mailto:|data:|javascript:)/.test(ref)) continue;
    const clean = ref.split("#");
    const pathPart = clean[0].split("?")[0]; // 去掉锚点与缓存版本查询串
    const anchor = clean[1];
    if (!pathPart) {
      // 纯锚点:本页必须有该 id
      if (anchor && !anchorIndex.get(f).has(anchor)) linkIssues.push(`${f}: 本页锚点 #${anchor} 无对应 id`);
      continue;
    }
    if (!existsSync(join(ROOT, pathPart))) { linkIssues.push(`${f}: 引用不存在的文件 ${pathPart}`); continue; }
    if (anchor && /\.html$/.test(pathPart) && anchorIndex.has(pathPart)) {
      if (!anchorIndex.get(pathPart).has(anchor)) linkIssues.push(`${f}: ${pathPart}#${anchor} 无对应 id`);
    }
  }
}
if (linkIssues.length) linkIssues.forEach((m) => fail("链接 " + m));
else ok("内链与锚点:全部可解析");

/* ---------- 3. 导航与进度口径 ---------- */
const appJs = read("assets/js/app.js");
const chapterIds = (appJs.match(/const CHAPTER_IDS = \[([^\]]*)\]/) || [])[1];
const chapterCount = chapterIds ? chapterIds.split(",").length : 0;
const navNoCount = (appJs.match(/\bno: "\d+"/g) || []).length;
if (!chapterIds || chapterCount === 0) fail("app.js 未找到 CHAPTER_IDS");
else if (chapterCount !== navNoCount) fail(`app.js 口径: CHAPTER_IDS(${chapterCount}) 与 NAV 章节条目(${navNoCount})数量不一致`);
else ok(`导航口径: ${chapterCount} 章(CHAPTER_IDS 与 NAV 一致)`);

const bodyChapters = pages
  .map((f) => (read(f).match(/<body data-chapter="([^"]+)"/) || [])[1])
  .filter(Boolean);
const declared = new Set(chapterIds ? chapterIds.match(/ch\d+/g) || [] : []);
const badChapters = bodyChapters.filter((c) => c.startsWith("ch") && !declared.has(c));
if (badChapters.length) fail(`data-chapter 未注册: ${badChapters.join(",")}`);
else ok("data-chapter 全部已注册");

const pills = new Set(pages.map((f) => (read(f).match(/进度 0\/(\d+) 章/) || [])[1]).filter(Boolean));
if (pills.size > 1) fail(`进度口径不一致: ${[...pills].join("/")} 章`);
else if (pills.size === 1 && [...pills][0] !== String(chapterCount)) fail(`进度兜底文案 ${[...pills][0]} 章 ≠ 章节数 ${chapterCount}`);
else ok(`进度兜底文案 = ${chapterCount} 章`);

const idx = read("index.html");
const idxCards = (idx.match(/class="tl-item" data-no="\d+"/g) || []).length;
if (idxCards !== chapterCount) fail(`index.html 章节卡片 ${idxCards} ≠ ${chapterCount}`);
else ok(`index.html 章节卡片 = ${chapterCount}`);

/* ---------- 4. 缓存版本一致 ---------- */
function singleVersion(file, label) {
  const vs = new Set(pages.map((f) => (read(f).match(new RegExp(`${file}\\?v=(\\d+)`)) || [])[1]).filter(Boolean));
  if (vs.size > 1) fail(`${label} 版本不一致: ${[...vs].join(",")}`);
  else ok(`${label} 版本统一 v=${[...vs][0] ?? "?"}`);
  return [...vs][0];
}
singleVersion("app.js", "app.js");
singleVersion("style.css", "style.css");
// lab 引用的文件必须存在,且引用版本一致
const labRefs = new Map();
for (const f of pages) {
  for (const m of read(f).matchAll(/lab-([a-z]+)\.js\?v=(\d+)/g)) {
    const key = m[1];
    if (!labRefs.has(key)) labRefs.set(key, new Set());
    labRefs.get(key).add(m[2]);
  }
}
for (const [lab, vs] of labRefs) {
  if (!existsSync(join(ROOT, "assets", "js", `lab-${lab}.js`))) fail(`引用了不存在的 lab-${lab}.js`);
  else if (vs.size > 1) fail(`lab-${lab}.js 版本不一致: ${[...vs].join(",")}`);
}
ok(`lab 引用一致性:${labRefs.size} 个实验室`);

/* ---------- 5. target=_blank 必须带 rel=noopener ---------- */
let unsafe = 0;
for (const f of pages) {
  const html = read(f);
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    if (!/rel="[^"]*noopener/.test(m[0])) { unsafe++; console.log(`  ⚠ ${f}: ${m[0].slice(0, 90)}`); }
  }
}
if (unsafe) fail(`target=_blank 缺 rel=noopener:${unsafe} 处`);
else ok("外链安全:target=_blank 均带 rel=noopener");

/* ---------- 结果 ---------- */
console.log(failed ? `\n${failed} 项失败` : "\n全部通过 ✓");
process.exit(failed ? 1 : 0);
