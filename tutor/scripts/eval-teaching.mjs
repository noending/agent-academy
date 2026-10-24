#!/usr/bin/env node
// 教学行为评估集:脚本化学生场景 → 真实模型 RPC 全链路 → 行为断言。
// 这是教法进化循环的「行为回归层」:smoke 只保证结构不崩,本评估验证「教得对」——
// 该记的记了(目标/误解/掌握/盲区)、超纲如实承认、引用出处、页面上下文生效。
//
// 用法(需要 DEEPSEEK_API_KEY,约 10 轮真实对话,成本 < $0.01):
//   node scripts/eval-teaching.mjs                    # 全部场景
//   node scripts/eval-teaching.mjs --only e1,e3       # 子集
//   node scripts/eval-teaching.mjs --pack llm-deploy  # 指定教学包(自动跳过仅限 agent-dev 的场景)
//   node scripts/eval-teaching.mjs --keep             # 保留评估数据目录(调试用)
//
// 评估隔离:学生档案/会话写临时目录(TUTOR_DATA_DIR),盲区写临时文件(TUTOR_GAPS_FILE),
// 不污染 tutor/students/ 与 knowledge-gaps.jsonl;报告落 drafts/evals/<时间戳>/EVAL.md。
// evolve-teaching --apply 会在结构回归后自动跑本评估(--skip-evals 可跳过)。
import { spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");

const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const PACK = argOf("--pack") || "agent-dev";
const ONLY = (argOf("--only") || "").split(",").filter(Boolean);
const KEEP = args.includes("--keep");

if (!process.env.DEEPSEEK_API_KEY && !process.env.TUTOR_PROVIDER) {
  console.error("✗ 缺少 DEEPSEEK_API_KEY(source ~/.zshrc 后重试;或设 TUTOR_PROVIDER 换引擎)");
  process.exit(1);
}

// ---------- 断言收集 ----------
let hardFails = 0;
const report = []; // { scenario, id, title, kind, pass, info }
function makeAsserts(scenario) {
  const push = (kind, name, cond, info = "") => {
    const pass = !!cond;
    if (kind === "hard" && !pass) hardFails++;
    report.push({ scenario, name, kind, pass, info: String(info ?? "") });
    console.log(`  ${pass ? "✓" : kind === "hard" ? "✗" : "△"} [${kind}] ${name}${info ? ` — ${info}` : ""}`);
  };
  return { hard: (n, c, i) => push("hard", n, c, i), soft: (n, c, i) => push("soft", n, c, i) };
}

// 「全程中文」启发式:剥掉 markdown 符号后首字符是英文字母即违规(容忍技术名词出现在句中)
function chineseFirstOk(text) {
  const t = String(text || "").replace(/^[\s*#>`\-—–"'「【（(]+/, "");
  return !/^[A-Za-z]/.test(t);
}
const questionCount = (text) => (String(text || "").match(/？|\?/g) || []).length;

// ---------- RPC 客户端 ----------
class RpcTutor {
  constructor(studentId, env) {
    this.child = spawn(process.execPath,
      [join(TUTOR, "src", "tutor.mjs"), "--rpc", "--pack", join(TUTOR, "packs", PACK), "--student", studentId],
      { cwd: TUTOR, env: { ...process.env, ...env } });
    this.events = [];
    this.buf = "";
    this.stderr = "";
    this.readyNth = 0;
    this.child.stdout.on("data", (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const s = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        try { this.events.push(JSON.parse(s)); } catch {}
      }
    });
    this.child.stderr.on("data", (d) => { this.stderr += d; });
  }
  wait(type, nth = 1, timeoutMs = 240_000) {
    return new Promise((res, rej) => {
      const t0 = Date.now();
      const tick = () => {
        const found = this.events.filter((x) => x.type === type);
        if (found.length >= nth) return res(found[nth - 1]);
        if (this.child.exitCode !== null) return rej(new Error(`tutor 进程提前退出(exitCode=${this.child.exitCode}): ${(this.stderr || "").slice(-200)}`));
        if (Date.now() - t0 > timeoutMs) return rej(new Error(`等待第 ${nth} 个 ${type} 超时(${timeoutMs / 1000}s)`));
        setTimeout(tick, 100);
      };
      tick();
    });
  }
  send(obj) { this.child.stdin.write(JSON.stringify(obj) + "\n"); }
  async turn(text) {
    const mark = this.events.length;
    this.readyNth += 1;
    this.send({ type: "user", text });
    await this.wait("ready", this.readyNth);
    const slice = this.events.slice(mark);
    return {
      reply: slice.filter((x) => x.type === "delta").map((x) => x.text).join(""),
      tools: slice.filter((x) => x.type === "tool_start").map((x) => ({ name: x.name, args: x.args || {} })),
      errors: slice.filter((x) => x.type === "error"),
      cost: (slice.find((x) => x.type === "ready") || {}).cost || 0,
    };
  }
  async stop() {
    this.send({ type: "control", cmd: "exit" });
    const ok = await new Promise((res) => {
      const t0 = Date.now();
      const tick = () => (this.child.exitCode !== null ? res(true) : Date.now() - t0 > 5000 ? res(false) : setTimeout(tick, 50));
      tick();
    });
    if (!ok) this.child.kill();
  }
}

// ---------- 场景定义 ----------
// generic: true 的场景与课程内容无关,任何教学包都可跑;其余仅 agent-dev(依赖其知识库与提示词规则)
const scenarios = [
  {
    id: "e1", title: "目标即刻入档", generic: true,
    turns: [
      {
        user: "老师好,自我介绍一下:我会写 Python,做过一点 Flask 后端,JS 也还行。我的目标是做一个自动帮我啃论文、生成读书笔记的私人 Agent。今天从哪儿开始?",
        check: (t, a) => {
          const up = t.tools.find((x) => x.name === "update_plan");
          a.hard("说出目标当轮即 update_plan(goal)", up && !!up.args.goal, up ? `goal=${String(up.args.goal).slice(0, 40)}` : "未调用");
          a.soft("每轮最多一个待答问题", questionCount(t.reply) <= 1, `问号=${questionCount(t.reply)}`);
        },
      },
    ],
    after: (r, a) => {
      a.hard("档案 goal 已落盘", !!r.profile?.goal, r.profile?.goal ?? "空");
    },
  },
  {
    id: "e2", title: "误解同轮留档", generic: true,
    turns: [
      {
        user: "我想通了一个道理:只要在系统提示里写清楚『只准调用白名单里的工具』,那这个 Agent 就绝对不会调用别的工具,安全就有保证了,对吧?",
        check: (t, a) => {
          a.hard("误解同轮 record_misconception", t.tools.some((x) => x.name === "record_misconception"));
          a.soft("回应包含追问(苏格拉底式)", questionCount(t.reply) >= 1);
        },
      },
    ],
    after: (r, a) => {
      a.hard("档案误解已落盘", (r.profile?.misconceptions || []).length >= 1);
    },
  },
  {
    id: "e3", title: "掌握须凭证据", generic: false,
    turns: [
      { user: "我之前自己学过一点 Agent Loop,你别从头讲了,直接考我。" },
      {
        user: "我的理解是这样的:模型其实只产出文本,所谓工具调用是一段结构化的文本,由运行时的代码去解析并真正执行,执行结果再追加回消息历史,模型看到结果后决定下一步,这样循环直到不再需要工具。所以决策权在模型,执行权在运行时。",
      },
      {
        user: "预测一个新情境:如果模型这次调用了一个运行时里根本没注册的工具,运行时会把错误当成工具结果回灌给模型,模型下一轮看到错误自己纠正,而不是整个程序崩掉。",
      },
      {
        user: "对你刚举的情境,我的判断也是一样:错误信息会作为观察返回,模型据此换路。按你的标准,我这样算把 Agent Loop 吃透了吗?",
        check: (r, a) => {
          // 汇总断言放在最后一轮:只要场景内发生过即算(哪一轮记不确定,不该硬编)
        },
      },
    ],
    after: (r, a) => {
      const allTools = r.turns.flatMap((t) => t.tools);
      a.hard("学生展示理解后 record_progress", allTools.some((x) => x.name === "record_progress"));
      a.hard("档案掌握已落盘且带证据", (r.profile?.mastered || []).length >= 1 && !!r.profile.mastered[0].evidence,
        r.profile?.mastered?.[0]?.topic ?? "无");
      a.soft("教学引用课程出处", r.turns.some((t) => /课程\s*\d+(\.\d+)?/.test(t.reply)));
    },
  },
  {
    id: "e4", title: "超纲如实留档盲区", generic: true,
    turns: [
      {
        user: "教我用 Common Lisp 写一个黑板架构的多智能体系统吧,要跑在嵌入式设备上。",
        check: (t, a) => {
          a.soft("每轮最多一个待答问题", questionCount(t.reply) <= 1, `问号=${questionCount(t.reply)}`);
        },
      },
    ],
    after: (r, a) => {
      const allTools = r.turns.flatMap((t) => t.tools);
      a.hard("超纲问题 record_knowledge_gap", allTools.some((x) => x.name === "record_knowledge_gap"));
      const line = r.gaps.find((l) => l.pack === PACK);
      a.hard(`盲区落盘且 pack 归因为 ${PACK}`, !!line, line ? `topic=${line.topic}` : "gaps 文件无该包记录");
      if (PACK === "agent-dev") {
        a.hard("对学生如实说明超出课程库", r.turns.some((t) => /课程/.test(t.reply) && /(超出|没有|之外|盲区|未覆盖)/.test(t.reply)));
      }
    },
  },
  {
    id: "e5", title: "引用出处(课程 + Gulli)", generic: false,
    turns: [
      {
        user: "Gulli 那本书里讲的 MCP 是怎么回事?给我讲讲。",
        check: (t, a) => {
          a.hard("先 lookup_course 再回答", t.tools.some((x) => x.name === "lookup_course"));
          a.hard("引用格式「Gulli 第 N 章」", /Gulli\s*第\s*\d+\s*章/.test(t.reply));
        },
      },
      {
        user: "课程里说的 Agent Loop,四要素是哪四个?",
        check: (t, a) => {
          a.hard("课程问题也先检索", t.tools.some((x) => x.name === "lookup_course"));
          a.hard("引用格式「课程 N.N 节」", /课程\s*\d+(\.\d+)?/.test(t.reply));
        },
      },
    ],
  },
  {
    id: "e6", title: "页面上下文注入", generic: true,
    context: { file: "chapter.html", title: "本章精读 · 评估占位页" },
    turns: [
      {
        user: "我正在看的这一章,最重要的是什么?",
        check: (t, a) => {
          a.soft("结合当前章节检索", t.tools.some((x) => x.name === "lookup_course"));
        },
      },
    ],
    after: (r, a) => {
      const users = (r.sessionLog || []).filter((l) => l.role === "user");
      const last = users[users.length - 1];
      a.hard("会话日志记录 page 字段", last?.page === "chapter.html", last ? `page=${last.page}` : "无 user 记录");
      a.hard("日志保留原始文本(不含注入前缀)", last && !String(last.text).includes("[正在学习"));
    },
  },
];

// ---------- 运行 ----------
const dataDir = mkdtempSync(join(tmpdir(), "tutor-eval-"));
const gapsFile = join(dataDir, "gaps.jsonl");
const applicable = scenarios.filter((s) => (ONLY.length ? ONLY.includes(s.id) : (s.generic || PACK === "agent-dev")));
if (!applicable.length) { console.error("✗ 没有可运行的场景(--only 过滤为空)"); process.exit(1); }

console.log(`教学行为评估 · pack=${PACK} · 场景 ${applicable.length} 个 · 数据隔离在 ${dataDir}\n`);
let totalCost = 0;
const mdSections = [];

for (const sc of applicable) {
  console.log(`── ${sc.id} ${sc.title} ──`);
  const a = makeAsserts(`${sc.id} ${sc.title}`);
  const sid = `eval-${sc.id}`;
  // 非默认包学生档案按包隔离(tutor 约定 id@pack)
  const fileBase = PACK === "agent-dev" ? sid : `${sid}@${PACK}`;
  const rpc = new RpcTutor(sid, { TUTOR_DATA_DIR: dataDir, TUTOR_GAPS_FILE: gapsFile });
  const turns = [];
  let failedToRun = false;
  try {
    const hello = await rpc.wait("hello", 1, 60_000);
    if (sc.context) rpc.send({ type: "context", page: sc.context });
    for (const step of sc.turns) {
      const t = await rpc.turn(step.user);
      turns.push(t);
      totalCost += t.cost || 0;
      a.hard(`轮次无 error 事件`, t.errors.length === 0, t.errors[0]?.message?.slice(0, 80) || "");
      if (step.check) step.check(t, a);
    }
  } catch (e) {
    a.hard("场景完整跑完", false, e.message);
    failedToRun = true;
  }
  await rpc.stop().catch(() => {});

  // 结果快照:档案 / 盲区 / 会话日志
  let profile = null, gaps = [], sessionLog = [];
  try { profile = JSON.parse(readFileSync(join(dataDir, "students", `${fileBase}.json`), "utf8")); } catch {}
  try { gaps = readFileSync(gapsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  try { sessionLog = readFileSync(join(dataDir, "students", `${fileBase}.session.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch {}

  const r = { turns, profile, gaps, sessionLog };
  // 全场景语言规则:容忍个别技术名词开头,≥2 处英文开头才算硬失败
  const langViolations = turns.filter((t) => !chineseFirstOk(t.reply)).length;
  a[langViolations >= 2 ? "hard" : "soft"]("全程中文开头(≥2 处违规算失败)", langViolations === 0, `违规=${langViolations}`);
  if (!failedToRun && sc.after) sc.after(r, a);

  mdSections.push(`## ${sc.id} ${sc.title}\n\n### 断言\n\n` +
    report.filter((x) => x.scenario === `${sc.id} ${sc.title}`)
      .map((x) => `- ${x.pass ? "✓" : x.kind === "hard" ? "✗" : "△"} (${x.kind}) ${x.name}${x.info ? ` — ${x.info}` : ""}`).join("\n") +
    `\n\n### 对话摘录\n\n` +
    sc.turns.map((step, i) => {
      const reply = (turns[i]?.reply || "").slice(0, 400).replace(/\n+/g, " ");
      const tools = (turns[i]?.tools || []).map((x) => x.name).join(",") || "-";
      return `**学生**: ${step.user.slice(0, 120)}…\n\n**导师**(工具: ${tools}): ${reply}…`;
    }).join("\n\n"));
  console.log("");
}

// ---------- 报告 ----------
const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const outDir = join(SITE, "drafts", "evals", `${ts}-${PACK}`);
mkdirSync(outDir, { recursive: true });
const hardTotal = report.filter((x) => x.kind === "hard").length;
const hardPassed = report.filter((x) => x.kind === "hard" && x.pass).length;
const softFlagged = report.filter((x) => x.kind === "soft" && !x.pass).length;
writeFileSync(join(outDir, "EVAL.md"),
  `# 教学行为评估 · ${PACK}\n\n> ${new Date().toISOString()} · 硬断言 ${hardPassed}/${hardTotal} 通过 · 软指标 ${softFlagged} 项提示 · 成本 ≈ $${totalCost.toFixed(4)}\n\n` +
  `由 scripts/eval-teaching.mjs 生成;评估数据(档案/会话/盲区)在临时目录,未污染真实学生数据。\n\n` +
  mdSections.join("\n\n---\n\n") + "\n");

console.log(`${"═".repeat(48)}\n硬断言 ${hardPassed}/${hardTotal} 通过 · 软指标 ${softFlagged} 项提示 · 成本 ≈ $${totalCost.toFixed(4)}`);
console.log(`报告: ${join(outDir, "EVAL.md")}`);
if (!KEEP) rmSync(dataDir, { recursive: true, force: true });
else console.log(`(评估数据保留: ${dataDir})`);
process.exit(hardFails ? 1 : 0);
