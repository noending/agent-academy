#!/usr/bin/env node
// 存量迁移:把旧版单页生成课程(full-<skill>.html,全部章节堆一页)
// 拆成分章分页(<skill>-ch<NN>.html)+ 课程首页,接入生成课程运行时
// (侧栏/页脚/按章进度)。内容原样保留,不调用 LLM。
// 用法: node scripts/migrate-course-pages.mjs --skill <slug>
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { updateManifest, readManifest } from "./factory-common.mjs";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const args = process.argv.slice(2);
const skill = args[args.indexOf("--skill") + 1];

if (!skill || skill === "agent-dev") { console.error("✗ --skill 必填且不可为 agent-dev"); process.exit(1); }
const packPath = join(TUTOR, "packs", skill, "pack.json");
if (!existsSync(packPath)) { console.error(`✗ 教学包不存在: ${packPath}`); process.exit(1); }
const pack = JSON.parse(readFileSync(packPath, "utf8"));

const page = join(SITE, `full-${skill}.html`);
if (!existsSync(page)) { console.error(`✗ 单页课程不存在: ${page}`); process.exit(1); }
let html = readFileSync(page, "utf8");
if (html.includes("data-gen-course") && !args.includes("--force")) { console.log("已是分章格式,跳过(--force 可强制重切)"); process.exit(0); }

// 分章:按「<h2>第N章 · 标题</h2>」切块
const marks = [...html.matchAll(/<h2>第(\d+)章 · ([^<]+)<\/h2>/g)];
if (marks.length < 2) { console.error(`✗ 只识别到 ${marks.length} 个章标题,无法分章`); process.exit(1); }

const pad = (n) => String(n).padStart(2, "0");
const scriptIdx = html.indexOf('<script src="assets/js/app.js');
const draftIdx = html.indexOf('<div class="draft-only">');
const chapters = marks.map((m, i) => {
  const no = parseInt(m[1], 10);
  const title = m[2].trim();
  const start = m.index + m[0].length;
  // 末章边界:下一章 / 草稿工具条 / 页尾脚本,取最早出现者
  let end = i + 1 < marks.length ? marks[i + 1].index : html.length;
  if (draftIdx > start && (end < 0 || draftIdx < end)) end = draftIdx;
  if (scriptIdx > start && scriptIdx < end) end = scriptIdx;
  // 剥掉页面尾部闭合符(骨架会重新补上)
  let body = html.slice(start, end).replace(/(?:<\/div>\s*|<\/main>\s*)+$/, "").trim();
  body = body.replace(/^\s*<p><b>本章目标：<\/b>/, "\n      <p class=\"lead\"><b>本章目标：</b>");
  return { no, title, file: `${skill}-ch${pad(no)}.html`, body };
});

// gen 元数据(与 M3 产物同构,app.js 据此渲染侧栏/页脚)
const genMeta = {
  skill, title: pack.title || skill, topic: pack.description || pack.title,
  chapters: chapters.map((c) => ({ no: c.no, title: c.title, goal: (c.body.match(/本章目标：<\/b>([^<]*)/) || [])[1]?.trim() || "", file: c.file })),
};
const genMetaAttr = JSON.stringify(genMeta).replace(/'/g, "&#39;").replace(/"/g, "&quot;");

// 页面骨架:与 M3 产物一致(生成课程运行时接管侧栏/页脚/进度)
const pageShell = (chapterNo, bodyHtml) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${escHTMLAttr(pack.title || skill)} ${chapterNo ? "第" + chapterNo + "章" : "课程首页"}。">
<title>${chapterNo ? "第" + chapterNo + "章 · " : ""}${escHTMLAttr(pack.title || skill)} | Agent 学院</title>
<link rel="stylesheet" href="assets/css/style.css?v=${SITE_CSS_VER}">
</head>
<body data-gen-course='${genMetaAttr}' data-chapter="gen-${skill}-ch${chapterNo || "home"}">

<header class="topbar">
  <button class="icon-btn hamburger" id="hamburger" title="打开导航">☰</button>
  <a class="brand" href="index.html"><span class="logo">学</span> Agent 学院 <small>从零开发智能体 · Ontology · Harness</small></a>
  <span class="spacer"></span>
  <span class="progress-pill" id="progress-pill">进度 0/${chapters.length} 章</span>
  <button class="icon-btn" id="theme-btn">🌙</button>
</header>

<div class="layout">
  <aside class="sidebar" id="sidebar"></aside>

  <main class="content">
    <div class="content-inner">
${bodyHtml}
    </div>
  </main>
</div>

<script src="assets/js/app.js?v=${SITE_APP_VER}"></script>
</body>
</html>
`;

// 站点版本:从 index.html 动态读取
const idxHtml = readFileSync(join(SITE, "index.html"), "utf8");
const SITE_APP_VER = (idxHtml.match(/app\.js\?v=(\d+)/) || [])[1] || "23";
const SITE_CSS_VER = (idxHtml.match(/style\.css\?v=(\d+)/) || [])[1] || "22";
function escHTMLAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// 各章页面(内容原样:去掉原 h2 行,由 chapter-head 的 h1 承担标题)
for (const c of chapters) {
  const body = `
      <header class="chapter-head">
        <div class="kicker">CHAPTER ${pad(c.no)} · 生成课程</div>
        <h1>${escHTMLAttr(c.title)}</h1>
      </header>
${c.body}`;
  writeFileSync(join(SITE, c.file), pageShell(c.no, body));
  console.log(`  ✓ 第${c.no}章 → ${c.file}`);
}

// 课程首页:大纲卡片 + 原工具条(若有)保留
const homeCards = chapters.map((c) => {
  const qs = (genMeta.chapters.find((g) => g.no === c.no)?.goal) || "";
  return `<div class="course-card">
        <h3><a href="${c.file}">第${c.no}章 · ${escHTMLAttr(c.title)}</a></h3>
        <p class="cc-desc">${escHTMLAttr(qs)}</p>
        <div class="cc-btns"><a class="btn primary" href="${c.file}">📖 进入本章</a></div>
      </div>`;
}).join("\n");

// 抽取原页面的草稿工具条与人审须知(若有)
const draftStart = html.indexOf('<div class="draft-only">');
let draftBlock = "";
if (draftStart >= 0) {
  // 嵌套深度匹配:精确截取 draft-only 块(工具条+人审须知),不吞后续章节内容
  const tagRe = /<\/?(div|details)\b[^>]*>/g;
  tagRe.lastIndex = draftStart;
  let depth = 0, m, endIdx = html.length;
  while ((m = tagRe.exec(html))) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) { endIdx = m.index + m[0].length; break; }
  }
  draftBlock = html.slice(draftStart, endIdx);
}

const headMatch = html.match(/<header class="chapter-head">([\s\S]*?)<\/header>/);
const leadText = headMatch ? headMatch[1] : "";

const homeBody = `
      <header class="chapter-head">
        <div class="kicker">课题生成课程 · 已迁移分章</div>
        <h1>${escHTMLAttr(pack.title || skill)}</h1>
        ${leadText}
        <div class="paper-nav"><a href="courses.html">← 课程管理</a></div>
      </header>

      <div class="callout info">
        <div class="co-title">课程目录(共 ${chapters.length} 章)</div>
      </div>
${homeCards}

      ${draftBlock}`;

writeFileSync(page, pageShell(null, homeBody));

// 清单:chapters 补 file
const manifestPath = join(SITE, "courses-manifest.json");
if (existsSync(manifestPath)) {
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = (m.courses || []).find((c) => c.slug === skill);
  if (entry) {
    for (const c of entry.chapters || []) {
      const found = chapters.find((x) => x.no === c.no);
      if (found) c.file = found.file;
    }
    writeFileSync(manifestPath, JSON.stringify(m, null, 2));
  }
}
console.log(`✓ 迁移完成: ${chapters.length} 章 → ${chapters.map((c) => c.file).join(", ")}`);
console.log(`✓ 课程首页: full-${skill}.html(大纲 + 入口)`);
