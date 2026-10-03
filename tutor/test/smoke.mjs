#!/usr/bin/env node
// 冒烟测试:node test/smoke.mjs
// 覆盖:知识库/检索质量、学生记忆读写、代码沙箱、mock 模式下的 Agent 全链路。
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failed++;
}

// 1. 检索质量
const { CourseIndex } = await import(join(ROOT, "src", "retrieval.mjs"));
const index = CourseIndex.load(join(ROOT, "kb", "course-chunks.json"));
const t1 = index.search("Agent Loop 的核心是什么", 3);
check("检索: Agent Loop 命中第 1 章", t1.some((h) => h.chapter === 1), t1[0] && `top1=${t1[0].section ?? t1[0].title}`);
const t2 = index.search("Pi Agent 极简主义 四个基础工具", 3);
check("检索: Pi Agent 命中第 7 章", t2.some((h) => h.chapter === 7), t2[0] && `top1=第${t2[0].chapter}章 ${t2[0].title}`);
const t3 = index.search("RAG 完整管线 50 行代码", 3);
check("检索: RAG 管线命中第 4 章", t3.some((h) => h.chapter === 4), t3[0] && `top1=第${t3[0].chapter}章 ${t3[0].title}`);
const t4 = index.search("RAG 有哪些失败模式怎么诊断", 1);
check("检索: RAG 失败模式命中 4.5", t4[0]?.section === "4.5", t4[0] && `top1=${t4[0].section}`);

// 1b. 双源检索(Gulli《Agentic Design Patterns》)
const gulliPath = join(ROOT, "kb", "gulli-patterns.json");
check("Gulli 知识库已生成", existsSync(gulliPath));
if (existsSync(gulliPath)) {
  const dual = CourseIndex.loadMerged([
    { path: join(ROOT, "kb", "course-chunks.json"), source: "course" },
    { path: gulliPath, source: "gulli" },
  ]);
  const tg = dual.search("Model Context Protocol MCP server tools 接入", 3);
  check("检索: MCP 命中 Gulli 第 10 章", tg.some((h) => h.source === "gulli" && h.chapter === 10), tg[0] && `top1=${tg[0].source}:${tg[0].chapterTitle}`);
  check("检索: 课程问题仍命中课程源", dual.search("Agent Loop 的核心是什么", 3).some((h) => h.source === "course"));
  check("检索: source 过滤生效", dual.search("guardrails", 3, null, "gulli").every((h) => h.source === "gulli"));
}

// 2. 学生记忆
const testStudent = "smoke-test";
rmSync(join(ROOT, "students", `${testStudent}.json`), { force: true });
const { loadProfile, saveProfile, renderProfile } = await import(join(ROOT, "src", "memory.mjs"));
const profile = loadProfile(ROOT, testStudent);
profile.mastered.push({ topic: "Agent Loop", evidence: "smoke", date: "2026-10-02" });
saveProfile(ROOT, profile);
const reloaded = loadProfile(ROOT, testStudent);
check("记忆: 掌握记录落盘并可回读", reloaded.mastered.length === 1 && reloaded.mastered[0].topic === "Agent Loop");
check("记忆: renderProfile 包含掌握项", renderProfile(reloaded).includes("Agent Loop"));

// 3. 代码沙箱(直接调用工具 execute)
const { buildTools } = await import(join(ROOT, "src", "tools.mjs"));
const tools = buildTools({ index, profile: reloaded, root: ROOT });
const runCode = tools.find((t) => t.name === "run_code");
const r1 = await runCode.execute("t1", { language: "javascript", code: "console.log(2+3)" });
check("沙箱: JS 执行", r1.content[0].text.includes("✓") && r1.content[0].text.includes("5"));
const r2 = await runCode.execute("t2", { language: "python", code: "print('你好 ' + str(40+2))" });
check("沙箱: Python 执行", r2.content[0].text.includes("你好 42"));

// 3b. 记忆类工具的 execute 路径(会改写传入的 profile 对象)
const recProg = tools.find((t) => t.name === "record_progress");
const recMis = tools.find((t) => t.name === "record_misconception");
const updPlan = tools.find((t) => t.name === "update_plan");
await recProg.execute("t3", { topic: "冒烟概念", evidence: "第一版证据" });
await recProg.execute("t4", { topic: "冒烟概念", evidence: "更新后的证据" }); // 同 topic 走更新分支
await recMis.execute("t5", { topic: "冒烟概念", note: "误以为要背公式" });
await updPlan.execute("t6", { currentFocus: "冒烟焦点", nextStep: "冒烟下一步", level: "beginner" });
check("记忆工具: record_progress 写入且去重", reloaded.mastered.filter((m) => m.topic === "冒烟概念").length === 1
  && reloaded.mastered.find((m) => m.topic === "冒烟概念").evidence === "更新后的证据");
check("记忆工具: record_misconception 写入", reloaded.misconceptions.some((m) => m.topic === "冒烟概念"));
check("记忆工具: update_plan 写入", reloaded.currentFocus === "冒烟焦点" && reloaded.nextStep === "冒烟下一步");

// 4. 上下文修剪
const { pruneMessages, estimateTokens } = await import(join(ROOT, "src", "context.mjs"));
const long = [];
for (let i = 0; i < 500; i++) {
  long.push({ role: "user", content: "学生消息".repeat(150) + i, timestamp: 1 });
  long.push({ role: "assistant", content: [{ type: "text", text: "导师回答".repeat(150) }], timestamp: 1 });
}
check("上下文: 超长对话触发修剪", pruneMessages(long, 20_000).length < long.length);
const pruned = pruneMessages(long, 20_000);
check("上下文: 切割点在 user 边界(工具对不被拆散)", pruned[1].role === "user");
check("上下文: 最近消息保留完整", pruned[pruned.length - 1].role === "assistant");
check("上下文: 短对话原样返回", pruneMessages(long.slice(0, 10), 20_000).length === 10);
check("上下文: 估算函数返回正数", estimateTokens(long) > 0);

// 5. mock 全链路(清理状态后跑 --once,验证会话 JSONL 与工具调用落盘)
rmSync(join(ROOT, "students", "smoke-mock.session.jsonl"), { force: true });
const out = spawnSync(process.execPath, [join(ROOT, "src", "tutor.mjs"), "--mock", "--once", "什么是 Agent Loop?", "--student", "smoke-mock"], { encoding: "utf8", cwd: ROOT, timeout: 60000 });
check("mock 全链路: 进程正常退出", out.status === 0, out.status !== 0 ? (out.stderr || "").slice(0, 300) : "");
check("mock 全链路: 调用了 lookup_course 工具", out.stdout.includes("[lookup_course]"));
check("mock 全链路: 流式回复输出", out.stdout.includes("mock 回应"));
const sessionPath = join(ROOT, "students", "smoke-mock.session.jsonl");
check("mock 全链路: 会话 JSONL 落盘", existsSync(sessionPath));
if (existsSync(sessionPath)) {
  const lines = readFileSync(sessionPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  check("会话记录: 含 user/assistant/tool_call/tool_result", ["user", "assistant", "tool_call", "tool_result"].every((r) => lines.some((l) => l.role === r)));
  const tr = lines.find((l) => l.role === "tool_result" && l.name === "lookup_course");
  check("会话记录: 检索结果非空且非错误", tr && !tr.isError && tr.preview.includes("Agent"), tr && tr.preview.slice(0, 60));
}

// 6. RPC 协议全链路(mock 模型):stdin JSONL → stdout 事件流
{
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [join(ROOT, "src", "tutor.mjs"), "--mock", "--rpc", "--student", "smoke-rpc"], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
  const events = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const s = buf.slice(0, i); buf = buf.slice(i + 1);
      try { events.push(JSON.parse(s)); } catch {}
    }
  });
  const waitEvent = (type, nth = 1, timeoutMs = 20_000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      const found = events.filter((x) => x.type === type);
      if (found.length >= nth) return res(found[nth - 1]);
      if (Date.now() - t0 > timeoutMs) return rej(new Error(`等待第${nth}个 ${type} 超时`));
      setTimeout(tick, 50);
    };
    tick();
  });
  const hello = await waitEvent("hello").catch(() => null);
  check("RPC: hello 握手", !!hello);

  // greet 开场(档案 + 页面驱动的主动打招呼)
  child.stdin.write(JSON.stringify({ type: "greet" }) + "\n");
  await waitEvent("ready", 1).catch(() => null);
  check("RPC: greet 开场回复", events.some((x) => x.type === "delta" && x.text));

  child.stdin.write(JSON.stringify({ type: "context", page: { file: "03-prompt-engineering.html", title: "第 3 章 · Prompt 工程与上下文设计" } }) + "\n");
  child.stdin.write(JSON.stringify({ type: "user", text: "什么是五区结构?" }) + "\n");
  const deltas = [];
  try {
    await waitEvent("ready", 2);
    check("RPC: 一轮后收到 ready", true);
  } catch { check("RPC: 一轮后收到 ready", false); }
  check("RPC: 流式 delta 事件", events.some((x) => x.type === "delta" && x.text));
  check("RPC: tool_start 事件(mock 会调 lookup_course)", events.some((x) => x.type === "tool_start" && x.name === "lookup_course"));
  child.stdin.write(JSON.stringify({ type: "control", cmd: "exit" }) + "\n");
  const exited = await new Promise((res) => {
    const t0 = Date.now();
    const tick = () => (child.exitCode !== null ? res(true) : Date.now() - t0 > 8000 ? res(false) : setTimeout(tick, 50));
    tick();
  });
  check("RPC: exit 控制后进程干净退出", exited === true && child.exitCode === 0, `exitCode=${child.exitCode}`);
  const rpcProfile = join(ROOT, "students", "smoke-rpc.json");
  check("RPC: 学生档案落盘", existsSync(rpcProfile));
  const rpcLog = readFileSync(join(ROOT, "students", "smoke-rpc.session.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  // agent_end 会额外落一条带前缀的内部 prompt 消息(page 为空);要找的是显式记录的学生消息
  const rpcUser = rpcLog.find((l) => l.role === "user" && typeof l.page === "string");
  check("RPC: 页面上下文落盘", rpcUser?.page === "03-prompt-engineering.html", rpcUser && `page=${rpcUser.page}`);
  rmSync(rpcProfile, { force: true });
  rmSync(join(ROOT, "students", "smoke-rpc.session.jsonl"), { force: true });
}

console.log(failed ? `\n${failed} 项失败` : "\n全部通过 ✓");
process.exit(failed ? 1 : 0);
