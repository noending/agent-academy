#!/usr/bin/env node
// 全站 app.js 缓存版本 bump:v28 → v29(搜索索引扩展)。style.css 不变保持 v24。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
for (const f of readdirSync(SITE)) {
  if (!f.endsWith(".html")) continue;
  const p = join(SITE, f);
  const html = readFileSync(p, "utf8");
  if (!html.includes("app.js?v=28")) continue;
  writeFileSync(p, html.replaceAll("app.js?v=28", "app.js?v=29"));
  n++;
}
console.log(`✓ app.js v28→v29 已应用于 ${n} 个页面`);
