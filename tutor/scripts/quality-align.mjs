// 课程质量对齐共享模块:结构 rubric + LLM 升级 pass + 章节页模板与反向解析。
// 被两处共用:
//   make-course-from-topic.mjs —— 生成时逐章对齐(Phase B 之后立即升级)
//   align-course-quality.mjs  —— 存量课程批量对齐(解析旧页 → 升级 → 重写)
// 注意:本模块保持零依赖(不 import pi-ai),llm 一律由调用方注入。

// ---------- HTML 工具(与 make-course-from-topic 原实现一致) ----------
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// 放行 <b> 强调:先转义再恢复(用于 quiz 答案等富文本)
export const escAllow = (s) => esc(s).replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
// 放行有限标签的 HTML 净化器(LLM 输出的章节内容只允许结构与强调标签)
export const ALLOWED = ["b", "strong", "i", "em", "code", "pre", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "br", "p", "h4", "blockquote"];
export function wrapCodeblocks(html) {
  return html.replace(/<pre><code class="language-([\w-]+)">([\s\S]*?)<\/code><\/pre>/g,
    (m, lang, code) => `<div class="codeblock"><div class="code-head"><span class="code-lang">${lang}</span></div><pre><code class="language-${lang}">${code}</code></pre></div>`);
}
export function sanitizeHTML(s) {
  let t = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const tag of ALLOWED) {
    t = t.replaceAll(`&lt;${tag}&gt;`, `<${tag}>`).replaceAll(`&lt;/${tag}&gt;`, `</${tag}>`);
  }
  t = t.replace(/&lt;(pre|code)( class="language-[a-z]+")&gt;/g, "<$1$2>");
  return t;
}
// 全量反转义:把已渲染页面上的 HTML 还原为原始未转义文本(解析旧页用,amp 必须最后处理)
export function unescapeHTML(s) {
  return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
export const parseJSON = (s) => {
  const m = String(s).match(/[[{][\s\S]*[\]}]/);
  if (!m) throw new Error("输出中找不到 JSON");
  return JSON.parse(m[0]);
};

// ---------- 本章一图流(与读书板块同水位线:每章一张 .flow 流程图) ----------
export const FLOW_SYS = `你是技术课讲解员。根据本章目标与要点设计一张「本章一图流」(横向流程),帮读者 10 秒看懂本章逻辑。输出严格 JSON:
{"nodes":[{"t":"节点名(≤10字,可带英文术语)","d":"一句说明(≤18字)"}],"note":"这张图想说明的一件事(≤40字)"}
规则: 3~5 个节点,按本章的论述/执行顺序排列,节点间是推进/反馈关系;不要照抄要点原句,要提炼成图。`;
export function renderFlow(flow) {
  if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length < 2) return "";
  return `<!--flow-v1--><div class="flow">
        ${flow.nodes.map((n) => `<span class="flow-node">${esc(n.t)}<small style="display:block;font-weight:400;font-size:12px;color:var(--text-3)">${esc(n.d || "")}</small></span>`).join(`<span class="flow-arrow">→</span>`)}
        <div class="flow-note">${escAllow(flow.note || "")}</div>
      </div><!--/flow-v1-->`;
}
// callLLM 由调用方注入(本模块保持零依赖);失败返回 null(页面无图,rubric 会点名)
export async function generateFlow({ callLLM, ch }) {
  try {
    const out = parseJSON(await callLLM(FLOW_SYS, `第${ch.no}章 ${ch.title}\n本章目标:${ch.goal || "(无)"}\n要点:${(ch.outline || []).join(";") || "(无)"}`, 1200));
    if (!Array.isArray(out.nodes) || out.nodes.length < 2) return null;
    return { nodes: out.nodes.slice(0, 5), note: out.note || "" };
  } catch { return null; }
}

// ---------- 结构 rubric(静态可查,升级前后共用同一把尺) ----------
// 检查章内容 JSON {sections,misconceptions,quiz,exercise} 是否达到旗舰课程的结构基准。
// 基准对齐主课实测:主课自测 4.0/章、正文 ~11k/章——课题课至少要求 3 题自测、每小节 400 字。
export function structureIssues(res) {
  const issues = [];
  const secs = res.sections || [];
  if (secs.length < 2) issues.push("小节少于 2");
  for (const s of secs) {
    const textLen = String(s.html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    if (textLen < 400) issues.push(`小节「${s.h3}」正文过短(${textLen} 字)`);
  }
  const allHtml = secs.map((s) => s.html || "").join("");
  if (!/<pre[\s>]/.test(allHtml)) issues.push("全章无可运行示例代码");
  else {
    // 判据是 class 属性值里是否含 language-,不是字面量 "language="(那是永远匹配不到的)
    const anyBare = [...allHtml.matchAll(/<pre><code([^>]*)>/g)].some((m) => !/class="[^"]*language-/.test(m[1]));
    if (anyBare) issues.push("代码块缺语言标注");
  }
  if ((res.misconceptions || []).length < 2) issues.push("常见误区不足 2 条");
  if ((res.quiz || []).length < 3) issues.push("自测题不足 3 道");
  const ex = res.exercise || {};
  if (!ex.task || String(ex.task).length < 20) issues.push("练习任务缺失/过简");
  const sol = String(ex.solution || "");
  const solLen = sol.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
  if (solLen < 120) issues.push("练习参考方案过简");
  else if (!/<pre[\s>]/.test(sol)) issues.push("参考方案代码未包 <pre>(渲染会拍平成一行)");
  if ((res.flow?.nodes || []).length < 3) issues.push("缺少本章一图流(≥3 节点)");
  return issues;
}

// ---------- 确定性修复:语言推断 + 裸代码/裸方案补救(不调 LLM,渲染与升级前统一走) ----------
export function guessLang(code) {
  const c = String(code);
  if (/^\s*\$\s|^\s*(curl|pip install|npm|npx|cd|mkdir|export) /m.test(c)) return "bash";
  if (/\b(const|let|function|=>|console\.(log|error))\b/.test(c)) return "javascript";
  if (/^\s*[{[]/.test(c) && /"\s*:/.test(c)) return "json";
  return "python"; // 本站课程代码以 Python 为主,兜底
}
// 裸 <pre><code>(无语言) → 推断语言补 class;JSON 始终保持「生成形态」(不包外壳,渲染时 wrapCodeblocks 统一加)
export function fixCodeLang(html) {
  return String(html).replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (m, code) =>
    `<pre><code class="language-${guessLang(unescapeHTML(code))}">${code}</code></pre>`);
}
// 参考方案若是裸代码文本(无任何标签包裹) → 包进 pre/code,防渲染拍平
export function fixSolutionWrap(solutionHtml) {
  const sol = String(solutionHtml);
  if (/<pre[\s>]/.test(sol) || /<(p|ul|ol|h4|blockquote|table)[\s>]/.test(sol)) return sol;
  const text = sol.replace(/<[^>]+>/g, "").trim();
  if (text.length < 120) return sol;
  return `<pre><code class="language-${guessLang(unescapeHTML(text))}">${sol}</code></pre>`;
}

// ---------- LLM 升级 pass:按旗舰基准重写一章(结构不达标时才值得调) ----------
const UPGRADE_SYS = `你是顶级课程质量审校。给定一章教学初稿(JSON),按旗舰课程《从零开发智能体》的质量基准升级内容,只输出与初稿完全相同结构的 JSON(sections[{h3,html}]/misconceptions/quiz[{q,a}]/exercise{task,solution})。
升级要求:
① 每个小节至少 2-3 段讲解:先直觉/类比,再技术细节;关键结论用 <b>;段落之间要有推进,不是要点罗列;
② 每个抽象概念至少配一个具体例子、数字或前后对比;
③ 全章至少 1 段完整可独立运行的最小示例代码,用 <pre><code class=\\"language-python\\">…</code></pre>(按内容选 python/javascript/bash/json),短小、带注释、可直接运行,代码前后要有文字说明输入与预期输出;
④ 常见误区 2~3 条:每条写清「错误理解 → 会导致什么后果 → 正确做法」;
⑤ 自测 3 道,问题具体,答案给推理过程而不是一句结论;
⑥ 动手练习 1 个:任务明确可验收,参考方案给完整可运行代码,必须包在 <pre><code class=\\"language-…\\"> 里;
⑦ 不改变章节主题与知识点覆盖;不得编造不确定的事实、数字与 API——不确定的内容在句尾加「(待核实)」;
⑧ html 只允许标签 p/b/strong/i/em/ul/ol/li/code/pre/table/thead/tbody/tr/th/td/blockquote/h4/br。`;
export async function upgradeChapter(llm, { courseTitle, ch, res, feedback = "" }) {
  const before = structureIssues(res);
  if (!before.length) return { res, before, after: before, changed: false, note: "已达标" };
  const user = `课程: ${courseTitle}\n本章: 第${ch.no}章 ${ch.title}\n本章目标: ${ch.goal || "(无)"}\n本章要点: ${(ch.outline || []).join(";") || "(无)"}\n\n初稿 JSON:\n${JSON.stringify(res)}` +
    (feedback ? `\n\n用户改进意见(必须落实): ${feedback}` : "");
  try {
    const raw = await llm(UPGRADE_SYS, user, 8000);
    const next = parseJSON(raw);
    const ok = Array.isArray(next.sections) && next.sections.length > 0 &&
      Array.isArray(next.misconceptions) && Array.isArray(next.quiz) && next.exercise;
    if (!ok) throw new Error("升级输出结构不完整");
    // 确定性修复 LLM 输出(裸代码补语言/裸方案包 pre),再统一过尺
    next.sections = (next.sections || []).map((s) => ({ ...s, html: fixCodeLang(s.html || "") }));
    if (next.exercise) next.exercise.solution = fixSolutionWrap(fixCodeLang(String(next.exercise.solution || "")));
    next.flow = next.flow || res.flow || await generateFlow({ callLLM: llm, ch });
    const after = structureIssues(next);
    if (after.length > before.length) return { res, before, after, changed: false, note: `升级后问题变多(${before.length}→${after.length}),保留初稿` };
    return { res: next, before, after, changed: true };
  } catch (e) {
    return { res, before, after: before, changed: false, note: "升级失败保留初稿: " + e.message };
  }
}

// ---------- 质量门禁:课程级聚合(生成/发布/体检三处共用同一把尺) ----------
// items: [{no, title, issues: string[]}] → 全部章节零问题才放行
export function gateChapters(items) {
  const failing = items.filter((i) => (i.issues || []).length > 0);
  return {
    pass: failing.length === 0,
    total: items.length,
    clean: items.length - failing.length,
    failing,
  };
}

// ---------- 章节页正文模板(与 make-course-from-topic 的 chapterPageBody 一致) ----------
// 代码块必须包上站内 .codeblock 外壳(否则无深色样式、无 ⚡/复制按钮)——历史教训:重写丢 wrap 调用
export function chapterPageBody({ ch, res }) {
  const secs = res.sections || [];
  const misc = res.misconceptions || [];
  const quiz = res.quiz || [];
  const ex = res.exercise || { task: "(缺失)", solution: "(缺失)" };
  return `
      <header class="chapter-head">
        <div class="kicker">CHAPTER ${String(ch.no).padStart(2, "0")} · 机器初稿 · 待人审</div>
        <h1>${esc(ch.title)}</h1>
        <p class="lead"><b>本章目标：</b>${esc(ch.goal)}</p>
      </header>
${renderFlow(res.flow)}
${secs.map((s) => ` <h3>${esc(s.h3)}</h3>\n ${wrapCodeblocks(sanitizeHTML(s.html))}`).join("\n")}
 <h3>常见误区</h3>
 <ul>
${misc.map((m) => `  <li>${escAllow(m)}</li>`).join("\n")}
 </ul>
 <h3>自测</h3>
${quiz.map((q) => ` <details class="quiz"><summary>${esc(q.q)}</summary><div class="quiz-body"><p><span class="ans-label">答案：</span>${escAllow(q.a)}</p></div></details>`).join("\n")}
 <h3>动手练习（带参考方案）</h3>
 <details class="fold"><summary>练习 · ${esc(String(ex.task).slice(0, 60))}…</summary><div class="fold-body"><p><b>任务：</b>${escAllow(ex.task)}</p><p><b>参考方案：</b></p>${wrapCodeblocks(sanitizeHTML(ex.solution))}</div></details>`;
}

// ---------- 反向解析:从已渲染章节页还原内容 JSON(仅适配上面模板的产物) ----------
// 页面上的小节 HTML 是「渲染形态」:带 .codeblock 外壳 div、实体已转义。
// 必须归一化回「生成形态」(裸标签+真实字符)再交给 LLM/结构检查,
// 否则重组时的二次净化会把外壳 div 拍成转义文本、把实体双重转义。
function normalizeSectionHtml(html) {
  return unescapeHTML(String(html)).replace(
    /<div class="codeblock"><div class="code-head"><span class="code-lang">[\w-]+<\/span><\/div>(<pre><code class="language-[\w-]+">[\s\S]*?<\/code><\/pre>)<\/div>/g,
    "$1");
}
export function parseChapterBody(body) {
  const headerEnd = body.indexOf("</header>");
  const secEnd = body.indexOf("<h3>常见误区</h3>");
  const quizIdx = body.indexOf("<h3>自测</h3>");
  const exIdx = body.indexOf("<h3>动手练习");
  if (headerEnd < 0 || secEnd < 0 || quizIdx < 0 || exIdx < 0) throw new Error("页面不是标准章节模板");
  const secHtml = body.slice(headerEnd + "</header>".length, secEnd);
  const h3re = /<h3>([\s\S]*?)<\/h3>/g;
  const marks = [];
  let m;
  while ((m = h3re.exec(secHtml))) marks.push({ h3: unescapeHTML(m[1]), start: m.index, end: m.index + m[0].length });
  const sections = marks.map((p, i) => ({
    h3: p.h3,
    html: fixCodeLang(normalizeSectionHtml(secHtml.slice(p.end, i + 1 < marks.length ? marks[i + 1].start : secHtml.length).trim())),
  }));
  const miscRaw = body.slice(secEnd + "<h3>常见误区</h3>".length, quizIdx);
  const misconceptions = [...miscRaw.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => unescapeHTML(x[1]));
  const quizRaw = body.slice(quizIdx + "<h3>自测</h3>".length, exIdx);
  const quiz = [...quizRaw.matchAll(/<details class="quiz"><summary>([\s\S]*?)<\/summary><div class="quiz-body"><p><span class="ans-label">答案：<\/span>([\s\S]*?)<\/p><\/div><\/details>/g)]
    .map((x) => ({ q: unescapeHTML(x[1]), a: unescapeHTML(x[2]) }));
  const exRaw = body.slice(exIdx);
  let exercise = { task: "(缺失)", solution: "(缺失)" };
  const fold = exRaw.match(/<details class="fold"><summary>[\s\S]*?<\/summary><div class="fold-body">([\s\S]*?)<\/div><\/details>/);
  if (fold) {
    const task = fold[1].match(/<p><b>任务：<\/b>([\s\S]*?)<\/p>/);
    const sol = fold[1].match(/<p><b>参考方案：<\/b><\/p>([\s\S]*)$/);
    if (task) exercise.task = unescapeHTML(task[1]);
    if (sol) exercise.solution = fixSolutionWrap(fixCodeLang(normalizeSectionHtml(sol[1])));
  }
  const flowMatch = body.match(/<!--flow-v1-->([\s\S]*?)<!--\/flow-v1-->/);
  let flow = null;
  if (flowMatch) {
    try {
      const nodes = [...flowMatch[1].matchAll(/<span class="flow-node">([^<]*)<small[^>]*>([\s\S]*?)<\/small>/g)]
        .map((x) => ({ t: unescapeHTML(x[1]), d: unescapeHTML(x[2]) }));
      const note = (flowMatch[1].match(/<div class="flow-note">([\s\S]*?)<\/div>/) || [])[1];
      if (nodes.length) flow = { nodes, note: unescapeHTML(note || "").trim() };
    } catch { /* flow 解析失败按无图处理 */ }
  }
  return { sections, misconceptions, quiz, exercise, flow };
}
