/* ============================================================
 实验室 7：检索质量对比器（第 4 章）
 同一份员工手册 × 同一个问题 × 三种切块策略，
 对比「切出来的块」与「检索命中的块」，直观看清切块的影响。
 纯前端模拟（分数为教学标定）。
 ============================================================ */
"use strict";

function initRagChunks() {
 const root = document.getElementById("lab-rag-chunks");
 if (!root) return;

 const grid = root.querySelector(".rag-grid");
 const noteEl = root.querySelector(".viz-note");
 const revealBtn = root.querySelector("[data-act=reveal]");

 const QUESTION = "出差住宿报销的上限是多少？";

 // 原文（员工手册节选）：答案在「差旅政策」段中部
 const STRATS = [
 {
 tag: "策略 A", label: "固定长度切块（每 110 字）", cls: "bad",
 desc: "最粗暴的做法：不管语义，每 110 字切一刀，块与块之间无重叠。",
 chunks: [
 { text: "【报销制度】员工报销请于每月 25 日前在 OA 系统提交，逾期将顺延至下月处理。报销需附发票原件，单笔超 5000 元需部门总监审批。", hit: false, score: 18 },
 { text: "【差旅政策】出差前需在 OA 提交出差申请。交通标准：高铁二等座、经济舱。住宿：每晚上限 400 元（一线城市），超标需提前报备。市内交通实报实销。", hit: true, score: 41 },
 { text: "…市内交通实报实销。【考勤制度】工作日 9:00-18:00，弹性半小时。出差期间按项目地考勤，需每日打卡报备项目经…", hit: false, score: 12 },
 ],
 verdict: [false, "✗ 险些失败：答案整句「住宿每晚上限 400 元」虽然落在第 2 块里，但第 2 块还混入了交通、申请等无关内容——固定切块经常把一个主题拦腰斩断，边界处的问题是重灾区。"],
 },
 {
 tag: "策略 B", label: "按句子/段落切块", cls: "good",
 desc: "以自然段落为单位切块，语义完整，每块只讲一件事。",
 chunks: [
 { text: "【报销制度段】员工报销请于每月 25 日前在 OA 系统提交，逾期将顺延至下月处理。报销需附发票原件，单笔超 5000 元需部门总监审批。", hit: false, score: 22 },
 { text: "【差旅政策·住宿段】出差住宿标准：一线城市每晚上限 400 元，二线城市 300 元；超标需提前报备。", hit: true, score: 78 },
 { text: "【考勤制度段】工作日 9:00-18:00，弹性半小时。出差期间按项目地考勤，需每日打卡报备项目经理。", hit: false, score: 9 },
 ],
 verdict: [true, "✓ 命中且干净：问题里的「住宿 / 报销 / 上限」与该段几乎逐词对应，检索得分最高，块内没有无关内容——生成的回答可以整段引用。"],
 },
 {
 tag: "策略 C", label: "按标题切块（结构感知）", cls: "mid",
 desc: "按文档标题层级切块：每个二级标题下的全部内容为一块。",
 chunks: [
 { text: "【报销制度】（整节）…25 日前提交…发票原件…总监审批…", hit: false, score: 31 },
 { text: "【差旅政策】（整节）出差申请 + 交通标准 + 住宿标准 + 市内交通，全部在同一块里。", hit: true, score: 63 },
 { text: "【考勤制度】（整节）…", hit: false, score: 11 },
 ],
 verdict: [true, "△ 命中但有噪声：答案确实在被命中的块里，结构也保住了（适合「差旅政策讲了什么」这类整节问题）；但对「住宿上限」这种精确提问，块里一半是交通内容——检索分数被无关内容稀释，多问几轮后容易被别的块反超。生产做法：按标题切大块、再在块内做句子级二次切分。"],
 },
 ];

 function render() {
 grid.innerHTML = `
 <div class="rag-question"> 检索问题：<b>${QUESTION}</b><span class="small-note">（文档：员工手册，含 报销制度 / 差旅政策 / 考勤制度 三节）</span></div>
 <div class="rag-cols">` + STRATS.map(s => `
 <div class="card rag-card ${s.cls}">
 <div class="ab-head"><span class="ab-tag">${s.tag}</span><b>${s.label}</b></div>
 <p class="small-note" style="margin:4px 0 10px">${s.desc}</p>
 <div class="rag-chunks">` + s.chunks.map((c, i) => `
 <div class="rag-chunk ${c.hit ? "hit" : ""}">
 <div class="rag-score-row"><span class="rag-no">块 ${i + 1}</span>
 <span class="rag-score ${c.hit ? "on" : ""}">相似度 ${c.score}</span></div>
 <div class="rag-bar"><span style="width:${c.score}%"></span></div>
 <div class="rag-text">${escapeLocal(c.text)}</div>
 ${c.hit ? '<div class="rag-flag"> 该块将作为上下文送入模型</div>' : ""}
 </div>`).join("") + `</div>
 <div class="rag-verdict ${s.verdict[0] ? "ok" : "bad"}">${s.verdict[1]}</div>
 </div>`).join("") + `</div>`;
 }
 function escapeLocal(s) {
 return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
 }

 revealBtn.addEventListener("click", () => {
 noteEl.style.display = "block";
 revealBtn.disabled = true;
 });

 render();
}

document.addEventListener("DOMContentLoaded", initRagChunks);
