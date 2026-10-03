#!/usr/bin/env node
// ① 上下文化索引(Anthropic Contextual Retrieval 的本地化实现):
//   对每个知识块,用 LLM 生成一句中文上下文前缀(说明它在全书中的位置与主题,
//   含关键术语中英对照),检索时索引进前缀、展示仍用原文。
// 用法: node scripts/build-context.mjs   (需要 DEEPSEEK_API_KEY)
// 产出: kb/course-chunks-ctx.json / kb/gulli-patterns-ctx.json
// 特性: 8 路并发 · 逐块落盘可断点续跑 · 单块失败自动降级为空前缀
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { completeSimple, getModel } from "@mariozechner/pi-ai";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONCURRENCY = 8;
const MODEL = getModel("deepseek", "deepseek-v4-flash"); // 平台侧即 V4.1-Flash
const SYSTEM = "你是检索索引优化器。为给定的知识块生成一句中文上下文前缀:说明该块在整本书/课程中的位置与主题,保留关键术语(中英对照)。只输出这一句话,不超过 60 字,不要引号、不要任何多余内容。";

const SOURCES = [
  {
    file: "kb/course-chunks.json",
    out: "kb/course-chunks-ctx.json",
    doc: (c) => `《Agent 学院》${c.chapterTitle}${c.section ? " " + c.section : ""} ${c.title}`,
  },
  {
    file: "kb/gulli-patterns.json",
    out: "kb/gulli-patterns-ctx.json",
    doc: (c) => `Gulli《Agentic Design Patterns》${c.chapterTitle} ${c.title}`,
  },
];

const client = { key: process.env.DEEPSEEK_API_KEY };

async function makeContext(chunk, docLabel) {
  const user =
    `文档位置:${docLabel(chunk)}\n` +
    `块内容(节选):\n${chunk.text.slice(0, 900)}`;
  const r = await completeSimple(MODEL, {
    systemPrompt: SYSTEM,
    messages: [{ role: "user", content: user, timestamp: Date.now() }],
  }, { apiKey: client.key, maxTokens: 200, temperature: 0 });
  const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  return text.replace(/^["'「」\s]+|["'「」\s]+$/g, "").slice(0, 120);
}

async function pool(items, worker, n = CONCURRENCY) {
  let i = 0;
  const runners = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function processSource(src) {
  const outPath = join(ROOT, src.out);
  const { meta, chunks } = JSON.parse(readFileSync(join(ROOT, src.file), "utf8"));
  const prev = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
  const done = new Map((prev?.chunks || []).filter((c) => c.context).map((c) => [c.id, c.context]));

  let okCount = 0, skipCount = 0, failCount = 0, tick = 0;
  await pool(chunks, async (c) => {
    if (done.has(c.id)) { c.context = done.get(c.id); skipCount++; return; }
    try {
      c.context = await makeContext(c, src.doc);
      okCount++;
    } catch (e) {
      c.context = ""; // 降级:无前缀,不影响原检索
      failCount++;
    }
    if (++tick % 50 === 0) {
      writeFileSync(outPath, JSON.stringify({
        meta: { ...meta, contextualized: true, builtAt: new Date().toISOString() },
        chunks,
      }, null, 1));
      console.log(`  [${src.out}] ${tick}/${chunks.length}(失败 ${failCount})`);
    }
  });

  writeFileSync(outPath, JSON.stringify({
    meta: { ...meta, contextualized: true, builtAt: new Date().toISOString() },
    chunks,
  }, null, 1));
  console.log(`✓ ${src.out}: 新生成 ${okCount} · 续用 ${skipCount} · 失败 ${failCount}`);
}

for (const src of SOURCES) {
  if (!existsSync(join(ROOT, src.file))) { console.log(`跳过 ${src.file}(不存在)`); continue; }
  console.log(`→ ${src.file}`);
  await processSource(src);
}
console.log("完成。retrieval 会在 ctx 文件存在时优先加载。");
