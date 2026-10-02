# Agent 学院 · Agent Academy

一个教你**开发 AI 智能体**，并**深入理解 Ontology（本体）与 Harness（智能体框架）**的纯静态教学网站。
9 章系统路线 + 第 10 章设计模式 + 8 个交互实验室 + 50+ 段可运行代码 + 8 篇论文精读 + 1 本开源教材 + 每章练习带参考答案，标准是「学完真的能上手」。

## 本地运行

无需安装任何依赖，两种方式任选：

```bash
# 方式一：直接用浏览器打开
open index.html

# 方式二：起一个本地服务器（推荐）
python3 -m http.server 8080
# 然后访问 http://localhost:8080
```

## 学习路线

| 章 | 主题 | 亮点 |
|---|---|---|
| 1 | Agent 基础认知 | 四要素、Agent Loop、ReAct；Agent Loop 模拟器 |
| 2 | 动手写第一个 Agent | DeepSeek 实战：裸 HTTP / Function Calling / 流式 / 重试；消息数组可视化 |
| 3 | Prompt 工程与上下文设计 | 五区结构、few-shot、校验重试闭环、LLM 五种角色；提示词 A/B 对比器 |
| 4 | 知识库与 RAG 全链路 | 切块/嵌入/检索/生成、50 行管线、失败诊断；检索质量对比器 |
| 5 | Agent 工程进阶 | 压缩器、文件/向量记忆、多智能体编排、评估脚本（全部带代码） |
| 6 | 深入理解 Ontology | **Palantir Ontology（对象·链接·动作）主线** + 语义网技术栈、rdflib 实战、LLM 抽取管线 |
| 7 | 深入理解 Harness | 八大组件、**DeepSeek 单文件参考实现**、Pi Agent 等框架对比；Harness 实验室 |
| 8 | 调试、评估与上线 | 五步定位法、LLM-as-Judge、Gradio 上线；Trace 侦探实验室 |
| 9 | 毕业项目 | 四个里程碑构建「知识驱动的科研小助手」，步步有验收 |
| 10 | 智能体设计模式 | MCP、Guardrails 安全、HITL、A2A、异常恢复五张模式卡片；Gulli《Agentic Design Patterns》21 章教材已上站并纳入导师知识库 |

## 目录结构

```
agent-academy/
├── index.html                # 学习路径（从这里开始）
├── 01-agent-basics.html      # 第 1 章 · Agent 基础认知
├── 02-first-agent.html       # 第 2 章 · 动手写第一个 Agent（DeepSeek 实战）
├── 03-prompt-engineering.html# 第 3 章 · Prompt 工程与上下文设计
├── 04-knowledge-base.html    # 第 4 章 · 知识库与 RAG 全链路
├── 05-agent-patterns.html    # 第 5 章 · Agent 工程进阶
├── 06-ontology.html          # 第 6 章 · 深入理解 Ontology
├── 07-harness.html           # 第 7 章 · 深入理解 Harness
├── 08-ship-it.html           # 第 8 章 · 调试、评估与上线
├── 09-capstone.html          # 第 9 章 · 综合实战：知识驱动的智能体
├── 10-design-patterns.html   # 第 10 章 · 智能体设计模式（MCP/安全/HITL/A2A/异常恢复）
├── papers.html               # 附录 · 论文精读（8 篇 + Gulli 教材）
├── llm-basics.html           # 附录 · LLM 基础速成（温度采样实验室）
├── resources.html            # 附录 · 术语表 / 文档 / 开源项目
└── assets/
    ├── css/style.css         # 设计系统（亮/暗双主题）
    └── js/
        ├── app.js            # 导航 / 主题 / 进度 / 代码高亮 / 目录 / 翻页 / JupyterLite 运行按钮
        ├── lab-agent.js      # Agent Loop 模拟器 + 消息数组可视化
        ├── lab-prompt.js     # 提示词 A/B 对比器
        ├── lab-rag.js        # 检索质量对比器（切块策略）
        ├── lab-ontology.js   # 本体可视化与继承推理
        ├── lab-harness.js    # Harness 组件开关对比
        └── lab-trace.js      # Trace 侦探（找根因）
```

## 特性

- **10 章系统路线**：从概念到毕业项目再到设计模式进阶，每章配「自测 + 练习（带参考答案）」
- **8 个交互实验室**：全部纯前端模拟，不需要 API Key
- **在线运行（JupyterLite）**：全站 Python 代码块一键「⚡ 运行」——浏览器内 Pyodide 内核（官方 CDN），零安装；资源页附完整环境入口
- **50+ 段可运行代码**：Python 为主，附 Node.js 版本；每段标注文件名
- **8 篇论文精读 + 原文 PDF（papers/pdf/ 本站可读）+ 8 篇全文翻译版（对照式排版，重点标注 + 解读）**
- **学习进度**：自动保存在浏览器 localStorage，随时中断续学
- **零依赖、零构建**：纯 HTML/CSS/JS，双击即用；亮 / 暗主题自适应

## 实战章节需要的准备

第 2 章起需要 DeepSeek API Key（platform.deepseek.com 注册），代码均为 OpenAI 兼容写法：

```bash
pip install openai gradio rdflib owlrl
export DEEPSEEK_API_KEY="sk-你的密钥"
```

模型名与能力更新较快，请以 [DeepSeek 官方文档](https://api-docs.deepseek.com) 为准。

## 更新日志

### v1.2（当前）
- 新增**第 10 章「智能体设计模式」**：五张模式卡片（MCP / Guardrails / HITL / A2A / 异常恢复），七段结构（问题/思想/最小实现/边界/反模式/自测练习），代码均可独立运行
- **Gulli《Agentic Design Patterns》全本教材上站**（papers.html #gulli-book，署名教育用途）并作为站内导师第二知识源（`lookup_course` 双源检索，21 章 + 7 附录切块入库）
- 进度口径 9 → 10 章；`app.js` 缓存版本升至 v=21
- macOS App 同步打包教材 PDF 与第 10 章

### v1.1
- ReAct / RAG / CoT 三篇全文翻译页升级为**英文原文对照版**（逐段 seg-en 引用体排版）
- 第 2 章新增 **2.9 报错速查表**（API 层 + 代码层 14 类报错对号入座）
- 企业简报库每份简报新增「参考实现要点」折叠块（验收测试逐条映射到实现方案）
- 集成 **JupyterLite 在线运行**：代码块按钮内嵌官方 REPL（iframe + CDN），`app.js`/`style.css` 版本号升至 v=20

### v1.0
- 9 章主线 + 8 个交互实验室 + 论文四层阅读体系（精读/中文精读/8 篇全文翻译/原文 PDF）
- 企业简报库（实训）：3 份客户简报，验收测试全红起步
- FDE 能力地图 + 八维能力成绩单
- 站内搜索（⌘K）、阅读进度、目录滚动高亮、键盘翻章
