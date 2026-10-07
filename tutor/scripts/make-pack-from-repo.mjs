#!/usr/bin/env node
// M2 内容工厂:GitHub 仓库(或本地目录) → 自动生成教学包,导师立即可教。
// 用法:
//   node scripts/make-pack-from-repo.mjs --repo mlabonne/llm-course --skill llm-course [--goal "从训练到部署学透 LLM"]
//   node scripts/make-pack-from-repo.mjs --dir /path/to/repo --skill my-course
// 产出:
//   kb/<skill>-kb.json                        该仓库内容切块(导师知识源)
//   packs/<skill>/pack.json                   教学包(知识源 + 课程大纲 + 起步问题)
//   packs/<skill>/system-prompt.md            教学法(复用 agent-dev 模板 + 领域要点)
//   packs/<skill>/REVIEW.md                   人审清单
// 原则: 教学法是模板,领域知识是素材——规划器只做"结构化",不编造内容(引用可溯源)。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname, resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { updateManifest } from "./factory-common.mjs";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = getModel("deepseek", "deepseek-v4-flash");
const KEY = process.env.DEEPSEEK_API_KEY;
const CONCURRENCY = 6;
const MAX_TOTAL_CHARS = 500_000; // 摄取上限:保护成本与上下文
const CHUNK_CHARS = 1200;

const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const REPO = argOf("--repo");       // owner/name 或完整 GitHub 链接
const DIR = argOf("--dir");         // 或本地目录
const SKILL = argOf("--skill");
const GOAL = argOf("--goal") || "";

if (!SKILL || !/^[a-z0-9-]+$/.test(SKILL)) { console.error("✗ --skill 必须是小写字母/数字/连字符"); process.exit(1); }

// 仓库输入解析: 支持 owner/name 与各种 GitHub 链接(…/tree/<branch>、.git 后缀、SSH)
function parseRepoInput(input) {
  const s = String(input).trim().replace(/\.git$/, "");
  let m = s.match(/(?:github\.com[/:]|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\/tree\/([\w.-]+))?$/);
  if (m) return { owner: m[1], name: m[2], branch: m[3] || null };
  m = s.match(/^([\w.-]+)[\\/]?([\w.-]+)$/);
  if (m && !s.includes("/") && !s.includes("\\")) return null;
  m = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (m) return { owner: m[1], name: m[2], branch: null };
  return null;
}
const repoInfo = REPO ? parseRepoInput(REPO) : null;
if (REPO && !repoInfo) { console.error("✗ 无法解析仓库:支持 owner/name 或 GitHub 链接(…/tree/<branch>)"); process.exit(1); }
if (!KEY) { console.error("✗ 缺少 DEEPSEEK_API_KEY"); process.exit(1); }
if (existsSync(join(TUTOR, "packs", SKILL))) { console.error(`✗ packs/${SKILL} 已存在,换一个 --skill`); process.exit(1); }

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const parseJSON = (s) => {
  const m = String(s).match(/[[{][\s\S]*[\]}]/);
  if (!m) throw new Error("输出中找不到 JSON");
  return JSON.parse(m[0]);
};
async function llm(system, user, maxTokens = 3000) {
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

// ---------- 第 1 步:摄取 ----------
console.log("→ 摄取仓库内容…");
let srcDir;
let repoLabel;
if (DIR) {
  srcDir = resolve(DIR);
  repoLabel = basename(srcDir);
  if (!existsSync(srcDir)) { console.error("✗ --dir 不存在"); process.exit(1); }
} else {
  repoLabel = repoInfo.name;
  let branch = repoInfo.branch;
  try {
    const meta = execFileSync("curl", ["-sL", "--max-time", "30", `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.name}`], { encoding: "utf8" });
    branch = JSON.parse(meta).default_branch || branch || "main";
  } catch { console.log("  (取默认分支失败,按 main 尝试)"); }
  const tmp = mkdtempSync("/tmp/pack-ingest-");
  const zip = join(tmp, "repo.zip");
  execFileSync("curl", ["-sL", "--max-time", "300", "-o", zip, `https://codeload.github.com/${repoInfo.owner}/${repoInfo.name}/zip/refs/heads/${branch}`]);
  srcDir = join(tmp, "repo");
  execFileSync("unzip", ["-q", zip, "-d", tmp]);
  const entries = readdirSync(tmp).filter((d) => d.startsWith(repoInfo.name + "-"));
  srcDir = join(tmp, entries[0]);
  console.log(`  已下载 ${repoInfo.owner}/${repoInfo.name}@${branch}`);
}

// 收集候选文件:markdown + notebook(docs 优先),跳过依赖/构建目录
const SKIP_DIRS = /node_modules|\.git|dist|build|vendor|__pycache__|\.venv|site-packages/i;
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.test(f)) walk(p, out); continue; }
    const ext = extname(f).toLowerCase();
    if (ext === ".md" || ext === ".markdown" || ext === ".ipynb") out.push(p);
  }
  return out;
}
const SKIP_FILES = /license|contributing|code_of_conduct|security/i;
let files = walk(srcDir).filter((p) => !SKIP_FILES.test(basename(p).toLowerCase()));
// 根目录 README 优先排序
files.sort((a, b) => (basename(a).toLowerCase() === "readme.md" ? -1 : 0) - (basename(b).toLowerCase() === "readme.md" ? -1 : 0));

function extractText(p) {
  if (extname(p).toLowerCase() === ".ipynb") {
    try {
      const nb = JSON.parse(readFileSync(p, "utf8"));
      return (nb.cells || [])
        .map((c) => {
          const src = Array.isArray(c.source) ? c.source.join("") : c.source;
          return c.cell_type === "markdown" ? src : "```python\n" + src + "\n```";
        })
        .join("\n\n");
    } catch { return ""; }
  }
  return readFileSync(p, "utf8");
}

let total = 0;
const docs = [];
for (const p of files) {
  if (total >= MAX_TOTAL_CHARS) break;
  const text = extractText(p).trim();
  if (text.length < 200) continue;
  const clipped = text.slice(0, Math.max(0, MAX_TOTAL_CHARS - total));
  total += clipped.length;
  docs.push({ file: p.replace(srcDir + "/", ""), title: basename(p).replace(/\.md$|\.ipynb$/i, ""), text: clipped });
}
if (!docs.length) { console.error("✗ 没有摄取到有效内容(需要 .md/.ipynb)"); process.exit(1); }
console.log(`  ${docs.length} 个文档,${total} 字符`);

// ---------- 第 2 步:切块 ----------
const chunks = [];
let cid = 0;
for (const doc of docs) {
  let cur = "";
  for (const para of doc.text.split(/\n\n+/)) {
    if (cur && (cur + "\n\n" + para).length > CHUNK_CHARS) {
      chunks.push({ id: `${SKILL}-c${String(cid++).padStart(3, "0")}`, file: doc.file, title: doc.title, text: cur.trim() });
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + para;
  }
  if (cur.trim().length > 80) chunks.push({ id: `${SKILL}-c${String(cid++).padStart(3, "0")}`, file: doc.file, title: doc.title, text: cur.trim() });
  if (chunks.length > 400) break; // 安全上限
}
console.log(`  → ${chunks.length} 个知识块`);

// ---------- 第 3 步:LLM 课程规划 ----------
console.log("→ LLM 规划课程大纲…");
const PLANNER_SYS = `你是课程规划器。根据仓库内容(文件清单 + 知识块索引)和学习目标,把它规划成一门可被导师讲授的课程。
输出严格 JSON:
{"title":"课程名(中文)","repoSummary":"这个仓库是什么、适合谁、学到什么(80字内)","chapters":[{"no":1,"title":"章标题(中文)","goal":"这一章学完学员能做到什么(30字内)","chunkIds":["引用真实块id","…"],"questions":["基于本章内容,学员最可能问的3个问题(中文)"]}],"starterQuestions":["学员最可能问的4个问题(中文)"]}
规则:
- 章节 5~10 章,由浅入深覆盖仓库核心内容;每章 chunkIds 必须引用给定的真实块 id(可跨文件),不许编造;
- 每章 questions 恰好 3 个,必须基于该章引用的块内容,学员视角、具体可答;
- 学习目标: ${GOAL || "(未指定,按仓库内容设计完整学习路径)"};
- starterQuestions 4 个,覆盖入门/核心/进阶。只输出 JSON。`;
const chunkIndex = chunks.map((c) => `${c.id} [${c.file}] ${c.title}: ${c.text.slice(0, 110).replace(/\n/g, " ")}`).join("\n");
const fileList = docs.map((d) => d.file).join("\n");
const planRaw = await llm(PLANNER_SYS, `文件清单:\n${fileList}\n\n知识块索引:\n${chunkIndex}`, 6000);
const plan = parseJSON(planRaw);
const planChunks = new Set(chunks.map((c) => c.id));
const usedIds = new Set(plan.chapters.flatMap((ch) => ch.chunkIds || []));
const valid = [...usedIds].filter((id) => planChunks.has(id));
console.log(`  规划 ${plan.chapters.length} 章 · 引用块 ${valid.length}/${chunks.length}`);

// ---------- 第 4 步:生成教学包 ----------
console.log("→ 生成教学包…");
const packDir = join(TUTOR, "packs", SKILL);
mkdirSync(packDir, { recursive: true });

// 知识库:保留全部块,但给被规划引用的块标注章节(未引用的块仍可被检索到)
const chapterOf = new Map();
for (const ch of plan.chapters) for (const id of ch.chunkIds || []) {
  if (planChunks.has(id)) chapterOf.set(id, ch.no);
}
const kbChunks = chunks.map((c) => ({
  id: c.id,
  source: SKILL,
  chapter: chapterOf.get(c.id) ?? 0,
  chapterTitle: plan.title,
  title: `${c.title}(${c.file})`,
  chars: c.text.length,
  text: c.text,
}));
writeFileSync(join(TUTOR, "kb", `${SKILL}-kb.json`), JSON.stringify({
  meta: { builtAt: new Date().toISOString(), source: REPO || DIR, chunkCount: kbChunks.length, contextualized: false },
  chunks: kbChunks,
}, null, 1));

// 领域教学要点(让导师的提示词带上领域专家经验)
const tipsRaw = await llm(
  "你是教学设计专家。针对这门课程,列出 4 条领域专属的教学要点(学员常见误区/易混概念/动手建议)。输出严格 JSON:{\"tips\":[\"…\"]}。只输出 JSON。",
  `课程: ${plan.title}\n大纲:\n${plan.chapters.map((c) => `${c.no}. ${c.title} — ${c.goal}`).join("\n")}\n仓库概要: ${plan.repoSummary}`,
  1500);
let tips = [];
try { tips = parseJSON(tipsRaw).tips || []; } catch { tips = []; }

// system-prompt.md:复用 agent-dev 教学法模板——替换「角色」段(使命 + 知识库 + 主线)为生成课程的版本
const basePrompt = readFileSync(join(TUTOR, "packs", "agent-dev", "system-prompt.md"), "utf8");
const domainPrompt = basePrompt.replace(
  /你是「Agent 学院」的私人导师[\s\S]*?(?=\n# 当前学生档案)/,
  `你是课程《${plan.title}》的私人导师。你的唯一使命:让学员**真正理解**这门课的核心能力,而不是听过、背过、能复述。"真正理解"的检验标准只有一个:学员能**用自己的话解释、举出正确的例子、预测新情境下的行为**。

你的知识库:本教学包专属知识库,通过 lookup_course 检索。${plan.repoSummary}
引用时标注来源(《${plan.title}》+ 文件名)。知识库里没有的内容不要编造,可作通用补充但要明说。

课程主线(教学顺序):
${plan.chapters.map((c) => `${c.no}. ${c.title} — ${c.goal}`).join("\n")}

# 领域教学要点

${tips.map((t, i) => `${i + 1}. ${t}`).join("\n")}
`
);
writeFileSync(join(packDir, "system-prompt.md"), domainPrompt);

// pack.json
const packJson = {
  name: SKILL,
  title: plan.title,
  kb: `kb/${SKILL}-kb.json`,
  sources: [{ file: `kb/${SKILL}-kb.json`, source: SKILL, label: plan.title }],
  model: { provider: "deepseek", id: "deepseek-flash" },
  thinkingLevel: "off",
  description: `由 ${REPO || DIR} 自动生成的教学包。${plan.repoSummary}`,
  curriculum: plan.chapters,
  starterQuestions: plan.starterQuestions || [],
};
writeFileSync(join(packDir, "pack.json"), JSON.stringify(packJson, null, 2));

// REVIEW.md
updateManifest({
  kind: "repo", slug: SKILL, title: plan.title, description: plan.description,
  pack: SKILL, review: `packs/${SKILL}/REVIEW.md`, page: null,
  chapters: plan.chapters.map((c) => ({ no: c.no, title: c.title, goal: c.goal, questions: c.questions || [] })),
  starterQuestions: plan.starterQuestions || [], generated: false,
});
writeFileSync(join(packDir, "REVIEW.md"), `# 人审清单 · 教学包 ${SKILL}

- 来源: ${REPO || DIR}
- 课程: ${plan.title}(${plan.chapters.length} 章)
- 知识库: kb/${SKILL}-kb.json(${kbChunks.length} 块,其中 ${valid.length} 块被大纲引用)
- 起步问题: ${(plan.starterQuestions || []).join(" / ")}

## 审校要点
1. [ ] 课程大纲顺序合理、覆盖仓库核心(对照原仓库 README)
2. [ ] 每章 chunkIds 引用是否对题(抽查 3 章)
3. [ ] 领域教学要点是否准确
4. [ ] 试教: node src/tutor.mjs --pack packs/${SKILL} 问 2~3 个问题看质量

## 使用
\`\`\`bash
node src/tutor.mjs --pack packs/${SKILL}
\`\`\`
知识库为自动生成的「机器初稿」——大纲与引用待人审,知识内容本身来自原仓库(可溯源)。
`);

console.log(`\n✓ 教学包: packs/${SKILL}/(pack.json + system-prompt.md + REVIEW.md)`);
console.log(`✓ 知识库: kb/${SKILL}-kb.json(${kbChunks.length} 块)`);
console.log(`  课程: ${plan.title} — ${plan.chapters.length} 章`);
plan.chapters.forEach((c) => console.log(`   ${c.no}. ${c.title} — ${c.goal}`));
console.log(`\n  试教: node src/tutor.mjs --pack packs/${SKILL}`);
