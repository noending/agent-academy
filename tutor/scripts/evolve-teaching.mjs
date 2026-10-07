#!/usr/bin/env node
// 教法进化循环(meta-导师):观察会话 → 证据化分析 → 生成提示词提案 → 人审 → 应用。
//
// 用法:
//   node scripts/evolve-teaching.mjs [--pack agent-dev]        # 分析会话 + 生成提案
//   node scripts/evolve-teaching.mjs --apply <proposalDir>     # 人审通过后应用提案
//
// 原则(课程 10.3 HITL + 8 章评估):
//   - 提案永不自动应用;每条建议必须引用会话证据(可溯源);
//   - 应用前跑结构校验与回归测试;回滚 = git checkout。
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { completeSimple, getModel } from "@mariozechner/pi-ai";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const MODEL = getModel("deepseek", "deepseek-v4-flash");
const KEY = process.env.DEEPSEEK_API_KEY;

const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const PACK = argOf("--pack") || "agent-dev";
const APPLY_DIR = argOf("--apply");

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

// ---------- 会话收集 ----------
function sessionsFor(pack) {
  const dir = join(TUTOR, "students");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".session.jsonl")) continue;
    const id = f.replace(".session.jsonl", "");
    const owner = id.includes("@") ? id.split("@")[1] : "agent-dev";
    if (owner !== pack) continue;
    const records = readFileSync(join(dir, f), "utf8")
      .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    out.push({ student: id.split("@")[0], file: f, records });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function condenseSession(s) {
  const lines = [`### 会话 ${s.file}`];
  for (const r of s.records) {
    if (r.role === "greet") lines.push(`[开场] 页面: ${r.page || "-"}`);
    else if (r.role === "user") lines.push(`[学生] ${String(r.text).slice(0, 300)}`);
    else if (r.role === "assistant") lines.push(`[导师] ${String(r.text).slice(0, 380)}`);
    else if (r.role === "tool_call") lines.push(`[工具调用] ${r.name} ${JSON.stringify(r.args || {}).slice(0, 140)}`);
    else if (r.role === "tool_result") lines.push(`[工具结果·${r.name}] ${String(r.preview || "").slice(0, 140)}${r.isError ? " ⚠出错" : ""}`);
  }
  return lines.join("\n");
}

function loadProfileText(pack) {
  const dir = join(TUTOR, "students");
  if (!existsSync(dir)) return "(无)";
  const parts = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("tmp")) continue;
    const id = f.replace(".json", "");
    const owner = id.includes("@") ? id.split("@")[1] : "agent-dev";
    if (owner !== pack) continue;
    try {
      const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
      parts.push(`学生 ${id}:目标=${p.goal || "未设定"} | 水平=${p.level} | 已掌握=${(p.mastered || []).map((x) => x.topic).join("、") || "无"} | 误解=${(p.misconceptions || []).map((x) => x.topic).join("、") || "无"}`);
    } catch {}
  }
  return parts.join("\n") || "(无学生档案)";
}

// ---------- 最小行 diff(审查用) ----------
function lineDiff(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push("  " + A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push("- " + A[i]); i++; }
    else { out.push("+ " + B[j]); j++; }
  }
  while (i < n) out.push("- " + A[i++]);
  while (j < m) out.push("+ " + B[j++]);
  return out.join("\n");
}

// ---------- 结构校验(应用前必过) ----------
const REQUIRED_SECTIONS = ["# 角色", "# 当前学生档案", "{student_profile}", "# 页面上下文", "# 教学原则", "# 语言与风格"];
function validatePrompt(text, pack) {
  const issues = [];
  for (const sec of REQUIRED_SECTIONS) if (!text.includes(sec)) issues.push(`缺少必需段: ${sec}`);
  if (text.length < 1500) issues.push("提示词过短(<1500 字符),疑似生成不完整");
  if (pack !== "agent-dev" && text.includes("你是「Agent 学院」的私人导师")) issues.push("身份行仍是 Agent 学院(应为本课程)");
  return issues;
}

// ---------- 主流程:分析 + 提案 ----------
async function analyzeAndPropose() {
  if (!KEY) { console.error("✗ 缺少 DEEPSEEK_API_KEY"); process.exit(1); }
  const sessions = sessionsFor(PACK);
  const profileText = loadProfileText(PACK);
  const currentPrompt = readFileSync(join(TUTOR, "packs", PACK, "system-prompt.md"), "utf8");

  console.log(`→ meta-导师 · 教学包 ${PACK}`);
  console.log(`  会话 ${sessions.length} 份 · 学生档案 ${profileText.split("\n").filter(Boolean).length} 份`);

  if (!sessions.length) {
    console.log("⚠ 没有会话数据——先教学积累(会话 JSONL),再跑进化循环。");
    return;
  }

  // Stage 1 · 分析(证据化)
  console.log("→ Stage 1 · 分析会话证据…");
  let budget = 42_000;
  const condensed = [];
  for (let i = sessions.length - 1; i >= 0 && budget > 0; i--) { // 最近的会话优先
    const c = condenseSession(sessions[i]).slice(0, budget);
    budget -= c.length;
    condensed.push(c);
  }
  const ANALYZE_SYS = `你是「教法进化循环」的分析器:审查一位 AI 导师的真实教学会话,找出**教学法层面**的改进机会。
只分析导师可改进之处,不评价学生。每条发现必须引用具体会话证据(引用学生原话或导师原话片段)。
从这些维度找:①教学顺序与节奏;②讲解的清晰度与准确性;③苏格拉底式提问的执行质量;④误解记录与针对性;⑤工具使用(该用没用/用错);⑥提示词规则的违反或缺失。
输出严格 JSON:
{"findings":[{"category":"教法|工具|记忆|评估|内容","evidence":"引用会话原话片段(注明会话文件)","issue":"问题描述","suggestion":"可落实到导师系统提示词的具体修改建议","priority":"高|中|低"}],"overall":"总结(120字内:导师当前最强与最弱的两点)"}
只输出 JSON,5~8 条 findings,按优先级排序。`;
  const analysisRaw = await llm(ANALYZE_SYS,
    `导师当前系统提示词:\n${currentPrompt}\n\n学生档案:\n${profileText}\n\n教学会话(由近及远):\n\n${condensed.join("\n\n")}`, 6000);
  const analysis = parseJSON(analysisRaw);
  console.log(`  ✓ ${analysis.findings.length} 条发现`);

  // Stage 2 · 提案(修改后的完整提示词)
  console.log("→ Stage 2 · 生成提示词提案…");
  const PROPOSE_SYS = `你是「教法进化循环」的提案器。根据分析发现,改写导师的系统提示词。
要求:
- 产出**完整的改进后提示词**(不是 diff、不是片段),保留原结构(# 角色/# 当前学生档案 {student_profile} 占位符/# 页面上下文/# 教学原则/# 语言与风格/# 沙箱 等全部必需段);
- 只落实分析发现中高/中优先级、可落实到提示词的建议;低优先级或与提示词无关的忽略;
- 每处实质修改在正文中自然融入,不要加「修改说明」类文字;
- 提示词的身份与知识库描述保持不变。
输出严格 JSON:{"changes":[{"finding":"对应的分析发现(简述)","change":"做了什么修改(30字内)"}],"newPrompt":"完整新提示词"}
只输出 JSON。`;
  const proposeRaw = await llm(PROPOSE_SYS,
    `当前系统提示词:\n${currentPrompt}\n\n分析发现:\n${analysisRaw}`, 8000);
  const proposal = parseJSON(proposeRaw);
  const issues = validatePrompt(proposal.newPrompt, PACK);
  if (issues.length) { console.error("✗ 提案未通过结构校验:", issues.join(";")); process.exit(1); }
  console.log(`  ✓ ${proposal.changes.length} 处修改,结构校验通过`);

  // Stage 3 · 产物(分析报告 + 提案 + diff)
  const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const outDir = join(SITE, "drafts", "evolution", `${ts}-${PACK}`);
  mkdirSync(outDir, { recursive: true });

  const analysisMd = `# 教法分析报告 · ${PACK}\n\n> meta-导师自动生成 · 依据 ${sessions.length} 份会话(由近及远取样)\n\n## 总结\n\n${esc(analysis.overall)}\n\n## 发现\n\n` +
    analysis.findings.map((f, i) => `### ${i + 1}. [${f.priority}] ${f.category} — ${f.issue}\n\n- **证据**:${f.evidence}\n- **建议**:${f.suggestion}\n`).join("\n");
  writeFileSync(join(outDir, "ANALYSIS.md"), analysisMd);

  const diff = lineDiff(currentPrompt, proposal.newPrompt);
  const proposalMd = `# 教法提案 · ${PACK}\n\n> 依据同日分析报告 · ${proposal.changes.length} 处修改 · 结构校验通过\n\n## 修改点\n\n` +
    proposal.changes.map((c, i) => `${i + 1}. ${esc(c.change)}\n   - 依据发现:${esc(c.finding)}`).join("\n") +
    `\n\n## 提示词 diff(旧 → 新)\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n## 应用与回滚\n\n\`\`\`bash\n# 应用(会自动跑结构校验与回归测试)\nnode scripts/evolve-teaching.mjs --apply "${outDir}"\n# 回滚\ngit checkout -- packs/${PACK}/system-prompt.md\n\`\`\`\n`;
  writeFileSync(join(outDir, "PROPOSAL.md"), proposalMd);
  writeFileSync(join(outDir, "PROPOSAL.json"), JSON.stringify({
    pack: PACK, target: `packs/${PACK}/system-prompt.md`,
    newPrompt: proposal.newPrompt, changes: proposal.changes,
    findings: analysis.findings, createdAt: new Date().toISOString(),
  }, null, 2));

  console.log(`\n✓ 分析报告: ${join(outDir, "ANALYSIS.md")}`);
  console.log(`✓ 提案: ${join(outDir, "PROPOSAL.md")}`);
  console.log(`\n  下一步: 人工审阅 PROPOSAL.md 的 diff → 认可后执行\n    node scripts/evolve-teaching.mjs --apply "${outDir}"\n  (应用前会跑结构校验与回归测试;回滚 = git checkout)`);
}

// ---------- 应用(人审通过后) ----------
function applyProposal(dir) {
  const pj = join(dir, "PROPOSAL.json");
  if (!existsSync(pj)) { console.error(`✗ 找不到 ${pj}`); process.exit(1); }
  const proposal = JSON.parse(readFileSync(pj, "utf8"));
  const issues = validatePrompt(proposal.newPrompt, proposal.pack);
  if (issues.length) { console.error("✗ 结构校验未通过:", issues.join(";")); process.exit(1); }

  const target = join(TUTOR, proposal.target);
  const backup = readFileSync(target, "utf8");
  writeFileSync(target, proposal.newPrompt);
  console.log(`✓ 已应用 ${proposal.changes.length} 处修改 → ${proposal.target}`);

  console.log("→ 回归测试(35 项)…");
  try {
    execFileSync("npm", ["test"], { cwd: TUTOR, stdio: "inherit" });
    console.log(`\n✓ 回归通过。提案已生效;回滚: git checkout -- ${proposal.target}`);
    console.log(`  旧版本已留存于本次 diff(${backup.split("\n").length} 行),也可从 git 历史恢复。`);
  } catch {
    writeFileSync(target, backup); // 回归失败自动回滚
    console.error("\n✗ 回归失败,已自动回滚到原提示词。");
    process.exit(1);
  }
}

if (APPLY_DIR) applyProposal(APPLY_DIR);
else analyzeAndPropose().catch((e) => { console.error("✗", e.message); process.exit(1); });
