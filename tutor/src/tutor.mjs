#!/usr/bin/env node
// Agent 学院 · 开发导师 —— 基于 pi-agent-core 的教学智能体 CLI。
//
// 用法:
//   node src/tutor.mjs                      # 交互模式(需要 DEEPSEEK_API_KEY)
//   node src/tutor.mjs --mock               # 无 Key 冒烟模式(脚本化模型,验证全链路)
//   node src/tutor.mjs --rpc                # RPC 模式:stdin/stdout JSONL 协议,供 App 等嵌入方使用
//   node src/tutor.mjs --once "问题"        # 单轮模式,适合测试
//   node src/tutor.mjs --student alice      # 指定学生档案
//   node src/tutor.mjs --pack packs/agent-dev
import { Agent } from "@mariozechner/pi-agent-core";
import { AssistantMessageEventStream, getModel, getModels, getEnvApiKey, clampThinkingLevel } from "@mariozechner/pi-ai";
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { CourseIndex } from "./retrieval.mjs";
import { loadProfile, saveProfile, renderProfile, studentsDir } from "./memory.mjs";
import { buildTools } from "./tools.mjs";
import { pruneMessages } from "./context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- 参数 ----------
const args = process.argv.slice(2);
function argOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
const MOCK = args.includes("--mock");
const RPC = args.includes("--rpc");
const ONCE = argOf("--once");
const STUDENT = argOf("--student") || "default";
const PACK_DIR = resolve(argOf("--pack") || join(ROOT, "packs", "agent-dev"));

// ---------- 教学包 ----------
const pack = JSON.parse(readFileSync(join(PACK_DIR, "pack.json"), "utf8"));
let systemPrompt = readFileSync(join(PACK_DIR, "system-prompt.md"), "utf8");

// ---------- 知识库(缺失时自动构建) ----------
const KB = resolve(ROOT, pack.kb);
if (!existsSync(KB)) {
  console.log("知识库不存在,自动构建中…");
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [join(ROOT, "scripts", "build-kb.mjs")], { stdio: "inherit" });
}
// 第二知识源:Gulli《Agentic Design Patterns》整本教材(缺 PDF 时优雅降级为单源)
const GULLI_KB = join(ROOT, "kb", "gulli-patterns.json");
const gulliSource = existsSync(GULLI_KB) ? [{ path: GULLI_KB, source: "gulli" }] : [];
const index = CourseIndex.loadMerged([{ path: KB, source: "course" }, ...gulliSource]);

// ---------- 学生记忆 ----------
const profile = loadProfile(ROOT, STUDENT);
profile.sessions += 1;
saveProfile(ROOT, profile);
systemPrompt = systemPrompt.replace("{student_profile}", renderProfile(profile));

// ---------- 模型 ----------
const provider = process.env.TUTOR_PROVIDER || pack.model.provider;
const modelId = process.env.TUTOR_MODEL || pack.model.id;

// 注册表滞后于平台命名时(如 DeepSeek 新名 deepseek-flash),克隆同 provider 基础型号、仅换请求 id。
// 注意:getModel 对未知 id 不抛错而是返回 undefined,必须显式判空。
function resolveModel(provider, id) {
  const known = getModels(provider).find((m) => m.id === id);
  if (known) return known;
  const base = getModels(provider)[0];
  if (!base) throw new Error(`未知 provider: ${provider}`);
  console.error(`(注册表未收录 ${provider}/${id},按 ${base.id} 的接入参数发起请求)`);
  return { ...base, id, name: `${base.name} (${id})` };
}

const model = MOCK ? null : resolveModel(provider, modelId);
// 思考级别:pack.thinkingLevel 或 TUTOR_THINKING,默认 off;按模型实际支持范围收敛
const requestedLevel = process.env.TUTOR_THINKING || pack.thinkingLevel || "off";
const thinkingLevel = model ? clampThinkingLevel(model, requestedLevel) : requestedLevel;

function assertApiKey() {
  if (MOCK) return true;
  const key = getEnvApiKey(provider);
  if (!key) {
    console.error(`\n✗ 缺少 ${provider} 的 API Key。请设置环境变量:`);
    console.error(`  export DEEPSEEK_API_KEY="sk-..."   # platform.deepseek.com`);
    console.error(`  或换模型: TUTOR_PROVIDER=openai TUTOR_MODEL=gpt-4.1-mini node src/tutor.mjs\n`);
    return false;
  }
  return true;
}

// ---------- mock 模型:脚本化两阶段(先查课程 → 再回答),验证 loop 全链路 ----------
function mockStreamFn(_model, context) {
  const stream = new AssistantMessageEventStream();
  const msgs = context.messages;
  const last = msgs[msgs.length - 1];
  const base = {
    role: "assistant",
    api: "openai-completions",
    provider: "mock",
    model: "mock-tutor-1",
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
  };
  const emitText = (text) => {
    const partial = { ...base, content: [], stopReason: "stop" };
    stream.push({ type: "start", partial });
    stream.push({ type: "text_start", contentIndex: 0, partial });
    const chunks = text.match(/.{1,12}/gs) || [];
    let acc = "";
    for (const c of chunks) {
      acc += c;
      stream.push({
        type: "text_delta", contentIndex: 0, delta: c,
        partial: { ...partial, content: [{ type: "text", text: acc }] },
      });
    }
    const message = { ...partial, content: [{ type: "text", text }], stopReason: "stop" };
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  };
  (async () => {
    if (last?.role === "user") {
      // 第一阶段:调一次工具,验证工具执行链路
      const toolCall = { type: "toolCall", id: "mock-tc-1", name: "lookup_course", arguments: { query: "Agent Loop 四要素" } };
      const partial = { ...base, content: [], stopReason: "toolUse" };
      stream.push({ type: "start", partial });
      stream.push({ type: "toolcall_start", contentIndex: 0, partial });
      stream.push({ type: "toolcall_end", toolCall, partial: { ...partial, content: [toolCall], stopReason: "toolUse" } });
      const message = { ...partial, content: [toolCall], stopReason: "toolUse" };
      stream.push({ type: "done", reason: "toolUse", message });
      stream.end(message);
    } else {
      const hit = last?.role === "toolResult" ? "已检索到课程资料。" : "";
      emitText(`【mock 回应】${hit}这是验证模式下的教学回复。全链路(检索工具 → loop 续跑 → 流式输出)工作正常。请配置 DEEPSEEK_API_KEY 后体验真实教学。`);
    }
  })();
  return stream;
}

// ---------- 组装 Agent ----------
const tools = buildTools({ index, profile, root: ROOT });

const agent = new Agent({
  initialState: { systemPrompt, model, tools, thinkingLevel },
  ...(MOCK ? { streamFn: mockStreamFn } : {}),
  convertToLlm: (m) => m.filter((x) => typeof x === "object" && x !== null && "role" in x),
  // 长课保护:超预算时修剪最早的完整轮次(工具调用/结果成对保留)
  transformContext: (m) => pruneMessages(m, 24_000),
});

// ---------- 会话日志(JSONL,pi 风格) ----------
mkdirSync(studentsDir(ROOT), { recursive: true });
const sessionFile = join(studentsDir(ROOT), `${STUDENT}.session.jsonl`);
const log = (rec) => appendFileSync(sessionFile, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");

// ---------- 事件分发(CLI:本地渲染 / RPC:JSONL 事件) ----------
let totalCost = 0;
let printing = false;
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
    const d = event.assistantMessageEvent.delta;
    if (RPC) send({ type: "delta", text: d });
    else { printing = true; process.stdout.write(d); }
  }
  if (event.type === "tool_execution_start") {
    if (RPC) {
      send({ type: "tool_start", name: event.toolName, args: event.args });
    } else {
      if (printing) { process.stdout.write("\n"); printing = false; }
      const brief = JSON.stringify(event.args ?? {});
      console.log(`\n  ⚙ [${event.toolName}] ${brief.length > 90 ? brief.slice(0, 90) + "…" : brief}`);
    }
  }
  if (event.type === "tool_execution_end" && event.isError) {
    if (RPC) send({ type: "tool_end", name: event.toolName, isError: true });
    else console.log(`  ⚠ 工具执行出错`);
  }
  if (event.type === "turn_end") {
    if (printing) { process.stdout.write("\n"); printing = false; }
    const u = event.message?.usage;
    if (u?.cost) totalCost += u.cost.total ?? 0;
    if (RPC) send({ type: "turn_end", cost: u?.cost?.total ?? 0 });
  }
  if (event.type === "agent_end") {
    for (const m of event.messages) {
      if (m.role === "user") log({ student: STUDENT, role: "user", text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
      if (m.role === "assistant") {
        const text = (m.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
        if (text) log({ student: STUDENT, role: "assistant", text, stopReason: m.stopReason });
        for (const c of m.content || []) {
          if (c.type === "toolCall") log({ student: STUDENT, role: "tool_call", name: c.name, args: c.arguments });
        }
      }
      if (m.role === "toolResult") {
        const t = (m.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
        log({ student: STUDENT, role: "tool_result", name: m.toolName, preview: t.slice(0, 200), isError: m.isError });
      }
    }
    // 流式协议把请求失败编码在消息里(不抛异常),必须在这里浮出
    const failed = event.messages.find((m) => m.role === "assistant" && m.stopReason === "error");
    if (failed) {
      const msgText = failed.errorMessage || "模型请求失败";
      if (RPC) send({ type: "error", message: msgText });
      else console.log(`\n  ✗ ${msgText}`);
    }
  }
});

// ---------- 入口 ----------
if (RPC) {
  if (!assertApiKey()) process.exit(1);
  send({ type: "hello", student: STUDENT, model: MOCK ? "mock" : `${provider}/${modelId}` });
  let currentPage = null; // 嵌入方上报的当前页面(App 里学生正在读哪页)
  const rlRpc = readline.createInterface({ input: process.stdin });
  rlRpc.on("line", (l) => {
    let msg;
    try { msg = JSON.parse(l); } catch { return; }
    if (msg.type === "context" && msg.page) {
      currentPage = msg.page; // { file, title }
    } else if (msg.type === "greet") {
      // 面板打开/重置时的开场:导师根据档案与当前页面主动打招呼
      (async () => {
        log({ student: STUDENT, role: "greet", page: currentPage?.file ?? null });
        try {
          await agent.prompt(
            `[系统事件: 学生刚刚打开了导师面板,这是本次会话的开场]${currentPage ? `\n(学生当前页面: ${currentPage.title || currentPage.file})` : ""}\n` +
            `请根据学生档案与当前页面,用 1~3 句话打个招呼:点出他的目标或上次学到哪,并给出一个现在就能做的小行动。保持简短,结尾可以留一个钩子问题;不要长篇大论,不要重复档案原文。`
          );
        } catch (e) {
          send({ type: "error", message: String(e?.message || e) });
        }
        saveProfile(ROOT, profile);
        send({ type: "ready", totalCost: +totalCost.toFixed(4) });
      })();
    } else if (msg.type === "user" && msg.text) {
      (async () => {
        // 页面上下文以「正在学习」前缀注入,导师教学贴合当前章节
        const text = currentPage
          ? `[正在学习: ${currentPage.title || currentPage.file}]\n\n${msg.text}`
          : msg.text;
        log({ student: STUDENT, role: "user", text: msg.text, page: currentPage?.file ?? null });
        try {
          await agent.prompt(text);
        } catch (e) {
          send({ type: "error", message: String(e?.message || e) });
        }
        saveProfile(ROOT, profile);
        send({ type: "ready", totalCost: +totalCost.toFixed(4) });
      })();
    } else if (msg.type === "control") {
      if (msg.cmd === "reset") {
        agent.reset();
        send({ type: "ready", totalCost: +totalCost.toFixed(4) });
      } else if (msg.cmd === "profile") {
        send({ type: "profile", profile });
      } else if (msg.cmd === "exit") {
        saveProfile(ROOT, profile);
        send({ type: "bye" });
        process.exit(0);
      }
    }
  });
  rlRpc.on("close", () => { saveProfile(ROOT, profile); process.exit(0); });
} else {
  const packTitle = pack.title || pack.name;
  console.log(`\n${"═".repeat(56)}
  ${packTitle}
  知识库: ${index.chunks.length} 块 · 模型: ${MOCK ? "mock(脚本化)" : `${provider}/${modelId}`} · 学生: ${STUDENT}
  命令: /profile 看档案 · /reset 清对话 · /exit 退出
${"═".repeat(56)}\n`);

  async function runTurn(userText) {
    log({ student: STUDENT, role: "user", text: userText });
    await agent.prompt(userText);
  }

  if (ONCE) {
    await runTurn(ONCE);
    saveProfile(ROOT, profile);
    process.exit(0);
  }

  if (!assertApiKey()) process.exit(1);

  // 输入队列:行到达即缓存(而非依赖 rl.question 的时点),
  // 这样 LLM 回复期间到达的输入不会丢失——管道/程序化多轮输入的前提。
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lineQueue = [];
  const lineWaiters = [];
  let stdinClosed = false;
  rl.on("line", (l) => {
    if (lineWaiters.length) lineWaiters.shift()(l);
    else lineQueue.push(l);
  });
  rl.on("close", () => {
    stdinClosed = true;
    while (lineWaiters.length) lineWaiters.shift()("/exit");
  });
  function nextLine() {
    if (lineQueue.length) return Promise.resolve(lineQueue.shift());
    if (stdinClosed) return Promise.resolve("/exit");
    return new Promise((resolve) => lineWaiters.push(resolve));
  }
  process.on("SIGINT", () => { console.log("\n(中断当前回复,继续输入,或 /exit 退出)"); agent.abort(); });

  while (true) {
    process.stdout.write("你 › ");
    const input = await nextLine();
    const text = input.trim();
    if (!text) continue;
    if (text === "/exit" || text === "/quit" || text === "/q") break;
    if (text === "/profile") { console.log(renderProfile(profile) + "\n(完整档案: students/" + STUDENT + ".json)"); continue; }
    if (text === "/reset") { agent.reset(); console.log("(已清空对话,学习档案保留)\n"); continue; }
    if (text === "/help") { console.log("直接输入即对话。/profile /reset /exit\n"); continue; }
    try {
      await runTurn(text);
    } catch (e) {
      console.error(`\n✗ 出错了: ${e.message}\n`);
    }
    saveProfile(ROOT, profile); // 每轮落盘,防丢
    console.log();
  }

  saveProfile(ROOT, profile);
  rl.close();
  console.log(`\n学习档案已保存 → students/${STUDENT}.json`);
  console.log(`会话记录已保存 → ${sessionFile}`);
  if (totalCost > 0) console.log(`本次会话成本 ≈ $${totalCost.toFixed(4)}`);
  console.log("下次来会接着上次的进度继续教。再见!\n");
}
