#!/usr/bin/env node
// 论文管线 M1:PDF → 结构分析 → 逐段翻译 → 关键句精读 → 草稿页 + 人审清单。
// 用法:
//   node scripts/make-paper-page.mjs --pdf ../papers/pdf/react.pdf \
//     --slug react-draft --title-en "ReAct: Synergizing Reasoning and Acting in Language Models" \
//     [--authors "Yao et al., ICLR 2023"] [--pdf-link papers/pdf/react.pdf] [--name "ReAct(机器初稿)"]
// 产出: 站点根 full-<slug>.html(未挂导航,待人审)+ drafts/<slug>/REVIEW.md
// 原则: 生成物是「机器初稿」——人审通过后才允许进 papers.html / 导航(见 REVIEW.md 发布清单)。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { completeSimple, getModel } from "@mariozechner/pi-ai";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
// 动态取站点当前缓存版本(避免生成页与全站版本漂移)
const SITE_VER = (readFileSync(join(SITE, "index.html"), "utf8").match(/app\.js\?v=(\d+)/) || [])[1] || "22";
const MODEL = getModel("deepseek", "deepseek-v4-flash");
const KEY = process.env.DEEPSEEK_API_KEY;
const CONCURRENCY = 6;

// ---------- 参数 ----------
const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const PDF = resolve(argOf("--pdf") || "");
const SLUG = argOf("--slug") || "paper-draft";
const TITLE_EN = argOf("--title-en") || "Untitled Paper";
const AUTHORS = argOf("--authors") || "";
const PDF_LINK = argOf("--pdf-link") || "";
const NAME = argOf("--name") || `${SLUG}(机器初稿)`;

if (!PDF || !existsSync(PDF)) { console.error("✗ --pdf 不存在"); process.exit(1); }
if (!KEY) { console.error("✗ 缺少 DEEPSEEK_API_KEY"); process.exit(1); }

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// 允许 LLM 输出 <b> 强调:先转义再放行
const escAllowB = (s) => esc(s).replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
const parseJSON = (s) => {
  const m = String(s).match(/[[{][\s\S]*[\]}]/);
  if (!m) throw new Error("输出中找不到 JSON");
  return JSON.parse(m[0]);
};

async function llm(system, user, maxTokens = 2000) {
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
    }
  }
}

async function pool(items, worker, n = CONCURRENCY) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
  }));
}

// ---------- 第 0 步:提取文本 ----------
console.log("→ 提取 PDF 文本…");
const extractOut = join(TUTOR, "kb", "tmp-paper-extract.json");
execFileSync("python3", [join(TUTOR, "scripts", "extract-pdf.py"), "--pdf", PDF, "--out", extractOut], { stdio: "inherit" });
const paper = JSON.parse(readFileSync(extractOut, "utf8"));

// ---------- 第 1 步:分段 ----------
let paras = paper.text.split(/\n\n+/).map((p) => p.trim()).filter((p) => p.length > 60);
// 段落归并为 ~500-1000 字符的翻译单元
const segs = [];
let cur = "";
for (const p of paras) {
  if (cur && (cur + "\n" + p).length > 900) { segs.push(cur); cur = ""; }
  cur += (cur ? "\n" : "") + p;
  if (cur.length > 500) { segs.push(cur); cur = ""; }
}
if (cur) segs.push(cur);
console.log(`→ ${paras.length} 段 → ${segs.length} 个翻译单元`);

// ---------- 第 2 步:结构分析 + 逐段分类 ----------
console.log("→ LLM 结构分析与分类…");
const listing = segs.map((s, i) => `${i}: ${s.slice(0, 140).replace(/\n/g, " ")}`).join("\n");
const CLASSIFY_SYS = `你是论文结构分析器。给出论文翻译单元列表(编号:首行摘录)。输出严格 JSON,不要任何其他文字:
{"sections":[{"id":0,"title":"摘要"}],"assign":[{"i":0,"s":0,"label":"核心论点","keep":true}]}
规则:
- sections 按论文实际结构给标题(id 从 0 递增,title 如:摘要、§1 引言、§2 相关工作、§3 方法、§4 实验、§5 结论);
- assign 必须覆盖每一个段号 i,s=所属节 id;label 从枚举选:核心论点|方法机制|实验结论|课程连接|省略;
- 参考文献条目、致谢、附录、纯图表数据行:keep=false 且 label=省略;
- 摘要与结论通常含 核心论点;方法描述用 方法机制;实验数字用 实验结论。`;
const classifyRaw = await llm(CLASSIFY_SYS, listing, 4000);
const cls = parseJSON(classifyRaw);
const sectionTitles = cls.sections.map((s) => s.title);
const assign = new Map(cls.assign.map((a) => [a.i, a]));

// ---------- 第 3 步:逐段翻译(并发) ----------
console.log("→ LLM 逐段翻译…");
const TRANSLATE_SYS = `你是专业的 AI 学术论文翻译。把英文段落翻译成中文:
- 术语准确,常见术语保留英文(如 LLM、ReAct、prompt、fine-tuning);
- 关键结论与关键数字用 <b>...</b> 强调;
- 不增删信息,专有名词首次出现给中文+英文;
- 另写一句不超过 50 字的"解读",点出该段最值得注意之处(可用 <b>)。
只输出严格 JSON:{"zh":"中文翻译(可用 <b>)","note":"解读"}`;
const results = new Array(segs.length).fill(null);
let done = 0;
await pool(segs.map((text, i) => ({ i, text, meta: assign.get(i) })), async (item) => {
  const meta = item.meta || { s: 0, label: "方法机制", keep: true };
  if (!meta.keep) {
    results[item.i] = { ...meta, skip: true, en: item.text.slice(0, 140) };
    done++;
    return;
  }
  try {
    const raw = await llm(TRANSLATE_SYS, item.text.slice(0, 2400), 1800);
    const out = parseJSON(raw);
    results[item.i] = { ...meta, en: item.text, zh: out.zh, note: out.note };
  } catch (e) {
    // 翻译失败降级:保留原文不译
    results[item.i] = { ...meta, en: item.text, zh: "(本段翻译失败,保留原文)", note: "" };
  }
  done++;
  if (done % 10 === 0) console.log(`  ${done}/${segs.length}`);
});
console.log(`✓ 翻译完成(${results.filter((r) => r && !r.skip).length} 段翻译 / ${results.filter((r) => r && r.skip).length} 段省略)`);

// ---------- 第 4 步:关键句精读 ----------
console.log("→ LLM 挑选关键原句…");
const keptIdx = results.map((r, i) => ({ r, i })).filter(({ r }) => r && !r.skip && (r.label === "核心论点" || r.label === "方法机制" || r.label === "实验结论"));
const KEYS_SYS = `下面是一篇论文的已翻译段落(编号:英文摘录 | 中文)。挑出 4~6 句最关键的英文原句(论文之魂:定义、核心主张、关键数字),输出严格 JSON:
[{"en":"英文原句(完整句,可从段落中截取)","zh":"中文翻译","note":"一句小白解析:这句话为什么重要(40 字内)"}]
只输出 JSON 数组。`;
let keySentences = [];
try {
  const keyRaw = await llm(KEYS_SYS, keptIdx.slice(0, 14).map(({ r, i }) => `${i}: ${r.en.slice(0, 200)} | ${r.zh.slice(0, 150)}`).join("\n"), 2500);
  keySentences = parseJSON(keyRaw).slice(0, 6);
} catch (e) { console.log("  (关键句挑选失败,跳过该节)", e.message); }

// ---------- 第 5 步:生成草稿页 ----------
console.log("→ 生成草稿页…");
const paperTitleZh = (cls.paperTitleZh || NAME).trim();
const sectionsHtml = sectionTitles.map((title, sid) => {
  const parts = results.map((r, i) => ({ r, i })).filter(({ r }) => r && r.s === sid);
  if (!parts.length) return "";
  const body = parts.map(({ r }) => {
    if (r.skip) {
      return `<div class="seg seg-skip"><div class="seg-label">省略 · ${esc(r.label)}</div><div class="seg-en">${esc(r.en)}…(此段不译:参考文献/附录等)</div></div>`;
    }
    const label = `${r.label}`;
    const note = r.note ? `\n        <div class="seg-note"><b>解读(机器生成,待审):</b>${escAllowB(r.note)}</div>` : "";
    return `<div class="seg seg-${r.label === "核心论点" ? "core" : r.label === "方法机制" ? "method" : r.label === "实验结论" ? "result" : "link"}">
        <div class="seg-label">${esc(label)}</div>
        <div class="seg-en">"${esc(r.en)}"</div>
        <div class="seg-zh">${escAllowB(r.zh)}</div>${note}
      </div>`;
  }).join("\n");
  return `\n <h2>${esc(title)}</h2>\n${body}`;
}).join("\n");

const keyHtml = keySentences.length ? `
 <h2>关键原句精读(机器挑选,待人审)</h2>
${keySentences.map((k) => ` <details class="qn"><summary> 原句精读</summary>
 <div class="qn-body">
 <div class="qn-en">${esc(k.en)}</div>
 <div class="qn-zh">${escAllowB(k.zh)}</div>
 <div class="qn-note"><b>解读(机器生成,待审):</b>${escAllowB(k.note)}</div>
 </div>
 </details>`).join("\n")}` : "";

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${esc(TITLE_EN)} 机器翻译初稿(论文管线自动生成,未经人工审校)。">
<title>全文翻译 · ${esc(NAME)} | Agent 学院</title>
<link rel="stylesheet" href="assets/css/style.css?v=21">
</head>
<body data-chapter="full">

<header class="topbar">
  <button class="icon-btn hamburger" id="hamburger" title="打开导航">☰</button>
  <a class="brand" href="index.html"><span class="logo">学</span> Agent 学院 <small>从零开发智能体 · Ontology · Harness</small></a>
  <span class="spacer"></span>
  <span class="progress-pill" id="progress-pill">进度 0/10 章</span>
  <button class="icon-btn" id="theme-btn">🌙</button>
</header>

<div class="layout">
  <aside class="sidebar" id="sidebar"></aside>

  <main class="content">
    <div class="content-inner">

      <header class="chapter-head">
        <div class="kicker">全文翻译 · 机器初稿 · 未审勿发布</div>
        <h1>${esc(paperTitleZh)}<span style="color:var(--warn)">(机器初稿)</span></h1>
        <p class="lead">
          ${esc(TITLE_EN)} · ${esc(AUTHORS)}${PDF_LINK ? ` · <a href="${esc(PDF_LINK)}" target="_blank" rel="noopener">原文 PDF</a>` : ""}
          <br><b style="color:var(--warn)">本页由论文管线自动生成,尚未人工审校。</b>
          翻译分段 ${segs.length} 个(译 ${results.filter((r) => r && !r.skip).length} / 略 ${results.filter((r) => r && r.skip).length}),关键句 ${keySentences.length} 条。
        </p>
      </header>

      <div class="callout warn">
        <div class="co-title">人审须知(发布前必读)</div>
        <p>① 逐段核对术语与数字;② 删除所有「机器生成,待审」字样;③ 关键句精读人工复核或重写;
        ④ 通过后在 papers.html 添加条目并更新导航;⑤ 发布即代表确认内容质量由发布者负责。</p>
      </div>
${sectionsHtml}
${keyHtml}

    </div>
  </main>
</div>

<script src="assets/js/app.js?v=${SITE_VER}"></script>
</body>
</html>
`;

const outPage = join(SITE, `full-${SLUG}.html`);
writeFileSync(outPage, html);

// ---------- 第 6 步:人审清单 ----------
const reviewMd = `# 人审清单 · ${NAME}

- 论文: ${TITLE_EN}
- PDF: \`${PDF}\`
- 草稿页: \`full-${SLUG}.html\`(已在站点根,**未挂导航、未加 papers 条目**)
- 规模: ${segs.length} 段(译 ${results.filter((r) => r && !r.skip).length} / 略 ${results.filter((r) => r && r.skip).length})· 关键句 ${keySentences.length} · 模型 deepseek-v4-flash

## 审校要点
1. [ ] 抽查 5 段翻译:术语、数字、逻辑是否忠实
2. [ ] 所有 <b> 强调是否放在真正重要的位置
3. [ ] 「解读」是否准确、有无过度演绎
4. [ ] 关键句精读 ${keySentences.length} 条:原句完整?解析到位?
5. [ ] 结构:小节标题是否符合论文实际
6. [ ] 全文搜索「机器生成,待审」——发布前删除全部字样

## 发布步骤(审完执行)
1. 改名 full-${SLUG}.html(去掉 draft 语义或保留)
2. papers.html 添加条目(元信息 + 原文 PDF 链接 + 指向本页)
3. 删除页内「人审须知」callout 与所有待审字样
4. node scripts/check-site.mjs 全绿
5. git commit + push
`;
const reviewDir = join(SITE, "drafts", SLUG);
mkdirSync(reviewDir, { recursive: true });
writeFileSync(join(reviewDir, "REVIEW.md"), reviewMd);
console.log(`\n✓ 草稿页: ${outPage}`);
console.log(`✓ 人审清单: ${join(reviewDir, "REVIEW.md")}`);
console.log("  下一步: 人工审校 → 按 REVIEW.md 发布步骤操作");
