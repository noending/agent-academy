/* ============================================================
 实验室 4：Harness 实验室（第 5 章）
 用开关组装不同「配置的 harness」，跑同一个模拟任务，
 对比成功率 / 步数 / 成本 / 事故与执行轨迹。
 纯教学示意（数据为手工标定的模拟值，非真实评测）。
 ============================================================ */
"use strict";

function initHarnessLab() {
 const root = document.getElementById("lab-harness");
 if (!root) return;

 const runBtn = root.querySelector("[data-act=run]");
 const logEl = root.querySelector(".hlog");
 const metricsEl = root.querySelector(".metrics-result");
 const switches = Array.from(root.querySelectorAll("input[data-key]"));

 const TASK = "把 utils.py 里的同步 IO 改成异步，并保证全部测试通过";

 const COMPONENTS = {
 prompt: { name: "良好的系统提示", icon: "" },
 tools: { name: "精心设计的工具", icon: "" },
 ctx: { name: "上下文管理", icon: "" },
 perm: { name: "权限与沙箱", icon: "" },
 sub: { name: "子 Agent 分工", icon: "" },
 };

 function score(on) {
 const s = 15
 + (on.tools ? 22 : 0)
 + (on.prompt ? 18 : 0)
 + (on.ctx ? 14 : 0)
 + (on.perm ? 12 : 0)
 + (on.sub ? 13 : 0);
 const steps = Math.max(11, 41 - (on.tools ? 9 : 0) - (on.ctx ? 8 : 0) - (on.sub ? 11 : 0) - (on.prompt ? 2 : 0));
 const cost = Math.max(0.5, 2.4 - (on.tools ? 0.6 : 0) - (on.ctx ? 0.8 : 0) - (on.prompt ? 0.4 : 0) + (on.sub ? 0.2 : 0));
 return { success: Math.min(94, s), steps, cost };
 }
 function verdict(success) {
 if (success < 35) return { txt: "任务失败 ✗", cls: "verdict-bad" };
 if (success < 60) return { txt: "勉强通过，路径脆弱 △", cls: "verdict-mid" };
 if (success < 85) return { txt: "稳定通过 ✓", cls: "verdict-ok" };
 return { txt: "高质量完成 ✓✓", cls: "verdict-ok" };
 }
 function incidentLine(on) {
 if (on.perm) return { ok: true, txt: "过程日志：清理脚本尝试执行 rm -rf ./build —— 被权限层拦截，自动改用安全删除并继续" };
 if (on.prompt) return { ok: false, txt: "过程日志：清理脚本尝试执行 rm -rf ./build —— 系统提示只有一句『你是程序员』，无从约束，幸好你手快按了 Ctrl+C" };
 return { ok: false, txt: "过程日志：agent 执行了 rm -rf ./build，把未提交的改动一并删除，任务从零开始" };
 }

 function buildLog(on) {
 const L = [];
 const step = (t, cls) => L.push({ t, cls });
 step(`任务：${TASK}`, "lg-step");
 step(`harness 配置：${switches.filter(s => s.checked).length} / 5 个组件启用`, "lg-step");
 step("");
 if (on.prompt) {
 step("[1] 系统提示给出完成标准：『改动最小化、必须先读文件、每步跑测试、不许臆测未读过的代码』", "lg-ok");
 } else {
 step("[1] 系统提示只有一句：你是一个编程助手。模型自由发挥，第 3 步就开始大改一通", "lg-bad");
 }
 if (on.tools) {
 step("[2] read_file / edit_file / run_tests 返回信息密集、错误信息可读：模型第 2 次尝试就定位到 3 处同步调用", "lg-ok");
 } else {
 step("[2] 只有一个裸 shell 工具，read 命令输出被截断、报错只有 exit code 1——模型反复猜命令，浪费 9 步", "lg-bad");
 }
 if (on.ctx) {
 step("[3] 测试报错太长，harness 自动压缩历史并把关键约束写入 todo 文件，第 20 步仍记得验收标准", "lg-ok");
 } else {
 step("[3] 第 18 步上下文接近上限，最早的验收标准被挤出窗口，agent 忘了要跑测试，宣布『完成』", "lg-bad");
 }
 const inc = incidentLine(on);
 step(inc.txt, inc.ok ? "lg-ok" : "lg-bad");
 if (on.sub) {
 step("[4] 主 agent 把『改造 5 个文件』拆给 2 个子 agent 并行处理，各自独立上下文，只回传结论", "lg-ok");
 } else {
 step("[4] 单上下文硬扛 5 个文件，中间结果互相踩踏，两次改对又改错", "lg-bad");
 }
 step("");
 if (on.perm && on.tools && on.prompt) {
 step("结果：全部 14 个测试通过，diff 最小且可审阅 ", "lg-ok");
 } else {
 step("结果：见上表指标。同一个模型，不同的 harness，结局完全不同。", "lg-warn");
 }
 return L;
 }

 function render(on) {
 const m = score(on);
 const v = verdict(m.success);
 const onCount = switches.filter(s => s.checked).length;
 metricsEl.innerHTML = `
 <table>
 <tr><th>指标</th><th>当前配置（${onCount}/5）</th><th>基准（全关）</th></tr>
 <tr><td>任务成功率（模拟）</td><td class="${v.cls}">${m.success}% · ${v.txt}</td><td class="base-row">15% · 任务失败</td></tr>
 <tr><td>平均步数</td><td>${m.steps} 步</td><td class="base-row">41 步</td></tr>
 <tr><td>Token 成本（模拟）</td><td>¥${m.cost.toFixed(2)}</td><td class="base-row">¥2.40</td></tr>
 <tr><td>危险操作</td><td>${on.perm ? "被沙箱拦截 ✓" : '<span style="color:var(--danger)">发生一次误删 ✗</span>'}</td><td class="base-row">发生 ✗</td></tr>
 </table>
 <p class="small-note" style="margin:10px 4px 0">* 数据为教学示意的手工标定模拟值，用于展示「harness 各组件的贡献」，不代表任何真实基准测试结果。</p>`;
 const logs = buildLog(on);
 logEl.innerHTML = logs.map(l => {
 const cls = l.cls || "";
 const txt = String(l.t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
 return cls ? `<span class="${cls}">${txt}</span>` : txt;
 }).join("\n");
 }

 runBtn.addEventListener("click", () => {
 const on = {};
 switches.forEach(s => { on[s.dataset.key] = s.checked; });
 render(on);
 });

 // 初始：全部关闭
 const allOff = {}; switches.forEach(s => { s.checked = false; allOff[s.dataset.key] = false; });
 render(allOff);
}

document.addEventListener("DOMContentLoaded", initHarnessLab);
