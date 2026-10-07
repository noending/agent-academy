#!/usr/bin/env node
// 知识进化 · 盲区分析:汇总导师留档的知识盲区 + 会话中的检索脱靶,
// 聚类成主题并推荐补课方案(用哪条工厂管线、什么素材)。
// 用法: node scripts/analyze-gaps.mjs
// 产出: drafts/gaps/<时间戳>/GAPS.md
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { completeSimple, getModel } from "@mariozechner/pi-ai";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const MODEL = getModel("deepseek", "deepseek-v4-flash");
const KEY = process.env.DEEPSEEK_API_KEY;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const parseJSON = (s) => {
  const m = String(s).match(/[[{][\s\S]*[\]}]/);
  if (!m) throw new Error("输出中找不到 JSON");
  return JSON.parse(m[0]);
};
async function llm(system, user, maxTokens = 5000) {
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

// ---------- 收集: 显式盲区 + 检索脱靶 ----------
const gaps = []; // {ts, topic, question, source}
const gapsFile = join(TUTOR, "knowledge-gaps.jsonl");
if (existsSync(gapsFile)) {
  for (const l of readFileSync(gapsFile, "utf8").split("\n").filter(Boolean)) {
    try { const r = JSON.parse(l); gaps.push({ ...r, source: "导师留档" }); } catch {}
  }
}

// 会话中的隐性脱靶: lookup_course 结果为「没有找到相关内容」
const studentsDir = join(TUTOR, "students");
const misses = [];
if (existsSync(studentsDir)) {
  for (const f of readdirSync(studentsDir)) {
    if (!f.endsWith(".session.jsonl")) continue;
    const records = readFileSync(join(studentsDir, f), "utf8")
      .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    // 找 lookup_course 脱靶的调用,回溯同会话中该工具调用前最近的学生问题
    let lastQuestion = "(未知)";
    for (const r of records) {
      if (r.role === "user") lastQuestion = String(r.text).slice(0, 200);
      if (r.role === "tool_result" && r.name === "lookup_course" &&
          (r.preview || "").includes("没有找到相关内容")) {
        misses.push({ source: "检索脱靶", question: lastQuestion, file: f.replace(".session.jsonl", "") });
      }
    }
  }
}

console.log(`→ 显式盲区 ${gaps.length} 条 · 检索脱靶 ${misses.length} 次`);
if (!gaps.length && !misses.length) {
  console.log("没有盲区数据。教学中遇到知识库答不了的问题时,导师会调用 record_knowledge_gap 留档。");
  process.exit(0);
}

// ---------- LLM 聚类 + 推荐 ----------
const gapText = [
  ...gaps.map((g) => `- [导师留档] 主题: ${g.topic} | 问题: ${g.question}`),
  ...misses.map((m) => `- [检索脱靶] 学生问: ${m.question}(${m.file})`),
].join("\n");

console.log("→ LLM 聚类分析…");
const CLUSTER_SYS = `你是「知识进化循环」的分析器。导师在教学中有意留档了知识盲区(知识库答不了的问题)。
把它们聚类成 2~5 个主题,并为每个主题推荐补课方案。可用管线:
- paper: 摄取一篇论文(适合学术主题,给 arXiv 主题/论文名)
- repo: 摄取一个 GitHub 仓库(适合工程实践主题,建议知名仓库)
- topic: 直接按课题生成(无权威素材时的兜底,内容需人工核实)
输出严格 JSON:
{"themes":[{"theme":"主题名","gaps":["归入此主题的原始问题"],"recommend":{"pipeline":"paper|repo|topic","source":"建议摄取的具体素材说明","priority":"高|中|低"}}],"overall":"总结(100字内:盲区集中在哪、最优先补什么)"}
只输出 JSON。`;
const clusterRaw = await llm(CLUSTER_SYS, `知识盲区清单:\n${gapText}`, 5000);
const clusters = parseJSON(clusterRaw);

// ---------- 产出报告 ----------
const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const outDir = join(SITE, "drafts", "gaps", ts);
mkdirSync(outDir, { recursive: true });

const md = `# 知识盲区分析 · ${PACK_LABEL()}\n\n> meta-导师自动生成 · 显式盲区 ${gaps.length} · 检索脱靶 ${misses.length}\n\n## 主题聚类与补课方案\n\n` +
  clusters.themes.map((th, i) => `### ${i + 1}. ${esc(th.theme)}(优先级 ${esc(th.recommend.priority)})\n\n- **归入的盲区**:\n${(th.gaps || []).map((g) => `  - ${esc(g)}`).join("\n")}\n- **推荐方案**:${esc(th.recommend.pipeline)} — ${esc(th.recommend.source)}\n- **示例命令**:\n\n\`\`\`bash\n${exampleCommand(th.recommend.pipeline, th.recommend.source)}\n\`\`\`\n`).join("\n") +
  `\n## 总结\n\n${esc(clusters.overall)}\n\n## 原始清单\n\n${gapText.split("\n").map(esc).join("\n")}\n`;
function exampleCommand(pipeline, source) {
  const slugHint = "补课-" + String(source).slice(0, 12).replace(/[^\w\u4e00-\u9fa5-]+/g, "");
  if (pipeline === "paper") return `node scripts/make-paper-page.mjs --pdf <论文PDF> --slug ${slugHint} --title-en "<论文标题>"`;
  if (pipeline === "repo") return `node scripts/make-pack-from-repo.mjs --repo <owner/name> --skill ${slugHint}`;
  return `node scripts/make-course-from-topic.mjs --topic "${String(source).slice(0, 30)}" --skill ${slugHint}`;
}
function PACK_LABEL() { return "全部教学包"; }

writeFileSync(join(outDir, "GAPS.md"), md);
writeFileSync(join(outDir, "gaps.json"), JSON.stringify({ clusters, gaps, misses }, null, 2));
console.log(`✓ 盲区报告: ${join(outDir, "GAPS.md")}`);
console.log(`  按推荐的管线与素材执行工厂命令即可补齐知识;补完后导师即可应答。`);
