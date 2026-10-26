#!/usr/bin/env node
// 发布读书导读:剥掉机器初稿标记(与 publish-course 同规矩),manifest 标记 approved。
// 用法: node scripts/publish-book.mjs --slug <slug>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { updateManifest, readManifest } from "./factory-common.mjs";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const args = process.argv.slice(2);
const slug = args[args.indexOf("--slug") + 1];
if (!slug) { console.error("✗ --slug 必填"); process.exit(1); }

const page = join(SITE, `book-${slug}.html`);
if (!existsSync(page)) { console.error(`✗ 找不到 ${page}`); process.exit(1); }

let html = readFileSync(page, "utf8");
const before = html.length;
html = html.replace(/<span style="color:var\(--warn\)">\(机器导读初稿\)<\/span>/g, "");
html = html.replace(/\(机器导读初稿\)/g, "");
html = html.replace(/读书导读 · 机器初稿 · 未审勿发布/g, "读书导读 · 已审核发布");
html = html.replace(/读书 · 机器初稿/g, "读书 · 已审核发布");
html = html.replace(/机器导读初稿(自动生成,未经人工审校)/g, "导读(已人工审核)");
html = html.replace(/<br><b style="color:var\(--warn\)">本页由读书管线自动生成,尚未人工审校。<\/b>/g, "");
// 整块移除「人审须知」callout
html = html.replace(/<div class="callout warn">\s*<div class="co-title">人审须知[^<]*<\/div>[\s\S]*?<\/p>\s*<\/div>/, "");
html = html.replace(/\((机器观点,待审)\):/g, ":");
html = html.replace(/(机器生成,待审)/g, "");
if (html.length === before) console.log("· 页面无需变更(可能已发布)");
else writeFileSync(page, html);

const cur = (readManifest().courses || []).find((c) => c.slug === slug);
const cleanDesc = (cur?.description || "").replace(/读书导读[(（]?(机器导读初稿|机器初稿)[)）]?[:：]?/g, "").replace(/机器初稿[:]?/g, "");
updateManifest({ slug, approved: true, published: true, description: cleanDesc ? (cur.description.includes("读书导读") ? cleanDesc : "读书导读:" + cleanDesc) : cur?.description || "" });
const m = readManifest();
const entry = (m.courses || []).find((c) => c.slug === slug);
console.log(`✓ ${slug} 已发布(book-${slug}.html 剥初稿标记;manifest approved=true)`);
if (entry?.pack) console.log(`  读书导师: node src/tutor.mjs --pack packs/${entry.pack}(在 tutor/ 下)`);
console.log("  收尾: node scripts/check-site.mjs 全绿 → git commit + push");
