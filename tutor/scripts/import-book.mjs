#!/usr/bin/env node
// 一键导入书籍 M3:PDF 或 URL → 章节感知切块 → kb(+可选 ctx) → 接力 make-book-page(导读页+读书导师 pack)。
// 用法:
//   node scripts/import-book.mjs --pdf /abs/book.pdf --slug my-book --title "书名" --authors "作者" \
//     [--pdf-link papers/pdf/book.pdf] [--ctx-run]
//   node scripts/import-book.mjs --url https://site/article --slug my-book [--title "…"] [--authors "…"] [--ctx-run]
// 产出: kb/<slug>-kb.json(+ -ctx.json 当 --ctx-run) + book-<slug>.html + packs/<slug>/ + drafts/<slug>/ + manifest
// 章节识别:英文 Chapter N / Appendix X,中文 第N章/部/讲;URL 按 h2 标题分节。识别不到 → 全书单章。
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const PDF = argOf("--pdf") ? resolve(argOf("--pdf")) : null;
const URL = argOf("--url") || null;
const SLUG = argOf("--slug") || "";
const TITLE = argOf("--title") || "";
const AUTHORS = argOf("--authors") || "";
const PDF_LINK = argOf("--pdf-link") || "";
const CTX_RUN = args.includes("--ctx-run");

if (!PDF === !URL) { console.error("✗ --pdf 与 --url 必须二选一"); process.exit(1); }
if (!SLUG || !/^[a-z0-9-]+$/.test(SLUG)) { console.error("✗ --slug 必填(小写字母/数字/-)"); process.exit(1); }
if (!TITLE) { console.error("✗ --title 必填"); process.exit(1); }
const KB_OUT = join(TUTOR, "kb", `${SLUG}-kb.json`);

// ---------- 中文数字 → 阿拉伯 ----------
const cnNum = (s) => {
  if (/^\d+$/.test(s)) return +s;
  const d = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, section = 0;
  for (const ch of s) {
    if (d[ch]) section = d[ch];
    else if (ch === "十") { total += (section || 1) * 10; section = 0; }
    else if (ch === "百") { total += (section || 1) * 100; section = 0; }
    else return NaN;
  }
  return total + section;
};

// ---------- 取正文 ----------
async function getText() {
  if (PDF) {
    if (!existsSync(PDF)) { console.error("✗ --pdf 不存在"); process.exit(1); }
    const out = join(TUTOR, "kb", "tmp-import-extract.json");
    const r = spawnSync("python3", [join(TUTOR, "scripts", "extract-pdf.py"), "--pdf", PDF, "--out", out], { stdio: "inherit" });
    if (r.status !== 0) { console.error("✗ PDF 提取失败"); process.exit(1); }
    const j = JSON.parse(readFileSync(out, "utf8"));
    unlinkSync(out);
    return { text: j.text, source: `${PDF.match(/[^/]+$/) && PDF.match(/[^/]+$/)[0]}(${j.pages} 页)`, link: PDF_LINK || "" };
  }
  // URL:抓页面 → 剥壳 → article/main 正文 → 带标题标记的纯文本
  console.log(`→ 抓取 ${URL}…`);
  const res = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh) AgentAcademy/1.0", "Accept": "text/html" }, signal: AbortSignal.timeout(30000) })
    .catch((e) => { console.error("✗ 抓取失败:", e.message); process.exit(1); });
  if (!res.ok) { console.error(`✗ HTTP ${res.status}`); process.exit(1); }
  const html = await res.text();
  const ogTitle = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i) || [])[1];
  const rawTitle = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1];
  const main = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  const ents = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019", middot: "·" };
  let t = main
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|li|tr|blockquote|pre|table|ul|ol)>/gi, "\n\n")
    .replace(/<h1[^>]*>/gi, "\n\n# ").replace(/<h2[^>]*>/gi, "\n\n## ").replace(/<h3[^>]*>/gi, "\n\n### ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, "");
  t = t.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&([a-z]+);/gi, (m, n) => ents[n.toLowerCase()] ?? m);
  t = t.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length < 2000) { console.error(`✗ 正文太短(${t.length} 字符),可能抽取失败`); process.exit(1); }
  return { text: t, source: `URL 导入 · ${URL.replace(/^https?:\/\//, "").slice(0, 60)}(${(t.length / 1000).toFixed(0)}k 字)`, link: PDF_LINK || URL, titleHint: (ogTitle || rawTitle || "").trim().split(/[|–—·]/)[0].trim() };
}

// ---------- 分章 ----------
function splitChapters(text, isUrl) {
  if (isUrl) {
    // h2 标记分节(### 归入所在 ## 节)
    const parts = text.split(/\n(?=## )/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return parts.map((p, i) => {
        const head = (p.match(/^## (.+)$/) || [])[1] || `第 ${i + 1} 节`;
        return { no: i + 1, title: head.slice(0, 90), body: p };
      });
    }
    return [{ no: 1, title: "全文", body: text }];
  }
  // PDF:英文 Chapter/Appendix 与中文 第N章 两组,取命中多的一组
  const fams = [
    { name: "chapter", re: /^[ \t]{0,4}(chapter[ \t]+(\d{1,2})\b[^\n]{0,80})$/gim, num: (m) => +m[2] },
    { name: "cn", re: /^[ \t]{0,4}(第\s*([0-9一二三四五六七八九十百]+)\s*[章部讲][^\n]{0,60})$/gm, num: (m) => cnNum(m[2]) },
  ];
  let best = null;
  for (const f of fams) {
    const ms = [...text.matchAll(f.re)];
    const uniq = new Set(ms.map((m) => f.num(m)));
    if (!best || uniq.size > best.uniq) best = { f, ms, uniq: uniq.size };
  }
  const aps = [...text.matchAll(/^[ \t]{0,4}(appendix[ \t]+([a-z0-9]+)\b[^\n]{0,80})$/gim)];
  if (best && best.uniq >= 2) {
    const { f, ms } = best;
    const marks = ms.map((m) => ({ idx: m.index, no: f.num(m), title: m[1].trim().slice(0, 90) }))
      .filter((m) => Number.isFinite(m.no));
    const out = [];
    for (let i = 0; i < marks.length; i++) {
      const body = text.slice(marks[i].idx, marks[i + 1]?.idx).replace(/^[^\n]+\n?/, "").trim();
      let no = marks[i].no;
      if (out.some((c) => c.no === no)) no = out.length + 1; // TOC 重复/编号异常:顺序重排
      if (body.length > 400) out.push({ no, title: marks[i].title, body });
    }
    // 附录:正章之后出现,编号 100+
    const apStarts = aps.map((ap) => ({ idx: ap.index, title: ap[1].trim().slice(0, 90) }));
    for (let i = 0; i < apStarts.length; i++) {
      const end = i + 1 < apStarts.length ? apStarts[i + 1].idx : text.length;
      const seg = text.slice(apStarts[i].idx, end).replace(/^[^\n]+\n?/, "").trim();
      if (seg.length > 400 && !out.some((c) => c.title === apStarts[i].title)) out.push({ no: 100 + out.filter((c) => c.no >= 100).length, title: apStarts[i].title, body: seg });
    }
    if (out.length >= 2) return out.sort((a, b) => a.no - b.no);
  }
  return [{ no: 1, title: "全文", body: text }];
}

// ---------- 切块(段边界,~1400 字符) ----------
function chunkChapter(ch, prefix, counter) {
  const paras = ch.body.split(/\n\n+/).map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter((p) => p.length > 30 && !/^\.{3,}\s*\d+\s*$/.test(p)); // 滤目录点线
  const chunks = [];
  let cur = "", head = "";
  for (const p of paras) {
    if (!head) head = p.slice(0, 70);
    if (cur && (cur + "\n" + p).length > 1500) { chunks.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + p;
    if (cur.length >= 1100) { chunks.push(cur); cur = ""; }
  }
  if (cur && cur.length > 100) chunks.push(cur);
  else if (cur) { if (chunks.length) chunks[chunks.length - 1] += "\n" + cur; else chunks.push(cur); }
  return chunks.map((text) => {
    const id = `${prefix}${String(counter.n++).padStart(3, "0")}`;
    const chTitle = (ch.title.split(/[:：]/)[0] || ch.title).slice(0, 30);
    return { id, source: SLUG, chapter: ch.no, chapterTitle: chTitle, title: ch.title.slice(0, 60), chars: text.length, text };
  });
}

// ---------- 主流程 ----------
const got = await getText();
console.log(`→ 正文 ${got.text.length} 字符 · 来源 ${got.source}`);
const chapters = splitChapters(got.text, !!URL);
console.log(`→ 分章:${chapters.length} 章 ${URL ? "(按 h2)" : "(按章标题识别,不足 2 章则全书单章)"}`);

const prefix = (SLUG.replace(/[^a-z]/g, "").slice(0, 2) || "bk");
const counter = { n: 0 };
const chunks = [];
for (const ch of chapters) chunks.push(...chunkChapter(ch, prefix, counter));
if (!chunks.length) { console.error("✗ 切块为空"); process.exit(1); }
const kbJson = {
  meta: { builtAt: new Date().toISOString(), source: `${SLUG} 导入 · ${got.source}`, chunkCount: chunks.length, chapters: [...new Set(chunks.map((c) => c.chapter))] },
  chunks,
};
writeFileSync(KB_OUT, JSON.stringify(kbJson, null, 1));
console.log(`✓ kb: kb/${SLUG}-kb.json(${chunks.length} 块,${chapters.length} 章)`);

// 可选:上下文化索引
if (CTX_RUN) {
  console.log("→ 生成上下文化索引(--ctx-run)…");
  const r = spawnSync(process.execPath, [join(TUTOR, "scripts", "build-context.mjs"), "--kb", `kb/${SLUG}-kb.json`, "--title", TITLE], { stdio: "inherit" });
  if (r.status !== 0) console.log("  (ctx 生成失败,继续不带 ctx)");
}
const finalCtx = CTX_RUN && existsSync(KB_OUT.replace(/\.json$/, "-ctx.json")) ? ["--ctx", KB_OUT.replace(/\.json$/, "-ctx.json")] : [];

console.log("→ 接力 make-book-page(导读页 + 读书导师 pack)…");
const pass = ["--kb", KB_OUT, ...finalCtx, "--slug", SLUG, "--title", TITLE, "--pdf-link", got.link, "--pack", SLUG];
if (AUTHORS) pass.push("--authors", AUTHORS);
const r = spawnSync(process.execPath, [join(TUTOR, "scripts", "make-book-page.mjs"), ...pass], { stdio: "inherit" });
process.exit(r.status ?? 1);
