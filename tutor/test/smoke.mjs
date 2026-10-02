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

// 4. mock 全链路(清理状态后跑 --once,验证会话 JSONL 与工具调用落盘)
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

console.log(failed ? `\n${failed} 项失败` : "\n全部通过 ✓");
process.exit(failed ? 1 : 0);
