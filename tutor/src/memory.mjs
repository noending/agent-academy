// 学生记忆:每个学生一份 profile.json,记录水平、已掌握概念、误解与下一步计划。
// 这份档案会注入 system prompt,由模型通过工具更新, tutor 退出时落盘。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export function studentsDir(root) {
  // TUTOR_DATA_DIR:嵌入方(App)用来把学生数据重定向到 Application Support;默认跟随程序目录
  return process.env.TUTOR_DATA_DIR
    ? join(process.env.TUTOR_DATA_DIR, "students")
    : join(root, "students");
}

export function loadProfile(root, id) {
  const file = join(studentsDir(root), `${id}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  return {
    id,
    createdAt: new Date().toISOString(),
    level: "beginner",
    goal: null,
    mastered: [], // { topic, evidence, date }
    misconceptions: [], // { topic, note, date, resolved: false }
    currentFocus: null,
    nextStep: null,
    sessions: 0,
  };
}

export function saveProfile(root, profile) {
  profile.updatedAt = new Date().toISOString();
  const file = join(studentsDir(root), `${profile.id}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(profile, null, 2));
  return file;
}

// 注入 system prompt 的紧凑视图
export function renderProfile(profile) {
  if (!profile.mastered.length && !profile.misconceptions.length && !profile.currentFocus) {
    return "（新学生,暂无学习记录。请先了解学生的基础与目标,再开始教学。）";
  }
  const lines = [`- 水平: ${profile.level}`, `- 目标: ${profile.goal ?? "未设定"}`];
  if (profile.mastered.length)
    lines.push(
      `- 已掌握: ${profile.mastered.map((m) => m.topic).join("、")}`
    );
  if (profile.misconceptions.length) {
    const open = profile.misconceptions.filter((m) => !m.resolved);
    if (open.length)
      lines.push(
        `- 已知误解(待纠正): ${open.map((m) => `${m.topic}(${m.note})`).join("、")}`
      );
  }
  if (profile.currentFocus) lines.push(`- 当前 focus: ${profile.currentFocus}`);
  if (profile.nextStep) lines.push(`- 下一步: ${profile.nextStep}`);
  lines.push(`- 累计学习次数: ${profile.sessions}`);
  return lines.join("\n");
}
