/* ============================================================
 实验室 9：路由模拟器（第 10 章 · 配合 10.6 路由模式）
 模拟「路由 LLM + 三个专员」的经典路由架构：
 输入问题 → 路由器分类 → 派发给最便宜的合格专员；
 同时对比「全部直接用大模型」的累计成本与延迟。
 纯教学示意（成本/延迟为手工标定的模拟值，非真实评测）。
 ============================================================ */
"use strict";

function initRoutingLab() {
 const root = document.getElementById("lab-routing");
 if (!root) return;

 const examples = Array.from(root.querySelectorAll("[data-q]"));
 const input = root.querySelector("[data-act=input]");
 const sendBtn = root.querySelector("[data-act=send]");
 const resetBtn = root.querySelector("[data-act=reset]");
 const paths = Array.from(root.querySelectorAll("[data-path]"));
 const reasonEl = root.querySelector(".rt-reason");
 const logEl = root.querySelector(".hlog");
 const costR = root.querySelector("[data-m=cost-r]");
 const costF = root.querySelector("[data-m=cost-f]");
 const latR = root.querySelector("[data-m=lat-r]");
 const latF = root.querySelector("[data-m=lat-f]");
 const savedEl = root.querySelector("[data-m=saved]");

 // 路由器(模拟一次 LLM 分类):关键词规则代替真实分类调用
 function classify(text) {
 const t = (text || "").toLowerCase();
 if (/订单|退款|发货|物流|快递|退款|发票/.test(t))
 return { target: "order", why: "涉及订单状态与钱——派给能查订单库的专员(中档模型+订单工具)", label: "订单专员" };
 if (/报错|错误|崩|异常|500|api|接口|超时|bug/.test(t))
 return { target: "tech", why: "技术故障诊断需要深度推理——这是唯一值得动用大模型+检索工具的分支", label: "技术支持(大模型)" };
 if (/是什么|怎么|为什么|吗|介绍|区别/.test(t))
 return { target: "faq", why: "高频常见问答,知识库里就有答案——最便宜的小模型足矣", label: "FAQ 专员(小模型)" };
 return { target: "fallback", why: "路由器对意图置信度低——兜底转大模型处理(路由的失败模式:宁可贵,不可错)", label: "兜底:大模型" };
 }

 // 手工标定的模拟值:每次调用成本($)与延迟(s)
 const PRICE = {
 route: { cost: 0.0004, lat: 0.6 },
 faq: { cost: 0.0003, lat: 0.9 },
 order: { cost: 0.0010, lat: 1.6 },
 tech: { cost: 0.0040, lat: 2.6 },
 fallback: { cost: 0.0040, lat: 2.6 },
 full: { cost: 0.0040, lat: 2.6 },
 };

 let runCount = 0;

 function run(text) {
 const r = classify(text);
 const p = PRICE[r.target];

 // 高亮路径
 paths.forEach(el => {
 const on = el.dataset.path === r.target;
 el.classList.toggle("rt-on", on);
 });

 // 路由原因(模拟路由 LLM 的判断输出)
 reasonEl.innerHTML = `<b>路由判断:</b>${r.why}`;

 // 日志
 runCount++;
 const line = document.createElement("div");
 line.className = r.target === "fallback" ? "lg-warn" : "lg-ok";
 line.textContent = `[${runCount}] "${text.length > 26 ? text.slice(0, 26) + "…" : text}" → ${r.label} · 成本 $${p.cost.toFixed(4)} · 延迟 ${p.lat}s`;
 logEl.prepend(line);

 // 累计对比:路由模式 = 路由器 + 专员;对照组 = 全量大模型
 const costR2 = PRICE.route.cost + p.cost, latR2 = PRICE.route.lat + p.lat;
 setNum(costR, parseFloat(costR.textContent) + costR2);
 setNum(latR, parseFloat(latR.textContent) + latR2);
 setNum(costF, parseFloat(costF.textContent) + PRICE.full.cost);
 setNum(latF, parseFloat(latF.textContent) + PRICE.full.lat);

 const cR = parseFloat(costR.textContent), cF = parseFloat(costF.textContent);
 const lR = parseFloat(latR.textContent), lF = parseFloat(latF.textContent);
 savedEl.textContent = `累计 ${runCount} 次:成本省 $${(cF - cR).toFixed(4)}(${Math.round((1 - cR / cF) * 100)}%),延迟省 ${(lF - lR).toFixed(1)}s(${Math.round((1 - lR / lF) * 100)}%)`;
 }

 function setNum(el, v) { el.textContent = v.toFixed(4); }

 function reset() {
 [costR, costF, latR, latF].forEach(el => (el.textContent = "0"));
 savedEl.textContent = "累计 0 次";
 logEl.innerHTML = "";
 runCount = 0;
 reasonEl.innerHTML = "<b>路由判断:</b>等待输入…";
 paths.forEach(el => el.classList.remove("rt-on"));
 }

 examples.forEach(b => b.addEventListener("click", () => {
 input.value = b.dataset.q;
 run(b.dataset.q);
 }));
 sendBtn.addEventListener("click", () => {
 const t = input.value.trim();
 if (t) run(t);
 });
 input.addEventListener("keydown", e => {
 if (e.key === "Enter") { const t = input.value.trim(); if (t) run(t); }
 });
 resetBtn.addEventListener("click", reset);
}

document.addEventListener("DOMContentLoaded", initRoutingLab);
