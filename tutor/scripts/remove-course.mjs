#!/usr/bin/env node
// 删除一门生成的课程:教学包 + 知识库 + 草稿页 + 人审清单 + 清单条目。
// 安全: agent-dev(主课程)不可删除;调用方(App 深链)负责二次确认。
// 用法: node scripts/remove-course.mjs --skill <slug>
import { existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { removeFromManifest } from "./factory-common.mjs";

const TUTOR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(TUTOR, "..");
const args = process.argv.slice(2);
const skill = args[args.indexOf("--skill") + 1];

if (!skill) { console.error("✗ --skill 必填"); process.exit(1); }
if (skill === "agent-dev") { console.error("✗ 主课程不可删除"); process.exit(1); }

let removed = 0;
for (const p of [
  join(TUTOR, "packs", skill),
  join(TUTOR, "kb", `${skill}-kb.json`),
  join(SITE, `full-${skill}.html`),
  join(SITE, "drafts", skill),
]) {
  if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed++; console.log("✓ 已删除", p); }
}
removeFromManifest(skill);
console.log(`✓ 课程 ${skill} 已移除(${removed} 项)`);
