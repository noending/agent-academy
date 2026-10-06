// 内容工厂共享模块:课程清单(courses-manifest.json)的读写。
// 三条管线(M1/M2/M3)生成完成后调用 updateManifest 挂入课程管理页;
// remove-course.mjs 调用 removeFromManifest 摘除。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(SITE, "courses-manifest.json");

export function readManifest() {
  if (existsSync(MANIFEST)) {
    try { return JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { /* 损坏则重建 */ }
  }
  return { courses: [], updatedAt: null };
}

export function updateManifest(entry) {
  const m = readManifest();
  m.courses = (m.courses || []).filter((c) => c.slug !== entry.slug);
  m.courses.unshift({ ...entry, generatedAt: new Date().toISOString() });
  m.updatedAt = new Date().toISOString();
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
  return m;
}

export function removeFromManifest(skill) {
  if (!existsSync(MANIFEST)) return;
  const m = readManifest();
  m.courses = (m.courses || []).filter((c) => c.slug !== skill);
  m.updatedAt = new Date().toISOString();
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}
