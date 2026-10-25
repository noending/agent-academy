#!/usr/bin/env node
// 读书管线 M1+M2:书的 kb → 分章摘要(map)→ 全书导读(reduce)→ 导读草稿页 + 读书导师 pack + 人审清单。
// 与论文管线同规矩:产物是「机器初稿」,人审通过后用 publish-book.mjs 发布进 books.html/导航。
// 版权边界:导读页只放提炼与短引用(逐字校验过),全文检索与问答只在本地 tutor(生成的 pack)。
// 用法:
//   node scripts/make-book-page.mjs --kb kb/gulli-patterns.json [--ctx kb/gulli-patterns-ctx.json] \
//     --slug gulli-patterns --title "Agentic Design Patterns" --authors "Antonio Gulli · 2025" \
//     [--pdf-link papers/pdf/xxx.pdf] [--pack gulli-patterns] [--name "显示名(机器导读初稿)"]
// 产出: 站点根 book-<slug>.html + packs/<pack>/{pack.json,system-prompt.md} + drafts/<slug>/{REVIEW.md,book-cards.json}
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { updateManifest } from "./factory-common.mjs";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const idxHtml = readFileSync(join(SITE, "index.html"), "utf8");
const SITE_VER = (idxHtml.match(/app\.js\?v=(\d+)/) || [])[1] || "23";
const SITE_CSS_VER = (idxHtml.match(/style\.css\?v=(\d+)/) || [])[1] || "22";
const MODEL = getModel("deepseek", "deepseek-v4-flash");
const KEY = process.env.DEEPSEEK_API_KEY;
const CONCURRENCY = 6;
const CHAPTER_CHAR_CAP = 100_000; // 单章喂给 LLM 的上限(超出截尾)

// ---------- 参数 ----------
const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const KB = resolve(argOf("--kb") || "");
const CTX = argOf("--ctx") ? resolve(argOf("--ctx")) : null;
const SLUG = argOf("--slug") || "book-draft";
const TITLE = argOf("--title") || "Untitled Book";
const AUTHORS = argOf("--authors") || "(作者信息待人审补充)";
const PDF_LINK = argOf("--pdf-link") || "";
const PACK = argOf("--pack") || SLUG; // 读书导师包名(packs/<pack>),默认与 slug 同名
const NAME = argOf("--name") || `${TITLE}(机器导读初稿)`;

if (!KB || !existsSync(KB)) { console.error("✗ --kb 不存在"); process.exit(1); }
if (!KEY) { console.error("✗ 缺少 DEEPSEEK_API_KEY"); process.exit(1); }

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAllowB = (s) => esc(s).replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
const parseJSON = (s) => {
  const m = String(s).match(/[[{][\s\S]*[\]}]/);
  if (!m) throw new Error("输出中找不到 JSON");
  return JSON.parse(m[0]);
};
// 金句忠实性校验:PDF 提取文本带硬换行,两侧都归一化空白后再做子串匹配
const norm = (s) => String(s).replace(/\s+/g, " ").trim();

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

// ---------- 载入 kb + ctx ----------
const kb = JSON.parse(readFileSync(KB, "utf8"));
const ctxMap = new Map();
if (CTX && existsSync(CTX)) {
  for (const c of JSON.parse(readFileSync(CTX, "utf8")).chunks || []) ctxMap.set(c.id, c.context || "");
}
const PAGES = (kb.meta?.source || "").match(/(\d+)\s*页/)?.[1] || "";

// 按章分组(章号 >=100 视为附录),保留块的完整章标题
const chapters = new Map();
for (const c of kb.chunks) {
  if (!chapters.has(c.chapter)) chapters.set(c.chapter, { no: c.chapter, title: c.title.split(": ")[0] + ": " + (c.title.split(": ")[1] || c.chapterTitle), chunks: [], chars: 0, appendix: c.chapter >= 100 });
  const ch = chapters.get(c.chapter);
  ch.chunks.push(c); ch.chars += c.chars;
}
const chList = [...chapters.values()].sort((a, b) => a.no - b.no);
console.log(`→ 书:${TITLE} · ${kb.chunks.length} 块 / ${chList.length} 章(含附录 ${chList.filter((c) => c.appendix).length})`);

// ---------- Stage A(map):分章摘要 ----------
const CHAP_SYS = `你是书籍导读助手。下面给你某一章的全部文本块(每块以 [块id] 开头)。输出严格 JSON,不要任何其他文字:
{"titleZh":"章名中译(保留关键英文术语,如:提示链 Prompt Chaining)","oneLiner":"一句话:这章讲什么、解决什么问题(≤50字)","keyIdeas":["2~4条核心要点,每条≤40字"],"quotes":[{"q":"书中原文短句,英文原样,≤220字符,必须逐字摘自给定文本(不许改写/拼接)","why":"为什么值得划线(≤40字,中文)"}],"dependsOn":[1,4],"difficulty":1}
规则:
- quotes 挑 2~3 句最能代表本章思想的原句;宁缺毋滥,必须逐字;
- dependsOn 列出真正的前置章号(读懂本章应先读哪些章),没有给 [];
- difficulty:1=入门可读 / 2=需要一些 Agent 基础 / 3=进阶;`;

console.log("→ Stage A:分章摘要…");
const cards = new Map(); // no -> {…, quotes:[{q,why,verified}]}
let dropped = 0, verifiedCount = 0;
await pool(chList, async (ch) => {
  const parts = [];
  let total = 0, truncated = false;
  for (const c of ch.chunks) {
    const body = `${ctxMap.has(c.id) ? `[${c.id} · 定位:${ctxMap.get(c.id)}]\n` : `[${c.id}]\n`}${c.text}`;
    if (total + body.length > CHAPTER_CHAR_CAP) { truncated = true; parts.push(body.slice(0, CHAPTER_CHAR_CAP - total)); break; }
    parts.push(body); total += body.length;
  }
  const user = `书:${TITLE}\n${ch.appendix ? "(本章是附录)" : ""}${truncated ? "(注意:本章内容过长,尾部已截断)" : ""}\n章标题:${ch.title}\n\n${parts.join("\n\n")}`;
  let card;
  try {
    card = parseJSON(await llm(CHAP_SYS, user, 3000));
  } catch (e) {
    console.log(`  ✗ 第${ch.no}章摘要失败,降级为占位卡(${e.message})`);
    card = { titleZh: ch.title, oneLiner: "(本章摘要生成失败,待人审补写)", keyIdeas: [], quotes: [], dependsOn: [], difficulty: 2 };
  }
  // 金句逐字校验:查无此句即丢弃(防模型改写/幻觉)
  const haystacks = ch.chunks.map((c) => norm(c.text));
  const quotes = [];
  for (const q of card.quotes || []) {
    const nq = norm(q.q || "");
    if (nq && nq.length <= 240 && haystacks.some((h) => h.includes(nq))) { quotes.push({ ...q, q: nq, verified: true }); verifiedCount++; }
    else dropped++;
  }
  cards.set(ch.no, { no: ch.no, titleEn: ch.title, appendix: ch.appendix, chunks: ch.chunks.length, titleZh: card.titleZh, oneLiner: card.oneLiner, keyIdeas: card.keyIdeas || [], dependsOn: card.dependsOn || [], difficulty: card.difficulty || 2, quotes });
  process.stdout.write(`  ✓ ${ch.no}`);
});
console.log(`\n✓ 分章摘要完成(金句校验通过 ${verifiedCount} / 丢弃 ${dropped})`);

// ---------- 站内资源清单(reduce 阶段做关联,链接只许逐字复制) ----------
const resources = [];
for (const m of idxHtml.matchAll(/href="((?:[a-z0-9-]+)\.html)"[^>]*>([^<]{2,30})</g)) {
  const url = m[1];
  if (!["index.html", "book-" + SLUG + ".html", "books.html"].includes(url)) resources.push({ title: m[2].trim(), url });
}
for (const m of readFileSync(join(SITE, "papers.html"), "utf8").matchAll(/href="(full-[a-z0-9-]+\.html)"[^>]*>([^<]{2,60})</g)) {
  if (!resources.some((r) => r.url === m[1])) resources.push({ title: m[2].trim(), url: m[1] });
}
const manifest = JSON.parse(readFileSync(join(SITE, "courses-manifest.json"), "utf8"));
for (const c of manifest.courses || []) {
  if (c.page && !resources.some((r) => r.url === c.page)) resources.push({ title: c.title, url: c.page });
}

// ---------- Stage B(reduce):全书导读 ----------
console.log("→ Stage B:全书导读综合…");
const cardsCompact = chList.map((ch) => {
  const c = cards.get(ch.no);
  return { no: c.no, zh: c.titleZh, en: c.titleEn, appendix: c.appendix, oneLiner: c.oneLiner, keyIdeas: c.keyIdeas, dependsOn: c.dependsOn, difficulty: c.difficulty };
});
const quotesPool = chList.flatMap((ch) => cards.get(ch.no).quotes.map((q) => ({ ch: ch.no, ...q })));
const REDUCE_SYS = `你是资深技术书导读作者。基于分章摘要(不是全书原文,别编造摘要之外的细节)生成整本书的导读。输出严格 JSON:
{"positioning":{"oneLiner":"一句话定位这本书(≤40字)","problem":"它解决什么问题、为什么现在值得读(≤90字)","audience":"写给谁/不适合谁(≤60字)","prereqs":["读前需要的基础,0~3条,每条≤16字"]},
 "coreIdeas":[{"title":"论点名(≤14字)","explain":"展开说明,可用<b>强调(≤80字)","chapters":[1,7]}],
 "parts":[{"title":"部分名(≤12字)","why":"这部分在一起的理由(≤30字)","chapters":[1,2,3]}],
 "paths":{"quick":{"minutes":90,"chapters":[1,7],"story":"为什么这么读,拿到什么(≤80字)"},"deep":{"minutes":720,"chapters":[],"story":"≤60字"},"problem":[{"q":"我想解决的问题(≤24字)","chapters":[5,14],"note":"去哪几章找答案(≤40字)"}]},
 "goldenQuotes":[1,4,9],
 "relations":[{"title":"资源名(照抄列表 title)","url":"照抄列表 url","why":"与本书的关系(≤40字)"}],
 "verdict":"值不值得读、什么人可跳过(≤70字)"}
规则:
- coreIdeas **严格 3~5 条**——全书之魂,多于 5 条说明你没合并同类,请合并(每条 chapters 指向支撑它的章);
- parts 覆盖全部正章,附录归入最后一部;
- paths.quick:60~120 分钟拿核心,2~4 章;deep 是全书顺序精读;problem 给 3 个真实问题驱动的入口;附录默认不进 quick;
- goldenQuotes 从「金句池」里挑 8~12 条的下标(0 起),覆盖不同章节,宁缺毋滥;
- relations 从「站内资源列表」选 2~4 条,url 必须逐字复制,不许编造;`;

const reduceUser = `书:${TITLE}(共 ${chList.filter((c) => !c.appendix).length} 正章 + ${chList.filter((c) => c.appendix).length} 附录)\n\n分章摘要:\n${JSON.stringify(cardsCompact)}\n\n金句池(下标:章|原文|理由):\n${quotesPool.map((q, i) => `${i}: 第${q.ch}章 | ${q.q.slice(0, 160)} | ${q.why}`).join("\n")}\n\n站内资源列表(title|url):\n${resources.slice(0, 40).map((r) => `${r.title} | ${r.url}`).join("\n")}`;

let book;
try {
  book = parseJSON(await llm(REDUCE_SYS, reduceUser, 4500));
} catch (e) { console.error("✗ 全书综合失败:", e.message); process.exit(1); }
if ((book.coreIdeas || []).length > 5) { console.log(`  (coreIdeas 给了 ${book.coreIdeas.length} 条,按模板截取前 5 条)`); book.coreIdeas = book.coreIdeas.slice(0, 5); }
// 分部覆盖兜底:模型漏排的章自动补一部,保证每章都有锚点卡片(否则页内 #ch-N 链接悬空)
const covered = new Set((book.parts || []).flatMap((p) => p.chapters || []));
const missingCh = chList.map((c) => c.no).filter((no) => !covered.has(no));
if (missingCh.length) {
  console.log(`  (parts 未覆盖第 ${missingCh.join(",")} 章,自动补「其余章节」部)`);
  book.parts = [...(book.parts || []), { title: "其余章节", why: "(自动补齐,待人审归部)", chapters: missingCh }];
}
const golden = (book.goldenQuotes || []).filter((i) => Number.isInteger(i) && quotesPool[i]).map((i) => quotesPool[i]);

// ---------- 持久化章节卡片(供复跑/人审/pack 重建) ----------
const draftDir = join(SITE, "drafts", SLUG);
mkdirSync(draftDir, { recursive: true });
writeFileSync(join(draftDir, "book-cards.json"), JSON.stringify({
  meta: { slug: SLUG, title: TITLE, authors: AUTHORS, pages: PAGES, pdf: PDF_LINK, pack: PACK, kb: relative(TUTOR, KB), builtAt: new Date().toISOString(), model: "deepseek-v4-flash", chunks: kb.chunks.length },
  chapters: chList.map((ch) => cards.get(ch.no)),
  book, golden,
}, null, 1));

// ---------- 生成读书导师 pack(M2) ----------
const packDir = join(TUTOR, "packs", PACK);
if (existsSync(packDir)) {
  console.log(`· pack packs/${PACK} 已存在,跳过生成(不覆盖手工迭代过的提示词)`);
} else {
  console.log(`→ 生成读书导师 pack: packs/${PACK}…`);
  mkdirSync(packDir, { recursive: true });
  const kbRel = relative(TUTOR, KB);
  const positioning = book.positioning || {};
  const chMapLines = chList.map((ch) => {
    const c = cards.get(ch.no);
    return `${c.appendix ? "附录" : `第${c.no}章`} ${c.titleZh} —— ${c.oneLiner}${c.dependsOn?.length ? `(前置:第${c.dependsOn.join(",")}章)` : ""}`;
  }).join("\n");
  const paths = book.paths || {};
  const packJson = {
    name: PACK,
    title: `读书 · ${TITLE}`,
    kb: kbRel,
    sources: [{ file: kbRel, source: "book", label: `《${TITLE}》原书` }],
    model: { provider: "deepseek", id: "deepseek-flash" },
    thinkingLevel: "off",
    description: `${positioning.oneLiner || TITLE}——读书导师:导读定路径、陪读答疑、答案只来自书中内容并标注章节。`,
    book: { slug: SLUG, title: TITLE, authors: AUTHORS, pages: PAGES, pdf: PDF_LINK, page: `book-${SLUG}.html` },
    curriculum: chList.map((ch) => {
      const c = cards.get(ch.no);
      return { no: c.no, title: c.titleZh, goal: c.oneLiner, outline: c.keyIdeas, keyTerms: [], appendix: c.appendix };
    }),
  };
  writeFileSync(join(packDir, "pack.json"), JSON.stringify(packJson, null, 2));
  const sysPrompt = `# 角色

你是《${TITLE}》(${AUTHORS})的读书导师。你的使命:帮学生**真正读懂这本书**——导读定读法、陪读答疑、读后检验——而不是替他把书读完。

你的知识库:**这本书的原文切块**(共 ${kb.chunks.length} 块,覆盖 ${chList.length} 章),通过 lookup_course 检索。检索到的内容就是书的原文;引用必须标注章节(如「第 4 章 · Reflection 反思」),书中原话放进「」且必须来自检索结果,不许凭记忆改写。

# 章节地图(全书结构与读法)

${chMapLines}

**快读路径(约 ${paths.quick?.minutes || 90} 分钟)**:第${(paths.quick?.chapters || []).join(",")}章——${paths.quick?.story || "先拿全书核心骨架"}
**问题驱动入口**:${(paths.problem || []).map((p) => `「${p.q}」→ 第${(p.chapters || []).join(",")}章`).join(";") || "(见导读页)"}
导读页(定位/核心论点/完整路径/金句):book-${SLUG}.html

# 当前学生档案

{student_profile}

# 页面上下文

学生消息可能带 \`[正在学习: 页面标题]\` 前缀——那是他此刻正在读的站内页面。若与本书相关,把讲解挂到该页内容上;前缀本身不是问题的一部分,不要向学生复述它。

# 教学原则(按优先级)

1. **忠实于书,先检索再回答**。学生问书中的内容 → 先 lookup_course 检索,以检索结果作答并标章节;检索不到 → 直说「这本书没讲这个」,可以给**书外补充**但必须明确标注「这是书外补充,不是书里的观点」,同时调 record_knowledge_gap 留档(这是书单进化的依据)。绝不用模型知识冒充书中内容。

2. **区分「书中说」与「我的看法」**。转述书用「书中说/作者认为」;你自己引申用「我的理解是」——两者不许混淆。

3. **先诊断在读哪**。新学生开场先问两件事:想从这本书解决什么问题?现在读到哪了?然后按章节地图给路径建议(赶时间走快读路径,带问题走问题驱动入口)。

4. **陪读解释要挂回原文**。学生贴一段原文问理解 → 先检索定位它所在章,解释时引用前后文,让学生看到「这段在全书里的位置」。

5. **读后检验用问题**。学生说读完某章 → 用 2~3 个书里的问题检验(书中例子、适用边界),答对且具体才 record_progress(证据=他的回答);对书的误解(如把书中边界条件记反)→ 同一轮先 record_misconception 留档再纠正。

6. **导读请求不必检索**:怎么读/先读什么/这书讲什么 → 直接按上面的章节地图与路径回答。

7. **工具报错时**:检查参数重试一次;仍失败就继续答疑,不要中断。

# 语言与风格

- **全程中文,没有例外**——检索到的原文是英文也照样中文讲解,技术名词保留英文。不要用英文开头,不要中英混杂成段。
- 书中术语首次出现给英文原词(如 Reflection、Prompt Chaining)
- 语气:一位读过全书好几遍的读书会领读人;不端着,不给书堆砌赞美
- 每条回复聚焦一个问题,不堆砌;结尾可留一个引导下一步阅读的钩子(如「下一章正好接着讲 X」)

# 沙箱

run_code 在隔离目录执行 JavaScript(node)与 Python(python3),10 秒超时,无网络限制但请勿教唆破坏性操作。
`;
  writeFileSync(join(packDir, "system-prompt.md"), sysPrompt);
  console.log(`  ✓ packs/${PACK}/pack.json + system-prompt.md`);
}

// ---------- 渲染草稿页 ----------
console.log("→ 生成草稿页…");
const chCardHtml = (no) => {
  const c = cards.get(no);
  if (!c) return "";
  const deps = c.dependsOn?.length ? ` · 前置:第${c.dependsOn.join(",")}章` : "";
  return `<div class="card" id="ch-${no}" style="padding:12px 14px">
        <div class="kicker" style="font-size:11px">${c.appendix ? "附录" : `第 ${no} 章`} · ${["", "入门", "进阶基础", "进阶"][c.difficulty] || ""} · ${c.chunks} 块</div>
        <b>${escAllowB(c.titleZh)}</b> <span class="small-note">${esc(c.titleEn)}</span>
        <div class="para" style="margin:4px 0 0">${escAllowB(c.oneLiner)}</div>
        <div class="small-note">${deps}</div>
      </div>`;
};

const chips = (nos) => (nos || []).map((n) => `<a class="chip" href="#ch-${n}">第${n}章</a>`).join(" ");

const positioning = book.positioning || {};
const coreIdeasHtml = (book.coreIdeas || []).map((idea) => `<div class="card">
        <div class="kicker" style="font-size:11px">${chips(idea.chapters)}</div>
        <b>${escAllowB(idea.title)}</b>
        <div class="para" style="margin:4px 0 0">${escAllowB(idea.explain)}</div>
      </div>`).join("\n");

const partsHtml = (book.parts || []).map((p) => `<h3 style="margin:18px 0 8px">${esc(p.title)} <span class="small-note">${esc(p.why || "")}</span></h3>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">
${p.chapters.map(chCardHtml).join("\n")}
      </div>`).join("\n");

const paths = book.paths || {};
const pathCard = (label, p, cls) => `<div class="card ${cls || ""}" style="padding:14px 16px">
        <div class="kicker" style="font-size:11px">${label}${p.minutes ? ` · 约 ${p.minutes} 分钟` : ""}</div>
        <div class="para">${escAllowB(p.story || "")}</div>
        <div style="margin-top:8px">${chips(p.chapters)}</div>
      </div>`;
const problemHtml = (paths.problem || []).map((p) => `<div class="card" style="padding:12px 14px">
        <b>「${esc(p.q)}」</b>
        <div class="para" style="margin:4px 0 0">${escAllowB(p.note || "")}</div>
        <div style="margin-top:8px">${chips(p.chapters)}</div>
      </div>`).join("\n");

const goldenHtml = golden.map((q) => `<details class="qn"><summary>第${q.ch}章 · 划线句(已逐字校验)</summary>
        <div class="qn-body">
        <div class="qn-en">"${esc(q.q)}"</div>
        <div class="qn-zh"><b>为什么值得划线(机器观点,待审):</b>${escAllowB(q.why)}</div>
        </div>
      </details>`).join("\n");

const relationsHtml = (book.relations || []).map((r) => `<li style="margin:4px 0"><a href="${esc(r.url)}">${esc(r.title)}</a> <span class="small-note">— ${escAllowB(r.why || "")}</span></li>`).join("\n");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${esc(TITLE)} 机器导读初稿(读书管线自动生成,未经人工审校)。">
<title>读书导读 · ${esc(NAME)} | Agent 学院</title>
<link rel="stylesheet" href="assets/css/style.css?v=${SITE_CSS_VER}">
</head>
<body data-chapter="books">

<header class="topbar">
  <button class="icon-btn hamburger" id="hamburger" title="打开导航">☰</button>
  <a class="brand" href="index.html"><span class="logo">学</span> Agent 学院 <small>从零开发智能体 · Ontology · Harness</small></a>
  <span class="spacer"></span>
  <span class="progress-pill" id="progress-pill">读书 · 机器初稿</span>
  <button class="icon-btn" id="theme-btn">🌙</button>
</header>

<div class="layout">
  <aside class="sidebar" id="sidebar"></aside>

  <main class="content">
    <div class="content-inner">

      <header class="chapter-head">
        <div class="kicker">读书导读 · 机器初稿 · 未审勿发布</div>
        <h1>${esc(TITLE)}<span style="color:var(--warn)">(机器导读初稿)</span></h1>
        <p class="lead">
          ${esc(AUTHORS)}${PAGES ? ` · ${esc(PAGES)} 页` : ""}${PDF_LINK ? ` · <a href="${esc(PDF_LINK)}" target="_blank" rel="noopener">${/\.pdf(\?|$)/i.test(PDF_LINK) ? "原书 PDF" : "原文链接"}</a>` : ""}
          <br><b style="color:var(--warn)">本页由读书管线自动生成,尚未人工审校。</b>
          基于知识库 ${kb.chunks.length} 块(分章摘要 ${chList.length} 章),金句 ${golden.length} 条(全部逐字校验通过)。
        </p>
      </header>

      <div class="callout warn">
        <div class="co-title">人审须知(发布前必读)</div>
        <p>① 补全作者/出版信息;② 抽查金句是否忠于原书语境;③ 审三条阅读路径是否合理;④ 核对「与站内资源」链接;
        ⑤ 通过后运行 publish-book.mjs 发布(建 books.html 条目已自动,挂导航见 REVIEW);⑥ 版权边界:本页只保留提炼与短引用,禁止大段原文。</p>
      </div>

      <h2>这本书是什么</h2>
      <div class="callout key">
        <div class="co-title">${escAllowB(positioning.oneLiner || "")}</div>
        <p>${escAllowB(positioning.problem || "")}</p>
        <p style="margin-bottom:0"><b>写给谁:</b>${escAllowB(positioning.audience || "")}${(positioning.prereqs || []).length ? ` <span class="small-note">读前基础:${positioning.prereqs.map(esc).join(" / ")}</span>` : ""}</p>
      </div>
      ${(book.verdict || "") ? `<div class="callout tip" style="margin-top:10px"><div class="co-title">读不读?</div><p style="margin-bottom:0">${escAllowB(book.verdict)}</p></div>` : ""}

      <h2>核心论点(全书之魂)</h2>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
${coreIdeasHtml}
      </div>

      <h2>全书骨架(章节地图)</h2>
${partsHtml}

      <h2>怎么读(三条路径)</h2>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
${pathCard("快读路径 · 拿核心就走", paths.quick)}
${pathCard("精读路径 · 顺序全读", paths.deep)}
      </div>
      <h3 style="margin:18px 0 8px">问题驱动路径(带着问题直接进)</h3>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
${problemHtml}
      </div>

      <h2>金句摘录(逐字校验,短引用)</h2>
${goldenHtml || '<p class="small-note">(本次未选出金句)</p>'}

      <h2>与站内资源的关系</h2>
      <ul style="margin:0 0 8px;list-style:disc;padding-left:22px">
${relationsHtml || '<li class="small-note">(未发现强关联)</li>'}
      </ul>

      <h2>继续追问这本书</h2>
      <div class="callout info">
        <div class="co-title">导读只回答「读什么、怎么读」;具体问题请到导师模式,答案只来自书中原文与思想</div>
        <p style="margin-bottom:0">
          CLI:<code>cd tutor && node src/tutor.mjs --pack packs/${esc(PACK)}</code><br>
          macOS App:导师模式对话中提问即可(课程菜单切到「读书 · ${esc(TITLE)}」)。导师检索不到的内容会直说「书里没有」,不编造。
        </p>
      </div>

      <p class="small-note" style="margin-top:24px">生成:${new Date().toISOString().slice(0, 10)} · 模型 deepseek-v4-flash · 分章摘要 ${chList.length} 章(失败 ${chList.length - cards.size}) · 金句校验通过 ${verifiedCount}/丢弃 ${dropped}</p>

    </div>
  </main>
</div>

<script src="assets/js/app.js?v=${SITE_VER}"></script>
</body>
</html>
`;

const outPage = join(SITE, `book-${SLUG}.html`);
writeFileSync(outPage, html);

// ---------- 人审清单 ----------
const reviewMd = `# 人审清单 · ${NAME}(读书导读)

- 书: ${TITLE} / ${AUTHORS}
- kb: \`${relative(TUTOR, KB)}\`${CTX ? ` + ctx` : ""}
- 草稿页: \`book-${SLUG}.html\`(已在站点根,**未挂导航**;books.html 动态收录 manifest kind=book 条目)
- 读书导师包: \`tutor/packs/${PACK}/\`(pack.json + system-prompt.md;已存在则本次未覆盖)
- 规模: ${kb.chunks.length} 块 · ${chList.length} 章 · 金句池 ${quotesPool.length}(校验通过 ${verifiedCount}/丢弃 ${dropped})· 模型 deepseek-v4-flash

## 审校要点(导读模板验证点)
1. [ ] **一句话定位/写给谁/读不读**:是否准确、是否有过度演绎
2. [ ] **核心论点 ${((book.coreIdeas || []).length)} 条**:论点是否真是全书之魂,章节回链是否站得住
3. [ ] **全书骨架分部**:分部逻辑是否符合书的实际结构;每章 oneLiner 抽查 3 章
4. [ ] **三条阅读路径**:快读路径 2~4 章是否真能拿到核心;问题驱动的入口是否真实常见
5. [ ] **金句 ${golden.length} 条**:已逐字校验,但需人审「语境是否被误读」
6. [ ] **站内关联**:链接逐一点开验证
7. [ ] **读书导师 pack**:抽查 2 个问题验证「引用章节 + 检索不到就明说」行为

## 发布步骤(审完执行)
1. node scripts/publish-book.mjs --slug ${SLUG}(剥初稿标记,manifest 标记 approved)
2. 导航已含 books.html(读书板块索引,动态渲染);如未挂请检查 app.js NAV
3. node scripts/check-site.mjs 全绿
4. git commit + push
`;
writeFileSync(join(draftDir, "REVIEW.md"), reviewMd);
updateManifest({
  kind: "book", slug: SLUG, title: TITLE, authors: AUTHORS, pages: PAGES, pdf: PDF_LINK,
  quickChapters: (paths.quick?.chapters || []).join(","),
  description: `读书导读(机器初稿):${positioning.oneLiner || ""}`,
  page: `book-${SLUG}.html`, pack: PACK,
  review: `drafts/${SLUG}/REVIEW.md`, generated: true,
});
console.log(`\n✓ 草稿页: ${outPage}`);
console.log(`✓ 章节卡片: ${join(draftDir, "book-cards.json")}`);
console.log(`✓ 人审清单: ${join(draftDir, "REVIEW.md")}`);
console.log("  下一步: 人审 → node scripts/publish-book.mjs --slug " + SLUG);
