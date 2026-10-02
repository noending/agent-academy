/* ============================================================
 实验室 6：Trace 侦探（第 7 章）
 一段失败的 Agent 运行轨迹。读完全部步骤，
 点击「最早出现错误的那一步」。多次点击可重试。
 ============================================================ */
"use strict";

function initTraceDetective() {
 const root = document.getElementById("lab-trace-detective");
 if (!root) return;

 const listEl = root.querySelector(".trace-steps");
 const statusEl = root.querySelector(".detective-status");
 const detailEl = root.querySelector(".detective-detail");
 const resetBtn = root.querySelector("[data-act=reset]");
 const hintBtn = root.querySelector("[data-act=hint]");

 const ROOT_CAUSE = 3; // 0-based：最早出错的步骤

 const STEPS = [
 { role: "user", tag: " 用户", text: "任务：统计仓库里所有 Python 代码中的 TODO 注释数量，写进 REPORT.md。" },
 { role: "thought", tag: " 思考", text: "统计 TODO 最直接的办法是 grep。我只关心 .py 文件，用 --include 过滤。" },
 { role: "action", tag: " 执行", text: 'run_cmd("grep -rn TODO --include=*.py .")' },
 { role: "obs", tag: " 观察", text: "共 47 行匹配。抽样显示：\n core/db.py:31: # TODO: 加连接池\n app/config.py:12: API_BASE = \"https://api.example.com/TODO_COMPAT\"\n legacy/parser.py:88: # TODO(v2): 重写这个函数" },
 { role: "thought", tag: " 思考", text: "共 47 个 TODO，数量拿到了。直接写入报告。" },
 { role: "action", tag: " 执行", text: 'write_file("REPORT.md", "# TODO 统计\\n\\n全仓库共有 47 个 TODO 注释。")' },
 { role: "answer", tag: " 回答", text: "统计完成：仓库共有 47 个 TODO 注释，已写入 REPORT.md。（实际有效 TODO 是 45 个：API_BASE 里的「TODO_COMPAT」是 URL 字符串常量，不是注释）" },
 ];

 const EXPLAIN = {
 cause: "第 4 步（观察之后的思考）是根因：它把「grep 匹配了 47 行」直接等同于「有 47 个 TODO 注释」——没有检查匹配内容的质量。",
 detail: "证据就在上一步的观察里：API_BASE = \"https://api.example.com/TODO_COMPAT\" 明显是 URL 字符串常量混进了结果。根因不是工具坏了（grep 如实返回），也不是模型幻觉（47 确实是匹配行数），而是<b>一步未经检验的等价替换</b>：「匹配数 = 注释数」。正确的做法是在第 4 步先审视抽样行、发现假阳性，再改用更精确的模式（如 \"# TODO\"）或逐行复核。",
 lesson: "这是 Agent 调试的典型形态：<b>错误不在某一步「崩溃」，而在某一步「悄悄降低标准的推断」。</b>它会在两步之后才显形为错误答案，所以定位必须回溯到「第一次偏离正确推理」的那一步，而不是错误显形的那一步。",
 };

 let attempts = 0, solved = false;

 function render() {
 listEl.innerHTML = STEPS.map((s, i) => `
 <div class="msg-card trace-step" data-idx="${i}">
 <span class="m-role ${roleCls(s.role)}">${s.tag}</span>${escapeLocal(s.text)}
 <button class="btn small pin-btn" data-idx="${i}"> 我怀疑这步</button>
 </div>`).join("");
 listEl.querySelectorAll(".pin-btn").forEach(btn =>
 btn.addEventListener("click", () => accuse(+btn.dataset.idx)));
 }

 function roleCls(r) {
 return { user: "mr-user", thought: "mr-assistant", action: "mr-assistant", obs: "mr-tool", answer: "mr-assistant" }[r] || "mr-system";
 }
 function escapeLocal(s) {
 return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
 }

 function accuse(idx) {
 if (solved) return;
 attempts++;
 if (idx === ROOT_CAUSE) {
 solved = true;
 listEl.querySelectorAll(".trace-step")[idx].classList.add("pin-correct");
 detailEl.innerHTML = `
 <p><b style="color:var(--ok)">✓ 破案了！</b>${EXPLAIN.cause}</p>
 <p>${EXPLAIN.detail}</p>
 <p>${EXPLAIN.lesson}</p>
 <p class="small-note">你用了 ${attempts} 次指控。真实调试中，Trace 回放正是这样一步步收窄的。</p>`;
 statusEl.innerHTML = "状态：<b style='color:var(--ok)'>已定位根因 </b>";
 } else {
 const card = listEl.querySelectorAll(".trace-step")[idx];
 card.classList.add("pin-wrong");
 setTimeout(() => card.classList.remove("pin-wrong"), 1200);
 detailEl.innerHTML = `<p style="color:var(--danger)">✗ 这一步有更早的源头。往回看：错误的判断建立在哪个前提上？那个前提是在哪一步形成的？</p>`;
 statusEl.innerHTML = `状态：继续侦查（已指控 ${attempts} 次）`;
 }
 }

 hintBtn.addEventListener("click", () => {
 detailEl.innerHTML = `<p> 提示：注意第 4 步「观察」里显示的三行抽样——三行都是 TODO 注释吗？把「grep 匹配数」和「TODO 注释数」画等号的那一步，就是你要找的。</p>`;
 });
 resetBtn.addEventListener("click", () => {
 attempts = 0; solved = false;
 detailEl.innerHTML = "<p>读完整个轨迹后，点击你认为是「最早出错」的那一步。</p>";
 statusEl.innerHTML = "状态：<b>侦查中</b>";
 render();
 });

 render();
}

document.addEventListener("DOMContentLoaded", initTraceDetective);
