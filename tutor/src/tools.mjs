// 教学工具集:符合 pi-agent-core 的 AgentTool 接口(TypeBox schema + execute)。
import { Type } from "typebox";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function textResult(text, details = {}) {
  return { content: [{ type: "text", text }], details };
}

function makeTool(name, label, description, parameters, execute) {
  return { name, label, description, parameters, execute };
}

export function buildTools({ index, profile, root }) {
  const sandboxDir = mkdtempSync(join(tmpdir(), "tutor-sandbox-"));

  const lookup_course = makeTool(
    "lookup_course",
    "查课程",
    `检索《Agent 学院》课程知识库。教学前先查对应小节,回答时引用章节号(如 1.3)。query 用自然语言或关键词。可选 chapter 过滤(1-9)。`,
    Type.Object({
      query: Type.String({ description: "检索关键词或问题" }),
      chapter: Type.Optional(Type.Integer({ description: "限定章号 1-9,不确定就别填" })),
    }),
    async (_id, params) => {
      const hits = index.search(params.query, 3, params.chapter ?? null);
      return textResult(index.formatHits(hits), { hits: hits.map((h) => h.id) });
    }
  );

  const get_student_profile = makeTool(
    "get_student_profile",
    "读学生档案",
    "读取学生完整学习档案(水平、已掌握、误解、当前计划)。每轮教学开始时先调用。",
    Type.Object({}),
    async () => textResult(JSON.stringify(profile, null, 2))
  );

  const record_progress = makeTool(
    "record_progress",
    "记掌握",
    `当学生真正展示了理解(能自己解释、举对例子、预测行为),调用此工具记录。注意:学生"听懂了"不算,必须有展示理解的证据。topic 填课程概念名(如"Agent Loop"),evidence 写学生说了什么/做对了什么。`,
    Type.Object({
      topic: Type.String({ description: "概念名,如 Agent Loop、RAG" }),
      evidence: Type.String({ description: "学生展示理解的具体证据" }),
    }),
    async (_id, params) => {
      const dup = profile.mastered.find((m) => m.topic === params.topic);
      if (dup) {
        dup.evidence = params.evidence;
        dup.date = new Date().toISOString().slice(0, 10);
      } else
        profile.mastered.push({
          topic: params.topic,
          evidence: params.evidence,
          date: new Date().toISOString().slice(0, 10),
        });
      // 对应的误解若已解决,标记 resolved
      for (const m of profile.misconceptions) {
        if (m.topic === params.topic && !m.resolved) m.resolved = true;
      }
      return textResult(`已记录掌握: ${params.topic}`);
    }
  );

  const record_misconception = makeTool(
    "record_misconception",
    "记误解",
    `发现学生理解有偏差时调用(如"以为模型会自己执行工具")。后续教学要针对性纠正这个误解。`,
    Type.Object({
      topic: Type.String({ description: "相关概念名" }),
      note: Type.String({ description: "误解的具体内容" }),
    }),
    async (_id, params) => {
      const dup = profile.misconceptions.find((m) => m.topic === params.topic && !m.resolved);
      if (dup) dup.note = params.note;
      else
        profile.misconceptions.push({
          topic: params.topic,
          note: params.note,
          date: new Date().toISOString().slice(0, 10),
          resolved: false,
        });
      return textResult(`已记录误解: ${params.topic} — ${params.note}`);
    }
  );

  const update_plan = makeTool(
    "update_plan",
    "更新计划",
    `每次课结束时(或方向变化时)更新学习计划。level: beginner/intermediate/advanced。`,
    Type.Object({
      currentFocus: Type.Optional(Type.String({ description: "正在学什么" })),
      nextStep: Type.Optional(Type.String({ description: "下次课从哪继续" })),
      level: Type.Optional(Type.String({ description: "beginner | intermediate | advanced" })),
      goal: Type.Optional(Type.String({ description: "学生的长期目标" })),
    }),
    async (_id, params) => {
      if (params.currentFocus !== undefined) profile.currentFocus = params.currentFocus;
      if (params.nextStep !== undefined) profile.nextStep = params.nextStep;
      if (params.level !== undefined) profile.level = params.level;
      if (params.goal !== undefined) profile.goal = params.goal;
      return textResult("学习计划已更新");
    }
  );

  const run_code = makeTool(
    "run_code",
    "跑代码",
    `在教学沙箱里执行一段代码(javascript 或 python),返回 stdout/stderr。用于:验证你给的示例真的能跑、检查学生的练习答案。10 秒超时。不要用它执行有副作用的操作。`,
    Type.Object({
      language: Type.Union([Type.Literal("javascript"), Type.Literal("python")]),
      code: Type.String({ description: "完整代码" }),
    }),
    async (_id, params) => {
      const isPy = params.language === "python";
      const file = join(sandboxDir, `run.${isPy ? "py" : "mjs"}`);
      writeFileSync(file, params.code);
      const cmd = isPy ? "python3" : "node";
      try {
        const r = spawnSync(cmd, [file], { timeout: 10_000, encoding: "utf8", cwd: sandboxDir });
        const out = (r.stdout || "").slice(0, 4000);
        const err = (r.stderr || "").slice(0, 2000);
        const status = r.error?.code === "ETIMEDOUT" ? "⏱ 超时(10s)" : r.status === 0 ? "✓ 运行成功" : `✗ 退出码 ${r.status}`;
        return textResult(`${status}\n--- stdout ---\n${out || "(空)"}\n--- stderr ---\n${err || "(空)"}`);
      } catch (e) {
        return textResult(`执行失败: ${e.message}`);
      }
    }
  );

  return [lookup_course, get_student_profile, record_progress, record_misconception, update_plan, run_code];
}

