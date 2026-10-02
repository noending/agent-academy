/* ============================================================
 实验室 5：提示词 A/B 对比器（第 3 章）
 同一个抽取任务 × 三代提示词，对比模拟输出质量差异。
 纯前端模拟（输出为手工标定的教学示例）。
 ============================================================ */
"use strict";

function initPromptAB() {
 const root = document.getElementById("lab-prompt-ab");
 if (!root) return;

 const grid = root.querySelector(".ab-grid");
 const revealBtn = root.querySelector("[data-act=reveal]");
 const noteEl = root.querySelector(".viz-note");

 const SAMPLE = "小王说下周三下午三点和产品碰一下登录改版，可能要开挺久，先记着。李雷补充最好把安全组也叫上，张总参不参加还没定。地点老地方。";

 const VERSIONS = [
 {
 tag: "V1", label: "一句话提示", cls: "bad",
 prompt: "帮我把这段会议记录整理成JSON：\n「" + SAMPLE + "」",
 output: `好的，整理如下：\n\n这次会议是关于登录改版的产品评审会，\n由小王组织，李雷也参加，地点在\n老地方（应该是公司会议室），\n时间是下周三下午三点，可能要开挺久。\n\n需要我帮你发会议邀请吗？`,
 checks: [
 [false, "输出是散文不是 JSON —— 没有格式约束，模型自由发挥"],
 [false, "漏掉了 attendees / status 等字段 —— 没定义字段清单"],
 [false, "「老地方（应该是公司会议室）」—— 编造了原文没有的信息"],
 ],
 },
 {
 tag: "V2", label: "规则 + 字段清单", cls: "mid",
 prompt: `你是会议信息抽取助手。从记录中抽取会议信息，输出 JSON，字段：\n- title: 会议主题\n- date: 日期\n- start_time: 开始时间\n- attendees: 参会人列表\n- location: 地点\n- status: 状态\n只输出 JSON，未知信息写 null，不要编造。\n\n记录：「` + SAMPLE + `」`,
 output: `{\n "title": "登录改版评审",\n "date": "下周三",\n "start_time": "下午三点",\n "attendees": ["小王", "李雷", "安全组"],\n "location": "老地方",\n "status": "confirmed"\n}`,
 checks: [
 [true, "JSON 格式正确、字段齐全 —— 规则区起效了"],
 [false, "date 写了「下周三」—— 没规定日期格式，机器没法用"],
 [false, "status 是 confirmed —— 没给枚举值，模型自由发挥（原文是「还没定」）"],
 [false, "「最好把安全组也叫上」是建议不是确认 —— attendees 边界没定义"],
 ],
 },
 {
 tag: "V3", label: "规则 + 枚举 + 格式 + 示例", cls: "good",
 prompt: `你是会议信息抽取助手。今天是 2026-09-29（周二）。\n\n【字段】title, date, start_time, attendees, location, status\n【格式】date 用 YYYY-MM-DD；time 用 24 小时制 HH:MM\n【status 枚举】confirmed / tentative / cancelled\n【规则】\n1. 相对时间（如「下周三」）按今天的日期换算\n2. attendees 只包含确认参加的人；仅被提议的不算\n3. 原文未明确的信息写 null，禁止推测\n\n【示例】\n输入：明天上午十点和设计对齐图标，会议室2，定了。\n输出：{"title":"图标对齐","date":"2026-09-30","start_time":"10:00","attendees":["我","设计"],"location":"会议室2","status":"confirmed"}\n\n记录：「` + SAMPLE + `」`,
 output: `{\n "title": "登录改版评审",\n "date": "2026-10-07",\n "start_time": "15:00",\n "attendees": ["小王", "李雷"],\n "location": null,\n "status": "tentative"\n}\n\n// location: 原文「老地方」无法解析为具体地点 → null\n// status: 「参不参加还没定」→ tentative`,
 checks: [
 [true, "「下周三」正确换算为 2026-10-07（今天是周二 09-29）"],
 [true, "时间标准化为 15:00 —— 机器可直接用于日历创建"],
 [true, "status 正确落入枚举 tentative"],
 [true, "location 诚实写 null —— 「禁止推测」规则生效"],
 ],
 },
 ];

 function render() {
 grid.innerHTML = VERSIONS.map((v, i) => `
 <div class="card ab-card ${v.cls}">
 <div class="ab-head"><span class="ab-tag">${v.tag}</span><b>${v.label}</b></div>
 <pre class="ab-prompt">${escapeLocal(v.prompt)}</pre>
 <pre class="ab-output">${escapeLocal(v.output)}</pre>
 <ul class="ab-checks" data-idx="${i}">
 ${v.checks.map(([ok, txt]) => `<li class="${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"} ${escapeLocal(txt)}</li>`).join("")}
 </ul>
 </div>`).join("");
 grid.querySelectorAll(".ab-checks").forEach(ul => ul.classList.add("hidden"));
 }

 function escapeLocal(s) {
 return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
 }

 revealBtn.addEventListener("click", () => {
 grid.querySelectorAll(".ab-checks").forEach(ul => ul.classList.remove("hidden"));
 revealBtn.disabled = true;
 noteEl.style.display = "block";
 });

 render();
}

document.addEventListener("DOMContentLoaded", initPromptAB);
