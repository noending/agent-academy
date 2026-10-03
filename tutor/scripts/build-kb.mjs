#!/usr/bin/env node
// 知识库构建:把站点 9 章 HTML 切成带元数据的文本块,供导师检索。
// 用法:node scripts/build-kb.mjs  →  生成 kb/course-chunks.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, ".."); // agent-academy 站点根目录
const OUT = join(ROOT, "kb", "course-chunks.json");
const MAX_CHUNK_CHARS = 1800; // 超过则按 h3 再切

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// HTML → 纯文本:块级标签换行,去标签,解码实体,压平空白
function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/pre|\/table)\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .replace(/^\s+|\s+$/gm, (m) => (m.includes("\n") ? "\n" : ""))
    .trim();
}

function chapterNumber(file) {
  return parseInt(basename(file, ".html").slice(0, 2), 10);
}

function splitHtmlByTag(html, tag) {
  // 按 <tag ...>标题</tag> 之后的位置切块,保留标题文本
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m.index > last) parts.push({ heading: null, html: html.slice(last, m.index) });
    parts.push({ heading: m[1], html: html.slice(m.index + m[0].length) });
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ heading: null, html: html.slice(last) });
  return parts;
}

function extractMainHtml(raw) {
  const main = raw.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  return main ? main[1] : raw;
}

const files = readdirSync(SITE)
  .filter((f) => /^\d{2}-.*\.html$/.test(f)) // 章节页:01 ~ 10(新增章节自动纳入)
  .sort();

const chunks = [];
let chunkId = 0;

for (const file of files) {
  const raw = readFileSync(join(SITE, file), "utf8");
  const chapter = chapterNumber(file);
  const docTitle = (raw.match(/<title>([^<]*)<\/title>/i)?.[1] || file)
    .split("|")[0]
    .replace(/第\s*(\d+)\s*章\s*·\s*/, "第$1章 ")
    .trim();

  const sections = splitHtmlByTag(extractMainHtml(raw), "h2");
  for (const sec of sections) {
    const secTitle = sec.heading ? htmlToText(sec.heading) : null;
    // 只保留编号小节(1.1 / 7.8)与「交互实验」节,丢弃页头页尾杂项
    const isNumbered = /^\d+\.\d+/.test(secTitle || "");
    const isLab = /^(交互实验|实验)/.test(secTitle || "");
    if (!secTitle || (!isNumbered && !isLab)) continue;

    const sectionNo = (secTitle.match(/^(\d+\.\d+)/) || [])[1] || null;
    // 每个小节内部再按 h3 细分,避免单块过长
    const subs = splitHtmlByTag(sec.html, "h3");
    let buf = { headings: [], html: "" };
    const flush = () => {
      const text = htmlToText(
        (buf.headings.length ? `<p>${buf.headings.join(" — ")}</p>` : "") + buf.html
      );
      if (text.length < 80) return; // 丢弃过短碎块
      chunks.push({
        id: `c${String(chunkId++).padStart(3, "0")}`,
        chapter,
        chapterTitle: docTitle,
        file,
        section: sectionNo,
        title: secTitle,
        chars: text.length,
        text,
      });
    };
    buf.html = "";
    buf.headings = [];
    for (const sub of subs) {
      if (sub.heading) {
        // h3 边界:先结算当前缓冲
        flush();
        buf = { headings: [htmlToText(sub.heading)], html: "" };
      } else {
        buf.html += sub.html;
      }
    }
    flush();
  }
}

// 超长块二次对半切(按段落边界),保证检索粒度
const finalChunks = [];
for (const c of chunks) {
  if (c.chars <= MAX_CHUNK_CHARS * 1.4) {
    finalChunks.push(c);
    continue;
  }
  const paras = c.text.split(/\n\n+/);
  let cur = "";
  let part = 1;
  const emit = () => {
    if (cur.trim().length < 80) return;
    finalChunks.push({ ...c, id: `${c.id}-${part++}`, chars: cur.length, text: cur.trim() });
  };
  for (const p of paras) {
    if ((cur + p).length > MAX_CHUNK_CHARS && cur) {
      emit();
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + p;
  }
  emit();
}

mkdirSync(dirname(OUT), { recursive: true });
const meta = {
  builtAt: new Date().toISOString(),
  source: "agent-academy 站点 9 章",
  chunkCount: finalChunks.length,
  chapters: [...new Set(finalChunks.map((c) => c.chapter))],
};
writeFileSync(OUT, JSON.stringify({ meta, chunks: finalChunks }, null, 1));
console.log(
  `✓ ${files.length} 章 → ${finalChunks.length} 个知识块 (${(finalChunks.reduce((s, c) => s + c.chars, 0) / 1000).toFixed(0)}k 字符)\n  → ${OUT}`
);
