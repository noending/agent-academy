/* ============================================================
 实验室 10：MCP 握手模拟器（第 10 章 · 配合 10.1 MCP）
 步进式演示一次完整的 MCP 交互:
 连接 → tools/list → 注入 → 模型点名 → tools/call → 结果回填。
 右侧同步展示宿主 Agent 的消息数组变化,直观对应第 1/2 章
 的手写工具——协议只改变「工具定义从哪来」,不改变 Loop 本身。
 纯前端模拟,无真实 MCP Server。
 ============================================================ */
"use strict";

function initMcpLab() {
 const root = document.getElementById("lab-mcp");
 if (!root) return;

 const stepBtn = root.querySelector("[data-act=next]");
 const resetBtn = root.querySelector("[data-act=reset]");
 const stepEl = root.querySelector("[data-m=step]");
 const descEl = root.querySelector(".mcp-desc");
 const wireEl = root.querySelector(".mcp-wire");   // 协议报文
 const logEl = root.querySelector(".hlog");        // 宿主消息数组
 const serverCard = root.querySelector(".mcp-tool-card");
 const serverLight = root.querySelector("[data-m=light]");

 const TOOLS_LIST = {
 tools: [{
 name: "get_weather",
 description: "查询指定城市的当前天气。city 为城市英文名,如 'hangzhou'。",
 inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
 }],
 };

 const STEPS = [
 { title: "① 连接", desc: "宿主 Agent 以 stdio 方式启动 MCP Server 子进程:<code>python mcp_weather_server.py</code>。从此两侧通过标准输入输出交换 JSON-RPC 报文——这就是「插上 USB-C」。", wire: "$ python mcp_weather_server.py\n[MCP Server] 已就绪(transport=stdio)", light: true, msg: "⬡ MCP Server 已连接" },
 { title: "② 发现工具(tools/list)", desc: "宿主发 <code>tools/list</code>。注意 inputSchema——它与第 2 章手写 Function Calling 的 parameters 字段<b>同构</b>:名字、描述、参数类型、必填项,一样不少。", wire: '→ {"method":"tools/list"}\n← {"tools":[{"name":"get_weather","description":"查询指定城市的当前天气…","inputSchema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}]}', light: true, msg: "⬡ 工具已注册:get_weather(city)" },
 { title: "③ 注入对话(与 Function Calling 合流)", desc: "宿主把 schema 转成模型请求的 <code>tools</code> 参数。从模型视角看,MCP 工具与手写工具<b>没有任何区别</b>——变的只是工具定义从哪来。", wire: '→ LLM 请求体: {"tools":[{"type":"function","function":{"name":"get_weather","description":"查询指定城市的当前天气…","parameters":{…同上…}}}], "messages":[…用户: 杭州天气怎么样?]}', light: false, msg: "[user] 杭州天气怎么样?" },
 { title: "④ 模型点名(toolCall)", desc: "模型输出的是<b>结构化文字</b>:它想用 get_weather、参数 city=hangzhou。它并没有「自己执行」——执行权始终在宿主(课程 1.5 节)。", wire: '← 模型输出: {"tool_calls":[{"name":"get_weather","arguments":{"city":"hangzhou"}}]}', light: false, msg: "[assistant · toolCall] get_weather({city:'hangzhou'})" },
 { title: "⑤ tools/call(宿主 → Server)", desc: "宿主把点名翻译成 MCP 协议调用。真正执行发生在 Server 端——它可能查的是真实气象 API。", wire: '→ {"method":"tools/call","params":{"name":"get_weather","arguments":{"city":"hangzhou"}}}\n← {"content":[{"type":"text","text":"{temp_c:26, condition:晴}"}]}', light: true, msg: "[toolResult] {temp_c:26, condition:晴}" },
 { title: "⑥ 观察回填,Loop 收尾", desc: "结果追加进消息历史,模型看到观察后生成最终回答,不再请求工具,循环结束(第 1 章 Agent Loop)。MCP 的部分到此为止——<b>协议管到了工具,Loop 还是那个 Loop</b>。", wire: "→ LLM 请求体: messages +[toolCall, toolResult]\n← 模型输出: \"杭州现在 26°C,晴,适合出门。\"", light: false, msg: "[assistant] 杭州现在 26°C,晴,适合出门。" },
 ];

 let step = 0;

 function render() {
 stepEl.textContent = `${step} / ${STEPS.length}`;
 const s = STEPS[step - 1];
 if (!s) return;
 descEl.innerHTML = s.desc;
 wireEl.textContent = s.wire;
 const line = document.createElement("div");
 line.className = step === STEPS.length ? "lg-ok" : "lg-step";
 line.textContent = s.msg;
 logEl.appendChild(line);
 serverCard.classList.toggle("mcp-active", s.light);
 serverLight.textContent = s.light ? "● 在线" : "○ 待机";
 stepBtn.disabled = step >= STEPS.length;
 stepBtn.textContent = step >= STEPS.length ? "演示完成 — 点「重来」再看一遍" : "下一步";
 }

 stepBtn.addEventListener("click", () => {
 if (step >= STEPS.length) return;
 step += 1;
 render();
 });

 resetBtn.addEventListener("click", () => {
 step = 0;
 logEl.innerHTML = "";
 wireEl.textContent = "// 点「下一步」开始演示";
 descEl.innerHTML = "六步走完一次完整的 MCP 交互。注意每一步:<b>谁在执行</b>?报文里出现过几次模型?——模型只在 ④⑥ 出现,它永远只输出文字。";
 serverCard.classList.remove("mcp-active");
 serverLight.textContent = "○ 待机";
 stepBtn.disabled = false;
 stepBtn.textContent = "下一步";
 });

 stepEl.textContent = "0 / " + STEPS.length;
}

document.addEventListener("DOMContentLoaded", initMcpLab);
