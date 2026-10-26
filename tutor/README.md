# Agent 学院 · 开发导师(tutor)

把《Agent 学院》从「看的教材」升级成「会教学的导师」:一个基于 **[Pi Agent](https://github.com/badlogic/pi-mono) 的库(pi-agent-core / pi-ai)+ DeepSeek** 的教学智能体,只教一件事——**真正理解智能体的开发**。

静态站点(上级目录的 9 章 HTML)原样保留,作为导师的知识库语料;本目录是导师的运行时。

## 架构

```
学生 ⇄ CLI 对话 ⇄ Agent loop(pi-agent-core)
                      ├─ 模型层 pi-ai(默认 deepseek-v4-flash,可换任意引擎)
                      ├─ 教学工具(7 个)
│    lookup_course      BM25 检索课程知识库(课程 531 块 + Gulli 589 块,标题加权,CJK 二元组分词)
│    get_student_profile  读学生档案
│    record_progress      记录「展示了理解」的概念(有证据才算)
│    record_misconception 记录误解,后续针对性纠正
│    update_plan          更新当前焦点 / 下一步 / 水平
│    record_knowledge_gap 留档课程库覆盖不到的盲区(带 pack 归因,知识进化的依据)
│    run_code             JS/Python 沙箱(10s 超时),验证示例与练习
                      ├─ 教学包 packs/agent-dev(系统提示词:苏格拉底式 + 先诊断再教学)
                      ├─ 学生记忆 students/<id>.json(跨会话持久)
                      └─ 会话日志 students/<id>.session.jsonl(JSONL,可回放)
```

设计原则与课程第 7 章一致:**Pi 只当地基(透明的小循环),教学法层(诊断、记忆、评估)是自己建的**——那才是教学产品的核心。

## 快速开始

```bash
cd tutor
npm install
npm run build:kb          # 9 章 HTML → kb/course-chunks.json(约 492 块)

# 无 Key 先验证全链路(脚本化模型,不调真实 API)
npm test

export DEEPSEEK_API_KEY="sk-..."   # platform.deepseek.com
npm start                          # 开始上课
```

其他模型:`TUTOR_PROVIDER=openai TUTOR_MODEL=gpt-4.1-mini npm start`(pi-ai 支持 30+ 引擎)。

## 会话内命令

| 命令 | 作用 |
|---|---|
| `/profile` | 查看学生档案(掌握 / 误解 / 计划) |
| `/reset` | 清空当前对话(档案保留) |
| `/exit` | 保存并退出 |

## 嵌入模式(--rpc)与数据目录

```bash
node src/tutor.mjs --rpc      # stdin: {"type":"user","text":…} / {"type":"context","page":{"file","title"}}
                              #        / {"type":"control","cmd":"reset|abort|profile|exit"}
                              # stdout: hello → delta* → tool_start/tool_end(成败都发) → turn_end → ready(一轮结束)
                              #         control abort → aborted(中断正在生成的一轮,之后照常 ready)
```

turn 串行执行:greet/user 消息依次排队,期间到达的不会并发 prompt,每轮结束都发 `ready`;同一进程内重复 `greet` 不重复开场(只补一个 ready,`reset` 后可重新开场)。

`context` 消息上报学生当前阅读页面(嵌入方翻页时推送);tutor 在下一条学生消息前注入 `[正在学习: …]` 前缀,教学贴合当前章节,并记录进会话日志的 `page` 字段。

macOS App 的「导师模式」就是这个协议的客户端。学生数据默认写 `tutor/students/`;嵌入方设 `TUTOR_DATA_DIR=<数据根>` 重定向(其下建 `students/`);盲区档案可设 `TUTOR_GAPS_FILE=<文件>` 重定向(默认 `tutor/knowledge-gaps.jsonl`,记录带 pack 归因)。长对话超 24k token 触发**总结式压缩**:被剪前缀由 LLM 压成要点摘要(按前缀缓存,不重复付费;摘要失败自动回退丢弃式修剪,工具调用/结果成对保留)。

## 文件结构

```
tutor/
├── packs/agent-dev/        # 教学包:pack.json + system-prompt.md(教学法都在这里)
├── scripts/build-kb.mjs    # 知识库构建(HTML → 切块 JSON)
├── scripts/build-gulli-kb.py # 教材 PDF → 切块(pypdf layout 模式)
├── scripts/build-context.mjs  # 上下文化索引(Anthropic Contextual Retrieval:LLM 为每块生成中文定位前缀,8 并发/断点续跑)
├── scripts/extract-pdf.py     # 通用 PDF 提取(pypdf layout 模式)
├── scripts/make-paper-page.mjs   # M1 论文管线: PDF → 翻译+解读 → 草稿页 + 人审清单
├── scripts/make-book-page.mjs    # 读书管线: 书的 kb → 分章摘要 → 导读草稿页 + 读书导师 pack(答案只来自书内,金句逐字校验);--cards 复跑模式重渲染
├── scripts/make-book-chapter.mjs # 分章翻译页: 一章 → 块级解析(代码块还原/标题/散文) → 英中对照 + 原书插图画廊 + 本章一图流(book-<slug>-chN.html);--all 批量,中文书自动直出
├── scripts/extract-book-figures.py # PDF 插图提取(PyMuPDF;get_image_info 可见 Form XObject 里的位图,pypdf 看不见)→ figures/<slug>/ + 清单
├── scripts/import-book.mjs       # 一键导入: PDF/URL → 章节感知切块(Chapter N/第N章/h2) → kb(+--ctx-run) → 接力读书管线
├── scripts/publish-book.mjs      # 读书导读发布: 剥初稿标记 + manifest approved
├── scripts/make-pack-from-repo.mjs # M2 仓库管线: GitHub 仓库 → 教学包(课程规划器)
├── scripts/make-course-from-topic.mjs # M3 课题管线: 课题 → 整门课(教学包+站点草稿;内容为模型知识,须人审核实)
├── kb/course-chunks.json   # 构建产物(可重建,勿手改)
├── src/
│   ├── tutor.mjs           # 入口:Agent loop + CLI + 会话日志
│   ├── retrieval.mjs       # BM25(中文二元组 + 英文词)
│   ├── memory.mjs          # 学生档案读写与渲染
│   └── tools.mjs           # 7 个教学工具(pi-agent-core AgentTool 接口)
├── students/               # 运行时生成:<id>.json 档案、<id>.session.jsonl 会话
├── scripts/eval-teaching.mjs  # 教学行为评估集(真实 API:脚本化学生场景→行为断言)
└── test/smoke.mjs          # 冒烟测试(检索/记忆/沙箱/全链路)
```

## 教学法(为什么这样设计)

- **「听懂了」不算数**:只有学员自己解释对了、举对了例子,才调 record_progress;
- **误解是资产**:record_misconception 把学员的理解偏差记下来,跨会话纠正;
- **代码必须真跑过**:导师给的示例先过 run_code,练习答案也用它检查;
- **课程是唯一教材**:讲解要求引用章节号,课程外内容会明确标注。

## 扩展:教任何技能

「全能导师」不需要新架构——加一个教学包即可:

```bash
packs/<新技能>/
├── pack.json      # 指向该技能的知识库
└── system-prompt.md  # 该领域的教学法
node src/tutor.mjs --pack packs/<新技能> --student <id>
```

每个新领域需要配齐:知识库语料 + 领域练习工具(现在的 run_code 只覆盖编程类)。

## 测试

```bash
npm test    # 51 项(结构层):检索命中章/节、记忆与工具 execute 路径、盲区归因、JS/Python 沙箱、
            # mock 全链路、会话 JSONL 无双记、RPC 协议(串行/abort/tool_end)
npm run eval  # 教学行为评估集(行为层,真实 API,成本 < $0.01):6 个脚本化学生场景——
              # 目标当轮入档、误解同轮留档、掌握须凭证据、超纲留档盲区(pack 归因)、
              # 引用出处(课程/Gulli)、页面上下文;评估数据隔离在临时目录,报告落 drafts/evals/。
              # evolve-teaching --apply 应用提示词提案时会自动跑(失败自动回滚,--skip-evals 跳过)。
```
