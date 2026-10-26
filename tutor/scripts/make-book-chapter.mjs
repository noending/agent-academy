#!/usr/bin/env node
// 书籍分章翻译页 v2:一章 → 块级解析(代码块还原/标题并入段落/散文换行修复)→ 英中对照
// + 原书插图画廊(PDF 位图提取) + 本章一图流(LLM 流程图) → book-<slug>-ch<N>.html。
// v1 的教训:直接按空行分段把代码打成段落汤——书是代码密集型,必须先分块再翻译。
// 用法: node scripts/make-book-chapter.mjs --slug <slug> [--chapter N] [--all] [--appendix] [--force]
// 依赖: drafts/<slug>/book-cards.json(卡片) + kb 原文 + kb/<slug>-figures.json(可选,插图清单)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { completeSimple, getModel } from "@mariozechner/pi-ai";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const idxHtml = readFileSync(join(SITE, "index.html"), "utf8");
const SITE_VER = (idxHtml.match(/app\.js\?v=(\d+)/) || [])[1] || "23";
const SITE_CSS_VER = (idxHtml.match(/style\.css\?v=(\d+)/) || [])[1] || "22";
const MODEL = getModel("deepseek", "deepseek-v4-flash");
const KEY = process.env.DEEPSEEK_API_KEY;
const CONCURRENCY = 6;

const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const SLUG = argOf("--slug") || "";
const ONE = argOf("--chapter") ? +argOf("--chapter") : null;
const ALL = args.includes("--all");
const WITH_APPENDIX = args.includes("--appendix");
const FORCE = args.includes("--force");

if (!SLUG) { console.error("✗ --slug 必填"); process.exit(1); }
if (!KEY) { console.error("✗ 缺少 DEEPSEEK_API_KEY"); process.exit(1); }
const CARDS = join(SITE, "drafts", SLUG, "book-cards.json");
if (!existsSync(CARDS)) { console.error(`✗ 找不到 ${CARDS}(先跑 make-book-page.mjs)`); process.exit(1); }
const cards = JSON.parse(readFileSync(CARDS, "utf8"));
const KB = resolve(TUTOR, cards.meta.kb);
const kb = JSON.parse(readFileSync(KB, "utf8"));
const FIGS = join(TUTOR, "kb", `${SLUG}-figures.json`); // 可选:extract-book-figures.py 产物
const figByCh = existsSync(FIGS)
  ? JSON.parse(readFileSync(FIGS, "utf8")).chapters || {}
  : {};
const TITLE = cards.meta.title, AUTHORS = cards.meta.authors || "", PDF = cards.meta.pdf || "";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAllowB = (s) => esc(s).replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
const parseJSON = (s) => { const m = String(s).match(/[[{][\s\S]*[\]}]/); if (!m) throw new Error("输出中找不到 JSON"); return JSON.parse(m[0]); };

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
    } catch (e) { if (attempt === 2) throw e; }
  }
}
async function pool(items, worker, n = CONCURRENCY) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
  }));
}

const TRANSLATE_SYS = `你是专业的技术书翻译。把英文段落翻译成中文:
- 术语准确,常见术语保留英文(如 LLM、prompt、Reflection、RAG);
- 关键结论与关键概念用 <b>...</b> 强调;
- 不增删信息,专有名词首次出现给中文+英文;段落里夹的行内代码与命令保留原样。
只输出严格 JSON:{"zh":"中文翻译(可用 <b>)","note":"一句不超过 50 字的导读注:点出该段最值得注意之处(可用 <b>)"}`;

const FLOW_SYS = `你是技术书讲解员。根据本章要点设计一张「本章一图流」(横向流程),帮读者 10 秒看懂本章逻辑。输出严格 JSON:
{"nodes":[{"t":"节点名(≤10字,可带英文术语)","d":"一句说明(≤18字)"}],"note":"这张图想说明的一件事(≤40字)"}
规则: 3~5 个节点,按本章的论述/执行顺序排列,节点间是推进/反馈关系;不要照抄要点原句,要提炼成图。`;

// 已是中文的书(导入时就是中文)不翻译,直出
const cjkRatio = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length / Math.max(s.length, 1);
const isCJKBook = cjkRatio(kb.chunks.slice(0, 20).map((c) => c.text).join(" ")) > 0.25;

// ---------- 块级解析 v2:先按空行分段,段内多数行为代码 → 代码块;否则并入散文流(句边界切 ~750) ----------
const CODE_START = /^\s*(from\s|import\s|def\s|class\s|async\s|await\s|@|return\s|print\(|for\s|while\s|if\s|elif\s|else\s*:|try:|except|with\s|#!|\/\/|"|'|%%|\$\s)/;
function isCodeLine(line) {
  const s = line.trim();
  if (!s || s.length < 4) return false;
  if (/^(Summary|Chapter|Appendix|[0-9]+(\.[0-9]+)*\s+[A-Z])/i.test(s)) return false;
  if (CODE_START.test(line)) return true;
  if (/["'].*["']\s*[:,]|=>|==|!=|\+=|\)\s*;?\s*$/.test(s)) return true;
  const sym = (s.match(/[=(){}\[\];:<>/\\|+*%-]/g) || []).length;
  const hasSentence = /\.\s+[A-Z]/.test(s);
  return sym >= 4 && /[=({;]/.test(s) && !hasSentence && s.length < 100 && !/^[A-Z][a-z]+ [a-z]+ [a-z]/.test(s);
}
function isHeading(line) {
  const s = line.trim();
  if (s.length > 90 || s.length < 3) return false;
  return /^([0-9]+(\.[0-9]+)*\s+[A-Z]|Chapter\s|Appendix\s|Summary$|Conclusion|Key Takeaways|References$|Introduction$|Why .* Matters$|What (Is|Are) )/.test(s);
}
function splitLong(text, cap = 750) {
  if (text.length <= cap + 120) return [text];
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"“(])/);
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + " " + s).length > cap) { out.push(cur); cur = s; }
    else cur += (cur ? " " : "") + s;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function parseBlocks(text) {
  const rawParas = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const blocks = [];
  let prose = [];
  const flush = () => {
    const joined = prose.join(" ");
    prose = [];
    for (const t of splitLong(joined)) blocks.push({ type: "para", text: t });
  };
  for (const p of rawParas) {
    const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2 && lines.filter(isCodeLine).length / lines.length >= 0.5) {
      flush();
      blocks.push({ type: "code", text: lines.join("\n") });
      continue;
    }
    if (lines.length === 1 && isHeading(lines[0])) { flush(); blocks.push({ type: "head", text: lines[0] }); continue; }
    prose.push(lines.join(" "));
  }
  flush();
  return blocks;
}
function codeLang(code) {
  if (/^\s*(from |import |def |class |print\(|#)/m.test(code) || /:\s*$/m.test(code)) return "python";
  if (/(function |const |let |=>|console\.)/.test(code)) return "javascript";
  return "text";
}

// ---------- 选章 ----------
let targets;
if (ONE != null) targets = [ONE];
else if (ALL) targets = cards.chapters.filter((c) => WITH_APPENDIX || !c.appendix).map((c) => c.no);
else { console.error("✗ --chapter N 或 --all 二选一"); process.exit(1); }

const chunksByCh = new Map();
for (const c of kb.chunks) {
  if (!chunksByCh.has(c.chapter)) chunksByCh.set(c.chapter, []);
  chunksByCh.get(c.chapter).push(c);
}

console.log(`书:${TITLE}${isCJKBook ? "(中文书,不翻译直出)" : "(英文书,逐段翻译)"} · 目标章:${targets.join(",")}`);

let gen = 0, total = 0;
for (const no of targets) {
  const card = cards.chapters.find((c) => c.no === no);
  if (!card) { console.log(`  ✗ 第${no}章:卡片不存在,跳过`); continue; }
  const outPage = join(SITE, `book-${SLUG}-ch${no}.html`);
  if (existsSync(outPage) && !FORCE) { console.log(`  · 第${no}章:已存在,跳过(--force 重生成)`); continue; }
  const chunks = (chunksByCh.get(no) || []).sort((a, b) => a.id.localeCompare(b.id));
  if (!chunks.length) { console.log(`  ✗ 第${no}章:kb 无内容,跳过`); continue; }

  const blocks = parseBlocks(chunks.map((c) => c.text).join("\n\n"));
  const paras = blocks.filter((b) => b.type !== "code");
  const codes = blocks.filter((b) => b.type === "code");

  // 并发翻译散文段与标题
  const results = new Map();
  let done = 0;
  await pool(paras.map((b) => ({ b })), async ({ b }) => {
    if (isCJKBook) { results.set(b, { zh: b.text.replace(/\n/g, " — "), note: "" }); return; }
    try {
      const out = parseJSON(await llm(TRANSLATE_SYS, b.text.slice(0, 2600), 2200));
      results.set(b, { zh: (out.zh || "").trim(), note: out.note || "", en: b.text });
    } catch (e) {
      results.set(b, { zh: "", note: "", en: b.text, failed: true });
    }
    done++;
    if (done % 10 === 0) process.stdout.write(`  第${no}章 ${done}/${paras.length}\n`);
  });

  // 本章一图流(失败降级为无图)
  let flow = null;
  try {
    const f = parseJSON(await llm(FLOW_SYS, `第${no}章 ${card.titleZh}(${card.titleEn})\n要点:\n${(card.keyIdeas || []).join("\n")}\n一句话:${card.oneLiner}`, 1200));
    if (Array.isArray(f.nodes) && f.nodes.length >= 2) flow = f;
  } catch { /* 无图 */ }

  // ---------- 渲染 ----------
  const prev = cards.chapters.filter((c) => (WITH_APPENDIX || !c.appendix) && c.no < no).pop();
  const next = cards.chapters.find((c) => (WITH_APPENDIX || !c.appendix) && c.no > no);
  const navLink = (label, href) => label ? `<a class="chip" href="${esc(href)}">${esc(label)}</a>` : "";

  const figs = (figByCh[String(no)] || []).slice(0, 12);
  const figsHtml = figs.length ? `<h2>原书插图</h2>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
${figs.map((f) => `        <figure style="margin:0;text-align:center">
          <a href="${esc(f.file)}" target="_blank" rel="noopener"><img src="${esc(f.file)}" alt="第${no}章原书插图(第${f.page}页)" loading="lazy" style="max-width:100%;height:auto;border:1px solid var(--line);border-radius:10px"></a>
          <figcaption style="font-size:12px;color:var(--text-3);margin-top:6px">原书第 ${f.page} 页 · 点击看大图</figcaption>
        </figure>`).join("\n")}
      </div>` : "";

  const flowHtml = flow ? `<div class="flow">
        ${flow.nodes.map((n) => `<span class="flow-node">${esc(n.t)}<small style="display:block;font-weight:400;font-size:12px;color:var(--text-3)">${esc(n.d || "")}</small></span>`).join(`<span class="flow-arrow">→</span>`)}
        <div class="flow-note">${escAllowB(flow.note || "")}</div>
      </div>` : "";

  const bodyHtml = blocks.map((b) => {
    if (b.type === "code") {
      const lang = codeLang(b.text);
      const langCls = ["python", "javascript", "bash", "json"].includes(lang) ? ` class="language-${lang}"` : "";
      return `<div class="codeblock">
        <div class="code-head"><span class="code-lang">${lang}</span></div>
        <pre><code${langCls}>${esc(b.text)}</code></pre>
      </div>`;
    }
    const r = results.get(b);
    if (!r || !r.zh) return "";
    if (b.type === "head") {
      return `<h3 style="margin:26px 0 8px">${escAllowB(r.zh)} <span class="small-note">${esc(b.text)}</span></h3>`;
    }
    return `<div class="seg">
        ${r.en ? `<div class="seg-en">"${esc(r.en)}"</div>` : ""}
        <div class="seg-zh">${escAllowB(r.zh)}</div>
        ${r.note ? `<div class="seg-note"><b>导读注:</b>${escAllowB(r.note)}</div>` : ""}
      </div>`;
  }).join("\n");

  const chLabel = card.appendix ? `附录` : `第 ${no} 章`;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${esc(TITLE)} ${esc(chLabel)} ${esc(card.titleZh)}${isCJKBook ? "" : " 中英对照翻译,配原书插图与本章一图流"}。">
<title>${esc(chLabel)} · ${esc(card.titleZh)} | ${esc(TITLE)} | Agent 学院</title>
<link rel="stylesheet" href="assets/css/style.css?v=${SITE_CSS_VER}">
</head>
<body data-chapter="books">

<header class="topbar">
  <button class="icon-btn hamburger" id="hamburger" title="打开导航">☰</button>
  <a class="brand" href="index.html"><span class="logo">学</span> Agent 学院 <small>从零开发智能体 · Ontology · Harness</small></a>
  <span class="spacer"></span>
  <span class="progress-pill" id="progress-pill">读书</span>
  <button class="icon-btn" id="theme-btn">🌙</button>
</header>

<div class="layout">
  <aside class="sidebar" id="sidebar"></aside>

  <main class="content">
    <div class="content-inner">

      <header class="chapter-head">
        <div class="kicker">读书 · ${esc(TITLE)} · ${isCJKBook ? "中文原书" : "中英对照"}</div>
        <h1>${esc(chLabel)} · ${escAllowB(card.titleZh)}</h1>
        <p class="lead">
          ${esc(card.titleEn)} · 《${esc(TITLE)}》${AUTHORS ? ` · ${esc(AUTHORS)}` : ""}
          <br>${escAllowB(card.oneLiner)}
          <br>${navLink("← 返回导读", `book-${SLUG}.html`)} ${PDF ? navLink("原书 PDF", PDF) : ""} ${prev ? navLink(`上一章:第${prev.no}章`, `book-${SLUG}-ch${prev.no}.html`) : ""} ${next ? navLink(`下一章:第${next.no}章`, `book-${SLUG}-ch${next.no}.html`) : ""}
        </p>
      </header>

      ${(card.keyIdeas || []).length ? `<div class="callout key"><div class="co-title">本章要点</div><p>${card.keyIdeas.map((k) => "① " + escAllowB(k)).join("  ")}</p></div>` : ""}
${flowHtml ? `<h2>本章一图流</h2>\n${flowHtml}\n` : ""}${figsHtml}
${quotes(card)}
      <h2>${isCJKBook ? "本章正文" : "正文(英中对照)"}</h2>
${bodyHtml}

      <div class="callout info" style="margin-top:24px">
        <div class="co-title">来源与用途</div>
        <p style="margin-bottom:0">《${esc(TITLE)}》${AUTHORS ? `,${esc(AUTHORS)}` : ""}${PDF ? ` · <a href="${esc(PDF)}" target="_blank" rel="noopener">原书 PDF</a>` : ""}。本页为学习用途的对照整理,版权归原作者;有问题到读书导师处提问,答案只引用书中原文并标注章节。</p>
      </div>

      <p class="pager" style="margin-top:18px">
        ${prev ? navLink(`← 第${prev.no}章 · ${prev.titleZh || ""}`, `book-${SLUG}-ch${prev.no}.html`) : ""}
        ${navLink("导读", `book-${SLUG}.html`)}
        ${next ? navLink(`第${next.no}章 · ${next.titleZh || ""} →`, `book-${SLUG}-ch${next.no}.html`) : ""}
      </p>

    </div>
  </main>
</div>

<script src="assets/js/app.js?v=${SITE_VER}"></script>
</body>
</html>
`;
  writeFileSync(outPage, html);
  gen += paras.length; total++;
  console.log(`  ✓ book-${SLUG}-ch${no}.html(${paras.length} 段 + ${codes.length} 代码块${figs.length ? ` + ${figs.length} 图` : ""})`);
}
console.log(`\n✓ 完成:${total} 章 / ${gen} 段`);

function quotes(card) {
  const qs = card.quotes || [];
  if (!qs.length) return "";
  return `<h2>本章划线句</h2>\n${qs.map((q) => `<details class="qn"><summary>划线句(逐字校验)</summary>
        <div class="qn-body">
        <div class="qn-en">"${esc(q.q)}"</div>
        <div class="qn-zh"><b>为什么值得划线:</b>${escAllowB(q.why)}</div>
        </div>
      </details>`).join("\n")}\n`;
}
