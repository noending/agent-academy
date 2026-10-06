#!/usr/bin/env node
// 内容工厂端到端测试(真实 API,成本约几分钱):
//   source ~/.zshrc 后 node test/factory-e2e.mjs
// M1: react.pdf → 草稿页(断言 seg 结构/人审清单)
// M2: mlabonne/llm-course → 教学包(断言大纲/知识库/检索)
// M2-RPC: --pack --rpc --mock 走握手+页面上下文(断言档案按包隔离)
// M3: 课题 → 整门课(断言 4 章/教学包/草稿页)
// 全部用 e2e-* 命名,结束后清理。
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
let failed = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- M1: 论文管线 ----------
console.log("\n── M1 论文管线(真实 API)──");
{
  const out = spawnSync(process.execPath,
    [join(TUTOR, "scripts", "make-paper-page.mjs"), "--pdf", join(SITE, "papers/pdf/react.pdf"),
     "--slug", "e2e-paper", "--title-en", "ReAct: Synergizing Reasoning and Acting in Language Models",
     "--authors", "Yao et al., ICLR 2023", "--pdf-link", "papers/pdf/react.pdf"],
    { encoding: "utf8", cwd: TUTOR, timeout: 480_000 });
  check("M1: 管线退出码 0", out.status === 0, out.status !== 0 ? (out.stderr || out.stdout).slice(-300) : "");
  const page = join(SITE, "full-e2e-paper.html");
  if (existsSync(page)) {
    const html = readFileSync(page, "utf8");
    check("M1: 草稿页含翻译段(seg-zh)", html.includes('class="seg-zh"'));
    check("M1: 草稿页含解读(seg-note)", html.includes("seg-note"));
    check("M1: 草稿页含关键句精读(qn)", html.includes('class="qn"'));
    check("M1: 草稿页带未审标识", html.includes("未审勿发布"));
    check("M1: REVIEW.md 存在", existsSync(join(SITE, "drafts/e2e-paper/REVIEW.md")));
  } else {
    check("M1: 草稿页生成", false);
  }
}

// ---------- M2: 仓库 → 教学包 ----------
console.log("\n── M2 仓库 → 教学包(真实 API)──");
{
  const out = spawnSync(process.execPath,
    [join(TUTOR, "scripts", "make-pack-from-repo.mjs"), "--repo", "mlabonne/llm-course",
     "--skill", "e2e-repo", "--goal", "端到端测试目标"],
    { encoding: "utf8", cwd: TUTOR, timeout: 480_000 });
  check("M2: 管线退出码 0", out.status === 0, out.status !== 0 ? (out.stderr || out.stdout).slice(-300) : "");
  const pj = join(TUTOR, "packs/e2e-repo/pack.json");
  if (existsSync(pj)) {
    const pack = JSON.parse(readFileSync(pj, "utf8"));
    check("M2: 大纲 ≥5 章", (pack.curriculum || []).length >= 5, `${(pack.curriculum || []).length} 章`);
    check("M2: sources 声明式", Array.isArray(pack.sources) && pack.sources.length > 0);
    check("M2: 知识库非空", existsSync(join(TUTOR, "kb/e2e-repo-kb.json")));
    check("M2: 起步问题 ≥4", (pack.starterQuestions || []).length >= 4);
    check("M2: 每章预置问题 ≥2", (pack.curriculum || []).every((c) => (c.questions || []).length >= 2),
      pack.curriculum?.[0]?.questions?.[0]);
  } else {
    check("M2: 教学包生成", false);
  }
}

// ---------- M2-RPC: 换包流程 + 档案隔离(mock,零 API 成本) ----------
console.log("\n── RPC 换包流程 + 档案隔离 ──");
{
  const child = spawn(process.execPath,
    [join(TUTOR, "src", "tutor.mjs"), "--mock", "--rpc", "--pack", "packs/e2e-repo", "--student", "e2e-m2"],
    { cwd: TUTOR, stdio: ["pipe", "pipe", "pipe"] });
  const events = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d; let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const s = buf.slice(0, i); buf = buf.slice(i + 1);
      try { events.push(JSON.parse(s)); } catch {}
    }
  });
  const wait = (type, nth = 1, timeoutMs = 20_000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      const found = events.filter((x) => x.type === type);
      if (found.length >= nth) return res(found[nth - 1]);
      if (Date.now() - t0 > timeoutMs) return rej(new Error(`等待第${nth}个 ${type} 超时`));
      setTimeout(tick, 50);
    };
    tick();
  });
  const hello = await wait("hello").catch(() => null);
  check("RPC: hello 握手(含课程名)", !!hello && String(hello.model || hello.student).length > 0);
  child.stdin.write(JSON.stringify({ type: "greet" }) + "\n");
  await wait("ready", 1).catch(() => null);
  check("RPC: greet 开场", events.some((x) => x.type === "delta" && x.text));
  child.stdin.write(JSON.stringify({ type: "context", page: { file: "README.md", title: "LLM Course" } }) + "\n");
  child.stdin.write(JSON.stringify({ type: "user", text: "这门课第一章讲什么?" }) + "\n");
  await wait("ready", 2).catch(() => null);
  const toolCall = events.find((x) => x.type === "tool_start" && x.name === "lookup_course");
  check("RPC: 工具调用指向 e2e-repo 知识库", !!toolCall, toolCall && JSON.stringify(toolCall.args).slice(0, 80));
  child.stdin.write(JSON.stringify({ type: "control", cmd: "exit" }) + "\n");
  await new Promise((res) => { const t0 = Date.now(); const tick = () => child.exitCode !== null ? res(1) : Date.now() - t0 > 8000 ? res(0) : setTimeout(tick, 50); tick(); });
  const prof = join(TUTOR, "students", "e2e-m2@e2e-repo.json");
  check("RPC: 档案按包隔离(id@pack)", existsSync(prof));
  rmSync(prof, { force: true });
  rmSync(join(TUTOR, "students", "e2e-m2@e2e-repo.session.jsonl"), { force: true });
}

// ---------- M3: 课题 → 整门课 ----------
console.log("\n── M3 课题 → 整门课(真实 API)──");
{
  const out = spawnSync(process.execPath,
    [join(TUTOR, "scripts", "make-course-from-topic.mjs"), "--topic", "提示词工程入门",
     "--skill", "e2e-topic", "--chapters", "4", "--goal", "端到端测试"],
    { encoding: "utf8", cwd: TUTOR, timeout: 480_000 });
  check("M3: 管线退出码 0", out.status === 0, out.status !== 0 ? (out.stderr || out.stdout).slice(-300) : "");
  const pj = join(TUTOR, "packs/e2e-topic/pack.json");
  if (existsSync(pj)) {
    const pack = JSON.parse(readFileSync(pj, "utf8"));
    check("M3: 4 章生成", (pack.curriculum || []).length === 4);
    check("M3: 每章预置问题 ≥2", (pack.curriculum || []).every((c) => (c.questions || []).length >= 2));
    check("M3: generated 标记(pack)", pack.generated === true);
    const kb = JSON.parse(readFileSync(join(TUTOR, "kb/e2e-topic-kb.json"), "utf8"));
    check("M3: 知识库块带 generated 标记", kb.chunks.length > 0 && kb.chunks.every((c) => c.generated));
    const home = join(SITE, "full-e2e-topic.html");
    check("M3: 课程首页生成", existsSync(home));
    const mf = join(SITE, "courses-manifest.json");
    const mEntry = existsSync(mf) ? (JSON.parse(readFileSync(mf, "utf8")).courses || []).find((c) => c.slug === "e2e-topic") : null;
    check("M3: manifest 登记分章 file", !!mEntry && (mEntry.chapters || []).every((c) => !!c.file));
    check("M3: 分章页面生成(每章一页)", !!mEntry && (mEntry.chapters || []).every((c) => existsSync(join(SITE, c.file || "x"))), mEntry && (mEntry.chapters || []).map((c) => c.file).join(","));
    if (existsSync(home)) {
      const html = readFileSync(home, "utf8");
      check("M3: 首页含课程目录与工具条", html.includes("course-card") && html.includes("draft-toolbar"));
      check("M3: 首页携带生成课程元数据", html.includes("data-gen-course"));
    }
  } else {
    check("M3: 教学包生成", false);
  }
}

// ---------- 清理 + 站点复检 ----------
console.log("\n── 清理 e2e 产物 ──");
for (const p of [
  join(SITE, "full-e2e-paper.html"), join(SITE, "drafts/e2e-paper"),
  join(SITE, "full-e2e-topic.html"),
  join(TUTOR, "packs/e2e-repo"), join(TUTOR, "kb/e2e-repo-kb.json"),
  join(TUTOR, "packs/e2e-topic"), join(TUTOR, "kb/e2e-topic-kb.json"),
  join(TUTOR, "kb/tmp-paper-extract.json"),
]) rmSync(p, { force: true, recursive: true });
for (const f of readdirSync(SITE)) {
  if (/^e2e-topic-ch\d+\.html$/.test(f)) rmSync(join(SITE, f), { force: true });
}
console.log("✓ e2e 产物已清理");

const siteCheck = spawnSync("node", [join(SITE, "scripts", "check-site.mjs")], { encoding: "utf8", cwd: SITE });
check("站点检查器全绿(清理后)", siteCheck.status === 0, siteCheck.status !== 0 ? siteCheck.stdout.slice(-300) : "");

console.log(failed ? `\n${failed} 项失败` : "\n端到端全部通过 ✓");
process.exit(failed ? 1 : 0);
