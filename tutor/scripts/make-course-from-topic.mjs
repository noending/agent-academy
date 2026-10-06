#!/usr/bin/env node
// M3 内容工厂终极形态:学习课题 → 自动生成整门课程(教学包 + 站点草稿页)。
// 用法:
//   node scripts/make-course-from-topic.mjs --topic "LLM 从训练到实际部署" --skill llm-deploy [--chapters 8] [--goal "..."]
// 产出:
//   kb/<skill>-kb.json              课程内容切块(导师可检索自己这门课)
//   packs/<skill>/                  教学包(pack.json + system-prompt + REVIEW.md)
//   full-<skill>.html               站点草稿页(不挂导航,待人审)
// ⚠️ 诚实边界:章节内容由模型知识生成、无外部引用——REVIEW.md 要求逐条核实事实。
//    若有权威素材(PDF/仓库),请用 M1/M2 管线代替,或等 --sources 接地能力。
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { updateManifest } from "./factory-common.mjs";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
// 动态取站点当前缓存版本(避免生成页与全站版本漂移)
const SITE_VER = (readFileSync(join(SITE, "index.html"), "utf8").match(/app\.js\?v=(\d+)/) || [])[1] || "22";
const MODEL = getModel("deepseek", "deepseek-v4-flash");
const KEY = process.env.DEEPSEEK_API_KEY;

const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const TOPIC = argOf("--topic");
const SKILL = argOf("--skill");
const GOAL = argOf("--goal") || `系统掌握「${TOPIC}」,从基础概念到实际落地`;
const FEEDBACK = argOf("--feedback") || "";
const N_CH = Math.min(10, Math.max(4, parseInt(argOf("--chapters") || "8", 10)));

if (!TOPIC || !SKILL || !/^[a-z0-9-]+$/.test(SKILL)) {
  console.error("✗ 用法: --topic \"课题\" --skill <slug> [--chapters 8] [--goal \"...\"]");
  process.exit(1);
}
if (!KEY) { console.error("✗ 缺少 DEEPSEEK_API_KEY"); process.exit(1); }
if (existsSync(join(TUTOR, "packs", SKILL))) {
  if (!FEEDBACK) { console.error(`✗ packs/${SKILL} 已存在(换 slug,或加 --feedback 表示按意见重新生成)`); process.exit(1); }
  console.log("→ 检测到旧版本,按改进意见重新生成…");
  rmSync(join(TUTOR, "packs", SKILL), { recursive: true, force: true });
  rmSync(join(TUTOR, "kb", `${SKILL}-kb.json`), { force: true });
  rmSync(join(SITE, `full-${SKILL}.html`), { force: true });
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// 放行有限标签的 HTML 净化器(LLM 输出的章节内容只允许结构与强调标签)
const ALLOWED = ["b", "strong", "i", "em", "code", "pre", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "br", "p", "h4", "blockquote"];
function sanitizeHTML(s) {
  let t = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const tag of ALLOWED) {
    t = t.replaceAll(`&lt;${tag}&gt;`, `<${tag}>`).replaceAll(`&lt;/${tag}&gt;`, `</${tag}>`);
  }
  t = t.replace(/&lt;(pre|code)( class="language-[a-z]+")&gt;/g, "<$1$2>");
  return t;
}
const parseJSON = (s) => {
  const m = String(s).match(/[[{][\s\S]*[\]}]/);
  if (!m) throw new Error("输出中找不到 JSON");
  return JSON.parse(m[0]);
};
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
async function pool(items, worker, n = 4) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
  }));
}

// ---------- Phase A: 课程大纲 ----------
console.log(`→ Phase A · 规划课程大纲: ${TOPIC}`);
const PLAN_SYS = `你是顶级课程设计师。为学习课题设计一门 ${N_CH} 章的系统课程(从基础概念到实际落地,由浅入深)。
输出严格 JSON:
{"title":"课程名(中文,10字内)","description":"课程简介(80字内:适合谁/学到什么)","chapters":[{"no":1,"title":"章标题(中文)","goal":"学完能做什么(30字内)","outline":["要点1","要点2","要点3","要点4"],"keyTerms":["关键术语(中英对照)"],"questions":["学员学本章时最可能问的3个问题(中文)"]}],"starterQuestions":["学员最可能问的4个问题"]}
质量基准(对标本平台旗舰课程《Agent 学院》): 每章必须有可运行的最小示例、明确的常见误区、可自测的练习;讲解口语化但技术准确;由浅入深不跳步。
${FEEDBACK ? `用户对上一版的改进意见(必须逐条落实到本次生成):\n${FEEDBACK}` : ""}
规则: 章节由浅入深,最后 1-2 章必须是动手实战/部署落地;每章 outline 4 条、questions 恰好 3 个;只输出 JSON。`;
const planRaw = await llm(PLAN_SYS, `课题: ${TOPIC}\n学习目标: ${GOAL}\n章节数: ${N_CH}`, 5000);
const plan = parseJSON(planRaw);
console.log(`  《${plan.title}》 ${plan.chapters.length} 章`);

// ---------- Phase B: 逐章生成 ----------
console.log("→ Phase B · 逐章生成内容…");
const CH_SYS = `你是这门课的讲师,为指定章节生成完整教学内容。输出严格 JSON:
{"sections":[{"h3":"小节标题","html":"小节正文(HTML: 只允许 p/b/strong/i/em/ul/ol/li/code/pre/table/tr/td/th/blockquote;代码一律 <pre><code class=\\"language-python\\">…</code></pre>)"}],"misconceptions":["常见误区1","…"],"quiz":[{"q":"自测题","a":"参考答案"}],"exercise":{"task":"动手练习任务","solution":"参考方案(可用代码)"}}
质量基准(对标旗舰课程): 讲解=先直觉类比再技术细节;每个抽象概念配一个具体例子;关键结论用 <b>;代码短小可独立运行。
${FEEDBACK ? `用户改进意见(本章相关部分必须落实): ${FEEDBACK}` : ""}
规则:
- 2~4 个小节;讲解口语化但准确,关键结论用 <b>;每章至少 1 个可运行的最小示例代码;
- misconception 2~3 条;quiz 2 题;exercise 1 个带完整参考方案;
- 只输出 JSON。`;
const chapterResults = new Array(plan.chapters.length).fill(null);
await pool(plan.chapters, async (ch, idx) => {
  try {
    const raw = await llm(CH_SYS,
      `课程: ${plan.title}(${plan.description})\n本章: 第${ch.no}章 ${ch.title}\n本章目标: ${ch.goal}\n本章要点: ${ch.outline.join(";")}\n关键术语: ${(ch.keyTerms || []).join(";")}`, 6000);
    chapterResults[idx] = parseJSON(raw);
    console.log(`  ✓ 第${ch.no}章 ${ch.title}`);
  } catch (e) {
    console.log(`  ✗ 第${ch.no}章生成失败: ${e.message}`);
  }
}, 3);
const okChapters = plan.chapters.map((ch, i) => ({ ch, res: chapterResults[i] })).filter((x) => x.res);

// ---------- Phase C: 组装产物 ----------
console.log("→ Phase C · 组装教学包与站点草稿…");
const packDir = join(TUTOR, "packs", SKILL);
mkdirSync(packDir, { recursive: true });

// 知识库:每章内容切块入库(导师可检索自己这门课)
const chunks = [];
let cid = 0;
for (const { ch, res } of okChapters) {
  const chapterText = res.sections
    .map((s) => `## ${s.h3}\n${s.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`)
    .join("\n\n") + "\n\n## 常见误区\n" + res.misconceptions.join(";") +
    "\n\n## 自测与练习\n" + res.quiz.map((q) => `问: ${q.q}\n答: ${q.a}`).join("\n");
  for (let off = 0; off < chapterText.length; off += 1400) {
    const piece = chapterText.slice(off, off + 1400);
    if (piece.trim().length < 80) continue;
    chunks.push({
      id: `${SKILL}-c${String(cid++).padStart(3, "0")}`,
      source: SKILL, chapter: ch.no, chapterTitle: plan.title,
      title: `第${ch.no}章 ${ch.title}`,
      chars: piece.length, text: piece,
      generated: true, // 模型知识生成,无外部引用——审校标记
    });
  }
}
writeFileSync(join(TUTOR, "kb", `${SKILL}-kb.json`), JSON.stringify({
  meta: { builtAt: new Date().toISOString(), source: `课题生成: ${TOPIC}`, chunkCount: chunks.length, generated: true },
  chunks,
}, null, 1));

// system-prompt.md(教学法模板复用 + 明示"内容为模型知识生成")
const basePrompt = readFileSync(join(TUTOR, "packs", "agent-dev", "system-prompt.md"), "utf8");
const domainPrompt = basePrompt.replace(
  /你是「Agent 学院」的私人导师[\s\S]*?(?=\n# 当前学生档案)/,
  `你是课程《${plan.title}》的私人导师。你的唯一使命:让学员**真正理解**${TOPIC}的核心能力,而不是听过、背过、能复述。"真正理解"的检验标准只有一个:学员能**用自己的话解释、举出正确的例子、预测新情境下的行为**。

你的知识库:本教学包专属知识库,通过 lookup_course 检索——**注意:知识库内容是模型知识生成、无外部引用**,引用时提示学生"此内容待核实"。发现知识库错误应如实指出并给权威来源建议,不要硬编。

课程主线(教学顺序):
${plan.chapters.map((c) => `${c.no}. ${c.title} — ${c.goal}`).join("\n")}

# 领域教学要点

${(plan.tips || []).map((t, i) => `${i + 1}. ${t}`).join("\n") || "(无)"}`
);
writeFileSync(join(packDir, "system-prompt.md"), domainPrompt);

writeFileSync(join(packDir, "pack.json"), JSON.stringify({
  name: SKILL,
  title: plan.title,
  kb: `kb/${SKILL}-kb.json`,
  sources: [{ file: `kb/${SKILL}-kb.json`, source: SKILL, label: plan.title }],
  model: { provider: "deepseek", id: "deepseek-flash" },
  thinkingLevel: "off",
  description: `由课题「${TOPIC}」自动生成。${plan.description}`,
  curriculum: plan.chapters,
  starterQuestions: plan.starterQuestions || [],
  generated: true,
}, null, 2));

// 站点草稿页
const chapterHtml = okChapters.map(({ ch, res }) => {
  const sections = res.sections.map((s) => ` <h3>${esc(s.h3)}</h3>\n ${sanitizeHTML(s.html)}`).join("\n");
  const misc = res.misconceptions.map((m) => ` <li>${escAllow(m)}</li>`).join("\n");
  const quiz = res.quiz.map((q) => ` <details class="quiz"><summary>${esc(q.q)}</summary><div class="quiz-body"><p><span class="ans-label">答案：</span>${escAllow(q.a)}</p></div></details>`).join("\n");
  const ex = ` <details class="fold"><summary>动手练习 · ${esc(res.exercise.task.slice(0, 50))}…</summary><div class="fold-body"><p><b>任务：</b>${escAllow(res.exercise.task)}</p><p><b>参考方案：</b></p>${sanitizeHTML(res.exercise.solution)}</div></details>`;
  return `\n <h2>第${ch.no}章 · ${esc(ch.title)}</h2>
 <p><b>本章目标：</b>${esc(ch.goal)}</p>
${sections}
 <h3>常见误区</h3>
 <ul>
${misc}
 </ul>
 <h3>自测</h3>
${quiz}
 <h3>动手练习（带参考方案）</h3>
${ex}`;
}).join("\n");

function escAllow(s) { return escAllowHTML(s); }
function escAllowHTML(s) {
  let t = esc(s);
  for (const tag of ["b", "i", "code"]) {
    t = t.replaceAll(`&lt;${tag}&gt;`, `<${tag}>`).replaceAll(`&lt;/${tag}&gt;`, `</${tag}>`);
  }
  return t;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="课题「${esc(TOPIC)}」自动生成课程(机器初稿,未经人工审校)。">
<title>课题课程 · ${esc(plan.title)} | Agent 学院</title>
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
        <div class="kicker">课题生成课程 · 机器初稿 · 未审勿发布</div>
        <h1>${esc(plan.title)}<span style="color:var(--warn)">(机器初稿)</span></h1>
        <p class="lead">
          课题:「${esc(TOPIC)}」 · 学习目标: ${esc(GOAL)}
          <br><b style="color:var(--warn)">本课程由内容工厂按课题自动生成,章节内容来自模型知识、无外部引用——发布前必须逐条核实事实。</b>
          共 ${okChapters.length} 章;配套导师: <code>node tutor/src/tutor.mjs --pack packs/${SKILL}</code>
        </p>
      </header>

      <div class="draft-only">
      <style>
        .draft-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:18px 0; padding:12px; border:2px dashed var(--warn); border-radius:12px; background:var(--warn-soft); }
        .draft-toolbar .draft-feedback { flex:1; min-width:220px; padding:7px 12px; border:1px solid var(--line); border-radius:8px; font-size:13.5px; background:var(--surface); color:var(--text); }
        .dt-btn { padding:6px 12px; border-radius:8px; border:1px solid var(--line); background:var(--surface); color:var(--text); font-size:13px; cursor:pointer; }
        .dt-btn.dt-improve { background:var(--accent); color:#fff; border-color:transparent; }
        .dt-btn.dt-approve { background:var(--ok); color:#fff; border-color:transparent; }
        .dt-btn.dt-delete { color:var(--danger); border-color:var(--danger); }
        .dt-msg { font-size:12.5px; color:var(--text-2); }
      </style>
      <div class="draft-toolbar" data-skill="${SKILL}" data-topic="${esc(TOPIC)}" data-chapters="${okChapters.length}">
        <input type="text" class="draft-feedback" placeholder="输入改进意见,如:第 3 章加一个量化对比示例…">
        <button class="dt-btn dt-improve">🔁 按意见重新生成</button>
        <button class="dt-btn dt-approve">✅ 审核通过</button>
        <button class="dt-btn dt-delete">🗑 删除草稿</button>
        <span class="dt-msg"></span>
      </div>
      <div class="callout warn">
        <div class="co-title">人审须知(发布前必读)</div>
        <p>① 逐章核实事实与代码可运行性(模型知识可能过时或有错);② 补充权威引用与延伸阅读;③ 审核通过会自动移除本工具条与全部初稿标记;
        ④ 通过后建议加入 index.html 学习路径;⑤ 发布即代表确认内容质量由发布者负责。</p>
      </div>
      </div>
      <script>
      (function () {
        const bar = document.querySelector(".draft-toolbar");
        if (!bar) return;
        const skill = bar.dataset.skill, topic = bar.dataset.topic, chapters = bar.dataset.chapters;
        const go = (cmd, params) => {
          const qs = new URLSearchParams(params || {}).toString();
          location.href = "academy://" + cmd + "/" + skill + (qs ? "?" + qs : "");
        };
        bar.querySelector(".dt-improve").addEventListener("click", () => {
          const fb = bar.querySelector(".draft-feedback").value.trim();
          if (!fb) { bar.querySelector(".dt-msg").textContent = "请先输入改进意见"; return; }
          if (!confirm("按意见重新生成整门课?当前草稿将被替换(约 2-4 分钟)。")) return;
          go("improve-course", { feedback: fb, topic: topic, chapters: chapters });
        });
        bar.querySelector(".dt-approve").addEventListener("click", () => {
          if (!confirm("审核通过并发布?将自动移除初稿标记与工具条。")) return;
          go("publish-course", {});
        });
        bar.querySelector(".dt-delete").addEventListener("click", () => {
          if (!confirm("删除草稿?教学包、知识库与本页将一并删除,不可恢复。")) return;
          go("delete-course", {});
        });
      })();
      </script>
${chapterHtml}

    </div>
  </main>
</div>

<script src="assets/js/app.js?v=${SITE_VER}"></script>
</body>
</html>
`;
const outPage = join(SITE, `full-${SKILL}.html`);
writeFileSync(outPage, html);

updateManifest({
  kind: "topic", slug: SKILL, title: plan.title, description: plan.description,
  pack: `packs/${SKILL}`, page: `full-${SKILL}.html`, topic: TOPIC,
  chapters: plan.chapters.map((c) => ({ no: c.no, title: c.title, goal: c.goal, questions: c.questions || [] })),
  starterQuestions: plan.starterQuestions || [], generated: true,
});
writeFileSync(join(packDir, "REVIEW.md"), `# 人审清单 · 课题生成课程 ${SKILL}

- 课题: ${TOPIC}
- 课程: ${plan.title}(${okChapters.length} 章)
- 知识库: kb/${SKILL}-kb.json(${chunks.length} 块,全部为模型知识生成)
- 草稿页: full-${SKILL}.html(站点根,未挂导航)
- ⚠️ 特别警告: 本课程内容来自模型知识、无外部引用——**每一处事实、数字、代码都需要核实**。有权威素材请改用 M1/M2 管线重新生成。

## 审校要点
1. [ ] 大纲与章序是否合理
2. [ ] 逐章核实事实/数字/代码(运行每段示例代码)
3. [ ] 自测题与练习是否可解、答案正确
4. [ ] 补充权威引用(教材章节/文档链接/论文)
5. [ ] 删除全部「机器初稿/待审」字样与页内人审须知

## 发布步骤
1. full-${SKILL}.html 加入 index.html 学习路径 + app.js NAV
2. node scripts/check-site.mjs 全绿
3. git commit + push
`);

console.log(`\n✓ 教学包: packs/${SKILL}/`);
console.log(`✓ 知识库: kb/${SKILL}-kb.json(${chunks.length} 块)`);
console.log(`✓ 站点草稿: full-${SKILL}.html(${okChapters.length} 章)`);
console.log(`\n  试教: node src/tutor.mjs --pack packs/${SKILL}`);
console.log(`  ⚠️ 内容为模型知识生成——REVIEW.md 的核实清单必须走完`);
