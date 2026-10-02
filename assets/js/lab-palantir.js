/* ============================================================
 实验室 8：Palantir 三件套速览（第 6 章）
 三个标签页切换 Object Type / Link Type / Action Type，
 每个标签展示：定义 · 工单域示例 · 「作为 Agent 工具」的 JSON 视角
 ============================================================ */
"use strict";

function initPalantirLab() {
 const root = document.getElementById("lab-palantir");
 if (!root) return;

 const tabsEl = root.querySelector(".pal-tabs");
 const bodyEl = root.querySelector(".pal-body");

 const TABS = [
 {
 key: "object", label: " Object Type 对象类型",
 def: "业务实体的数字化身：类型化属性 + 主键，底层由数据集/流数据实时同步。对象是「活的」——自带权限、血缘与版本。",
 example: `objectType: Ticket
 primaryKey: id
 properties:
 title: string
 status: "open" | "pending" | "escalated" | "resolved"
 priority: "low" | "high"
 createdAt: timestamp
 数据来源: 工单表 + 实时工单流（自动同步）`,
 agentView: `// Agent 眼中的工具（只读）
{
 "name": "search_tickets",
 "description": "按客户/状态/优先级检索工单对象",
 "parameters": { "status": "string|null", "customerId": "string|null" }
}
// 返回的是「对象 + 链接」，不是表格行：
// { id: "T-101", status: "open",
// submitted_by: Customer(C-7), assigned_to: SupportAgent(S-2) }`,
 note: "小白记法：Object = 名词。Agent 的知识不再是文档碎片，而是当前业务对象及其关系——这正是第 4 章四种知识来源在企业里的归宿。",
 },
 {
 key: "link", label: " Link Type 链接类型",
 def: "对象之间的关系本体：可多对多、可携带属性。关系是一等公民——可检索、可治理，而不是藏在某张表的外键字段里。",
 example: `linkTypes:
 - submitted_by: Customer 1..n Ticket
 - assigned_to: SupportAgent 1..n Ticket
 - escalated_from: Ticket 1..1 Ticket
 properties: { reason: string, at: timestamp } # 关系也能带属性`,
 agentView: `// Agent 眼中的工具（只读，多跳遍历）
{
 "name": "get_customer_profile",
 "description": "沿 submitted_by 链接遍历：客户 → 其全部工单 → 处理人",
 "parameters": { "customerId": "string" }
}
// 一次调用回答「这个客户的投诉都由谁处理过」：
// 图上两跳，向量检索在这里会漏（第 4 章 4.6 节的分工）`,
 note: "小白记法：Link = 动词短语。「A 的导师的学生」这类多跳问题靠的就是链接遍历——与第 6 章知识图谱记忆一脉相承。",
 },
 {
 key: "action", label: " Action Type 动作类型",
 def: "对对象状态的唯一合法写入口：声明式校验 + 权限检查 + 副作用编排。业务流程（审批/派工/退款）建模为 Action。",
 example: `actionType: escalateTicket(ticketId, reason)
 校验: ticket.status in [open, pending]
 reason 非空
 副作用: status → escalated
 通知值班经理
 写审计日志
 权限: 仅当班组长及以上`,
 agentView: `// Agent 眼中的工具（写入——注意与第 7 章权限分级对应）
{
 "name": "escalate_ticket",
 "description": "升级工单。仅 open/pending 状态可升级，需说明原因。",
 "parameters": { "ticketId": "string", "reason": "string" }
}
// 调用发生在本体闸门之后：校验不通过 → 工具返回结构化错误
// → 模型在下一轮循环里看到错误并自我修正（第 2 章 2.4 节）`,
 note: "小白记法：Action = 让世界改变的动词。它是第 7 章「权限分级」在工业界的原生形态：人类与 Agent 走同一道闸门，审计天然齐全。",
 },
 ];

 let cur = 0;
 function render() {
 tabsEl.innerHTML = TABS.map((t, i) =>
 `<button class="btn ${i === cur ? "primary" : ""}" data-key="${t.key}">${t.label}</button>`).join("");
 const t = TABS[cur];
 bodyEl.innerHTML = `
 <p class="pal-def">${t.def}</p>
 <div class="pal-grid">
 <div class="codeblock"><div class="code-head"><span class="code-lang">定义（示意）</span></div><pre><code class="language-yaml">${escapeLocal(t.example)}</code></pre></div>
 <div class="codeblock"><div class="code-head"><span class="code-lang">Agent 工具视角</span></div><pre><code class="language-javascript">${escapeLocal(t.agentView)}</code></pre></div>
 </div>
 <div class="viz-note" style="margin-top:12px"> ${t.note}</div>`;
 tabsEl.querySelectorAll("button").forEach(b =>
 b.addEventListener("click", () => { cur = TABS.findIndex(x => x.key === b.dataset.key); render(); }));
 }
 function escapeLocal(s) {
 return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
 }
 render();
}

document.addEventListener("DOMContentLoaded", initPalantirLab);
