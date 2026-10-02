/* ============================================================
 实验室 3：Ontology 实验室（第 4 章）
 可视化一个极简「智能体领域本体」：
 类层级（is-a）+ 属性关系（uses / executes）+ 实例
 支持：点击查看、添加实例、运行 RDFS 级继承推理
 ============================================================ */
"use strict";

function initOntologyLab() {
 const root = document.getElementById("lab-ontology");
 if (!root) return;

 const svgEl = root.querySelector("svg");
 const infoEl = root.querySelector(".ont-info");
 const inferEl = root.querySelector(".ont-infer ul");
 const inferBox = root.querySelector(".ont-infer");
 const nameInput = root.querySelector("#ont-inst-name");
 const classSelect = root.querySelector("#ont-inst-class");
 const addBtn = root.querySelector("[data-act=add-inst]");
 const inferBtn = root.querySelector("[data-act=infer]");

 /* ---------- 本体数据 ---------- */
 const CLASSES = {
 Thing: { x: 390, y: 42, parent: null, def: "所有事物的根类（相当于 owl:Thing）。" },
 Human: { x: 120, y: 160, parent: "Thing", def: "使用智能体的人类用户。" },
 Agent: { x: 390, y: 160, parent: "Thing", def: "能感知、推理并调用工具完成任务的智能体。" },
 Tool: { x: 660, y: 160, parent: "Thing", def: "智能体可调用的外部能力单元。" },
 Task: { x: 660, y: 290, parent: "Thing", def: "需要被完成的一个工作项。" },
 CodingAgent: { x: 250, y: 290, parent: "Agent", def: "专门写代码、改代码的智能体子类。" },
 SearchTool: { x: 510, y: 290, parent: "Tool", def: "执行网络检索的工具子类。" },
 };
 const PROPS = {
 uses: { domain: "Agent", range: "Tool", label: "使用" },
 executes: { domain: "Agent", range: "Task", label: "执行" },
 };
 let INSTANCES = [
 { name: "Alice", of: "Human", x: 110, y: 400 },
 { name: "ClaudeCode", of: "CodingAgent", x: 250, y: 400 },
 { name: "WebSearch", of: "SearchTool", x: 510, y: 400 },
 { name: "修复登录Bug", of: "Task", x: 660, y: 400 },
 ];
 let EDGES = [
 { type: "prop", prop: "uses", from: "ClaudeCode", to: "WebSearch" },
 { type: "prop", prop: "executes", from: "ClaudeCode", to: "修复登录Bug" },
 ];
 let selected = null;

 const chainOf = (cls) => {
 const chain = [];
 let c = cls;
 while (c) { chain.push(c); c = CLASSES[c] && CLASSES[c].parent; }
 return chain;
 };
 const findInst = (n) => INSTANCES.find(i => i.name === n);

 /* ---------- 渲染 ---------- */
 function nodeKey(name) { return "n_" + name.replace(/[^\w\u4e00-\u9fa5]/g, "_"); }

 function render() {
 const W = 780, H = 470;
 let edges = "", labels = "", nodes = "";
 // is-a 边
 for (const [name, c] of Object.entries(CLASSES)) {
 if (!c.parent) continue;
 const p = CLASSES[c.parent];
 const x1 = c.x, y1 = c.y - 16, x2 = p.x, y2 = p.y + 16;
 edges += `<path class="ont-edge isa" d="M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}"/>`;
 labels += `<text class="ont-elabel" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}">is-a</text>`;
 }
 // 实例 → 所属类
 for (const inst of INSTANCES) {
 const cls = CLASSES[inst.of];
 if (!cls) continue;
 edges += `<path class="ont-edge isa" d="M ${inst.x} ${inst.y - 15} C ${inst.x} ${(inst.y + cls.y) / 2 - 10}, ${cls.x} ${(inst.y + cls.y) / 2 - 10}, ${cls.x} ${cls.y + 16}"/>`;
 }
 // 属性边
 for (const e of EDGES) {
 if (e.type !== "prop") continue;
 const a = findInst(e.from), b = findInst(e.to);
 if (!a || !b) continue;
 edges += `<path class="ont-edge prop" d="M ${a.x} ${a.y} L ${b.x} ${b.y}"/>`;
 labels += `<text class="ont-elabel prop" x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 7}">${e.prop}</text>`;
 }
 // 类节点
 for (const [name, c] of Object.entries(CLASSES)) {
 const sel = selected === name ? " sel" : "";
 nodes += `<g class="ont-node${sel}" data-name="${name}" data-kind="class" transform="translate(${c.x},${c.y})">
 <rect x="-62" y="-17" width="124" height="34" rx="9"/><text text-anchor="middle" dy="4.5">${name}</text></g>`;
 }
 // 实例节点
 for (const inst of INSTANCES) {
 const sel = selected === inst.name ? " sel" : "";
 nodes += `<g class="ont-node inst${sel}" data-name="${inst.name}" data-kind="inst" transform="translate(${inst.x},${inst.y})">
 <rect x="-58" y="-15" width="116" height="30" rx="15"/><text text-anchor="middle" dy="4.5">${inst.name}</text></g>`;
 }
 svgEl.innerHTML = `
 <defs>
 <marker id="arrowIsa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
 <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-strong)"/>
 </marker>
 <marker id="arrowProp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
 <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--warn)"/>
 </marker>
 </defs>
 ${edges}${labels}${nodes}`;
 svgEl.querySelectorAll(".ont-node").forEach(g => {
 g.addEventListener("click", () => selectNode(g.dataset.name, g.dataset.kind));
 });
 }

 function selectNode(name, kind) {
 selected = name;
 if (kind === "class") {
 const c = CLASSES[name];
 const insts = INSTANCES.filter(i => i.of === name).map(i => i.name);
 const chain = chainOf(name);
 infoEl.innerHTML = `<h5>${name} <span class="kind-badge k-class">类 Class</span></h5>
 <b>定义：</b>${c.def}<br>
 <b>父类：</b>${c.parent || "（无，根类）"}<br>
 <b>is-a 链：</b>${chain.join(" ▸ ")}<br>
 <b>直接实例：</b>${insts.length ? insts.join("、") : "暂无——试试在下方添加"}`;
 } else {
 const inst = findInst(name);
 const props = EDGES.filter(e => e.type === "prop" && (e.from === name || e.to === name));
 const propTxt = props.map(p =>
 p.from === name ? `${p.from} —${p.prop}→ ${p.to}` : `${p.to} —${p.prop}← ${p.from}`).join("；");
 infoEl.innerHTML = `<h5>${name} <span class="kind-badge k-inst">实例 Instance</span></h5>
 <b>所属类：</b>${inst.of}<br>
 <b>继承的类：</b>${chainOf(inst.of).join(" ▸ ")}<br>
 <b>关系断言：</b>${propTxt || "暂无"}`;
 }
 render();
 }

 /* ---------- 添加实例 ---------- */
 addBtn.addEventListener("click", () => {
 const name = (nameInput.value || "").trim();
 const of = classSelect.value;
 if (!name) { nameInput.focus(); return; }
 if (findInst(name) || CLASSES[name]) { infoEl.innerHTML = `<h5> 命名冲突</h5>「${name}」已经存在，换个名字试试。`; return; }
 const cls = CLASSES[of];
 const slotX = cls.x + (INSTANCES.length % 3) * 26 - 26;
 const slotY = 400 + Math.floor(INSTANCES.length / 4) * 0;
 INSTANCES.push({ name, of, x: Math.min(720, Math.max(70, slotX)), y: slotY });
 nameInput.value = "";
 inferEl.innerHTML = "";
 selectNode(name, "inst");
 });

 /* ---------- 推理演示 ---------- */
 inferBtn.addEventListener("click", () => {
 const lines = [];
 for (const inst of INSTANCES) {
 const chain = chainOf(inst.of);
 lines.push(`<li><b>✔</b> ${inst.name} is-a ${chain[0]}${chain.length > 1
 ? `，由 is-a 传递性 ⇒ ${chain.slice(1).join(" ▸ ")}` : ""}</li>`);
 }
 for (const e of EDGES) {
 if (e.type !== "prop") continue;
 const p = PROPS[e.prop];
 const fa = findInst(e.from), fb = findInst(e.to);
 if (!fa || !fb) continue;
 const okA = chainOf(fa.of).includes(p.domain);
 const okB = chainOf(fb.of).includes(p.range);
 lines.push(`<li><b>✔</b> ${e.from} —${e.prop}→ ${e.to}：定义域要求主语 ∈ ${p.domain}（实际：${fa.of}${okA ? " ✓" : " ✗"}），值域要求宾语 ∈ ${p.range}（实际：${fb.of}${okB ? " ✓" : " ✗"}）</li>`);
 }
 lines.push(`<li style="color:var(--text-3)"> 这只是 RDFS 级的极小示例。OWL 还有等价性、基数约束、传递/对称属性、互斥等强得多的推理能力——推理机（如 Pellet、HermiT）可以自动算出全部逻辑推论。</li>`);
 inferEl.innerHTML = lines.join("");
 inferBox.scrollTop = 0;
 });

 render();
 selectNode("Agent", "class");
}

document.addEventListener("DOMContentLoaded", initOntologyLab);
