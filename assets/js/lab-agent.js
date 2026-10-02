/* ============================================================
 实验室 1：Agent Loop 模拟器（第 1 章）
 实验室 2：Function Calling 消息数组可视化（第 2 章）
 纯前端模拟，不调用任何 API
 ============================================================ */
"use strict";

/* ================= 实验室 1：Agent Loop 模拟器 ================= */
function initAgentLoopSim() {
 const root = document.getElementById("lab-agent-loop");
 if (!root) return;

 const traceEl = root.querySelector(".trace");
 const statusEl = root.querySelector(".sim-status");
 const stepEl = root.querySelector(".sim-step");
 const playBtn = root.querySelector("[data-act=play]");
 const stepBtn = root.querySelector("[data-act=step]");
 const resetBtn = root.querySelector("[data-act=reset]");
 const toolSwitch = root.querySelector("#sim-use-tools");

 const ROLE_META = {
 user: { cls: "role-user", icon: "", label: "用户" },
 thought: { cls: "role-thought", icon: "", label: "思考 Thought" },
 action: { cls: "role-action", icon: "", label: "行动 Tool Call" },
 obs: { cls: "role-obs", icon: "", label: "观察 Observation" },
 answer: { cls: "role-answer", icon: "", label: "最终回答" },
 };
 const STAGE = { user: "接收输入", thought: " 思考（LLM 推理）", action: " 行动（调用工具）",
 obs: " 观察（获取结果）", answer: " 终止（输出回答）" };

 const WITH_TOOLS = [
 { role: "user", text: "明天北京天气怎么样？我早上想晨跑，怕淋雨。" },
 { role: "thought", text: "用户问的是「明天」的天气——这是实时信息，我的训练数据里没有，绝不能靠猜。好在这次我有工具可用：先调用 get_weather 查询。", loop: 1 },
 { role: "action", text: 'get_weather(city="北京", date="明天")', loop: 1 },
 { role: "obs", text: '{ "city": "北京", "date": "明天",\n "weather": "小雨", "temp": "12~20°C", "wind": "3级" }' },
 { role: "thought", text: "明天有小雨、气温 12~20°C，不适合户外晨跑；而且用户明确说「怕淋雨」——我应该顺手帮他设置一个带伞提醒，于是再调用 add_reminder。", loop: 2 },
 { role: "action", text: 'add_reminder(time="明早 07:00", content="出门带伞，今天有小雨")', loop: 2 },
 { role: "obs", text: '{ "ok": true, "msg": "已在 明早 07:00 创建提醒" }' },
 { role: "answer", text: "明天北京有小雨，气温 12~20°C，还有 3 级风，不太适合户外晨跑——建议改约室内跑步机，或看看后天（天气工具显示后天转晴）。另外我已帮你设好明早 7 点的「带伞」提醒 ☂️" },
 ];
 const NO_TOOLS = [
 { role: "user", text: "明天北京天气怎么样？我早上想晨跑，怕淋雨。" },
 { role: "thought", text: "用户问的是「明天」的天气——这是实时信息，我的训练数据里没有……但用户在等一个答案，而我现在没有任何工具可以查询。" },
 { role: "answer", text: "明天北京天气晴朗，气温 15~26°C，非常适合晨跑！",
 warning: " 幻觉警报：这句话完全是模型编造的。没有任何工具时，模型面对实时问题要么瞎猜（如上），要么拒答。这就是智能体必须配备工具的根本原因。" },
 ];

 let script = [], idx = 0, timer = null;
 let loopCount = 0;

 function reset() {
 stopAuto();
 loopCount = 0;
 idx = 0;
 script = (toolSwitch && toolSwitch.checked) ? WITH_TOOLS : NO_TOOLS;
 traceEl.innerHTML = "";
 updateStatus();
 }
 function stopAuto() {
 if (timer) { clearInterval(timer); timer = null; playBtn.textContent = "▶ 自动播放"; }
 }
 function renderStep(st) {
 if (st.role === "action") loopCount++;
 const meta = ROLE_META[st.role];
 const div = document.createElement("div");
 div.className = `bubble ${meta.cls}`;
 const loopBadge = st.loop ? `<span class="loop-badge">Agent Loop · 第 ${st.loop} 轮</span>` : "";
 div.innerHTML = `<span class="role">${meta.icon} ${meta.label}${loopBadge}</span><br>${escapeLocal(st.text)}`;
 if (st.warning) {
 const w = document.createElement("div");
 w.className = "hallu-banner";
 w.textContent = st.warning;
 div.appendChild(w);
 }
 traceEl.appendChild(div);
 div.scrollIntoView({ block: "nearest", behavior: "smooth" });
 }
 function escapeLocal(s) {
 return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
 }
 function updateStatus() {
 if (idx === 0) {
 statusEl.innerHTML = "状态：<b>待启动</b> · 点击「单步」或「自动播放」开始";
 stepEl.textContent = "步骤 0";
 return;
 }
 const done = idx >= script.length;
 statusEl.innerHTML = done
 ? "状态：<b> 循环终止</b>（模型判断信息足够，输出回答）"
 : `状态：<b>${STAGE[script[idx].role] || "…"}</b> · 观察结果会作为新消息送回模型，决定下一步`;
 stepEl.textContent = `步骤 ${Math.min(idx, script.length)}`;
 }
 function advance() {
 if (idx >= script.length) { stopAuto(); return; }
 renderStep(script[idx]);
 idx++;
 updateStatus();
 if (idx >= script.length) stopAuto();
 }

 playBtn.addEventListener("click", () => {
 if (timer) { stopAuto(); return; }
 if (idx >= script.length) reset();
 playBtn.textContent = "⏸ 暂停";
 timer = setInterval(advance, 1500);
 advance();
 });
 stepBtn.addEventListener("click", () => { stopAuto(); advance(); });
 resetBtn.addEventListener("click", reset);
 if (toolSwitch) toolSwitch.addEventListener("change", () => { reset(); });

 reset();
}

/* ============ 实验室 2：Function Calling 消息数组可视化 ============ */
function initFuncCallViz() {
 const root = document.getElementById("lab-func-call");
 if (!root) return;

 const stackEl = root.querySelector(".msg-stack");
 const noteEl = root.querySelector(".viz-note");
 const dotsEl = root.querySelector(".dots");
 const prevBtn = root.querySelector("[data-act=prev]");
 const nextBtn = root.querySelector("[data-act=next]");
 const resetBtn = root.querySelector("[data-act=reset]");

 const roleCls = { system: "mr-system", user: "mr-user", assistant: "mr-assistant", tool: "mr-tool" };
 const roleName = { system: "system", user: "user", assistant: "assistant", tool: "tool" };

 function M(role, text) { return { role, text }; }

 // 每一步 = 一次「快照」：消息数组 + 边界标记 + 说明
 const STEPS = [
 {
 boundary: "─ 第 1 次 POST /chat/completions ─",
 messages: [
 M("system", "你是一个生活助理，涉及实时信息必须调用工具。"),
 M("user", "明天北京天气怎么样？我怕淋雨。"),
 ],
 toolsChip: true,
 fresh: 2,
 note: "我们的代码把 system、user 两条消息 + 工具的 JSON Schema 声明一起发给 API。此时模型只「知道」有工具可用，还没决定用不用。",
 },
 {
 boundary: "─ API 返回 ─",
 messages: [
 M("system", "你是一个生活助理，涉及实时信息必须调用工具。"),
 M("user", "明天北京天气怎么样？我怕淋雨。"),
 M("assistant", 'tool_calls: [{ id: "call_001",\n function: { name: "get_weather",\n arguments: \'{"city":"北京","date":"明天"}\' } }]'),
 ],
 fresh: 3,
 note: "关键认知：模型并没有执行任何工具！它只返回一个「调用意图」（函数名 + JSON 字符串参数），然后把球踢回给你的代码。选择用哪个工具、传什么参数，这是模型在推理；真正执行，是你的 harness 的事。",
 },
 {
 boundary: "─ 你的代码本地执行 get_weather，把结果追加进消息数组 ─",
 messages: [
 M("system", "你是一个生活助理，涉及实时信息必须调用工具。"),
 M("user", "明天北京天气怎么样？我怕淋雨。"),
 M("assistant", 'tool_calls: [{ id: "call_001", function: { name: "get_weather", … } }]'),
 M("tool", 'tool_call_id: "call_001"\ncontent: \'{"weather":"小雨","temp":"12~20°C"}\''),
 ],
 fresh: 4,
 note: "工具结果以 role=tool 消息回填。注意 tool_call_id 必须与请求对应——当一次返回多个工具调用时，模型靠它逐条「对账」。",
 },
 {
 boundary: "─ 第 2 次 POST /chat/completions（把整个数组发回去）─",
 messages: [
 M("system", "你是一个生活助理，涉及实时信息必须调用工具。"),
 M("user", "明天北京天气怎么样？我怕淋雨。"),
 M("assistant", 'tool_calls: [{ id: "call_001", function: { name: "get_weather", … } }]'),
 M("tool", 'tool_call_id: "call_001"\ncontent: \'{"weather":"小雨","temp":"12~20°C"}\''),
 M("assistant", "明天北京有小雨，气温 12~20°C，记得带伞 ☂️"),
 ],
 fresh: 5,
 note: "第二次请求中，模型综合观察结果生成自然语言回答，且不再包含 tool_calls —— 这就是循环终止的信号。所谓 Agent Loop，就是不断重复这个「发 → 调 → 填 → 再发」的过程，直到模型不再要求调用工具。",
 },
 ];

 let idx = 0;
 function render() {
 const st = STEPS[idx];
 let html = st.toolsChip
 ? `<div class="msg-card" style="border-style:dashed;text-align:center;color:var(--text-3)">＋ tools: [ get_weather 的 JSON Schema 声明 ]</div>`
 : "";
 st.messages.forEach((m, i) => {
 const fresh = i >= (st.fresh - 1) ? " fresh" : "";
 const txt = m.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
 html += `<div class="msg-card${fresh}"><span class="m-role ${roleCls[m.role]}">${roleName[m.role]}</span>${txt}</div>`;
 });
 html += `<div class="api-boundary">${st.boundary}</div>`;
 stackEl.innerHTML = html;
 noteEl.innerHTML = " " + st.note;
 dotsEl.innerHTML = STEPS.map((_, i) => `<span class="${i <= idx ? "on" : ""}"></span>`).join("");
 prevBtn.disabled = idx === 0;
 nextBtn.disabled = idx === STEPS.length - 1;
 }
 prevBtn.addEventListener("click", () => { if (idx > 0) { idx--; render(); } });
 nextBtn.addEventListener("click", () => { if (idx < STEPS.length - 1) { idx++; render(); } });
 resetBtn.addEventListener("click", () => { idx = 0; render(); });
 render();
}

document.addEventListener("DOMContentLoaded", () => {
 initAgentLoopSim();
 initFuncCallViz();
});
