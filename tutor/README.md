# Agent 学院 · 开发导师(tutor)

把《Agent 学院》从「看的教材」升级成「会教学的导师」:一个基于 **[Pi Agent](https://github.com/badlogic/pi-mono) 的库(pi-agent-core / pi-ai)+ DeepSeek** 的教学智能体,只教一件事——**真正理解智能体的开发**。

静态站点(上级目录的 9 章 HTML)原样保留,作为导师的知识库语料;本目录是导师的运行时。

## 架构

```
学生 ⇄ CLI 对话 ⇄ Agent loop(pi-agent-core)
                      ├─ 模型层 pi-ai(默认 deepseek-v4-flash,可换任意引擎)
                      ├─ 教学工具(6 个)
                      │    lookup_course      BM25 检索课程知识库(492 块,标题加权,CJK 二元组分词)
                      │    get_student_profile  读学生档案
                      │    record_progress      记录「展示了理解」的概念(有证据才算)
                      │    record_misconception 记录误解,后续针对性纠正
                      │    update_plan          更新当前焦点 / 下一步 / 水平
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
                              #        / {"type":"control","cmd":"reset|profile|exit"}
                              # stdout: hello → delta* → tool_start/tool_end → turn_end → ready(一轮结束)
```

`context` 消息上报学生当前阅读页面(嵌入方翻页时推送);tutor 在下一条学生消息前注入 `[正在学习: …]` 前缀,教学贴合当前章节,并记录进会话日志的 `page` 字段。

macOS App 的「导师模式」就是这个协议的客户端。学生数据默认写 `tutor/students/`;嵌入方设 `TUTOR_DATA_DIR=<数据根>` 重定向(其下建 `students/`)。长对话超 24k token 自动修剪最早的完整轮次(工具调用/结果成对保留)。

## 文件结构

```
tutor/
├── packs/agent-dev/        # 教学包:pack.json + system-prompt.md(教学法都在这里)
├── scripts/build-kb.mjs    # 知识库构建(HTML → 切块 JSON)
├── kb/course-chunks.json   # 构建产物(可重建,勿手改)
├── src/
│   ├── tutor.mjs           # 入口:Agent loop + CLI + 会话日志
│   ├── retrieval.mjs       # BM25(中文二元组 + 英文词)
│   ├── memory.mjs          # 学生档案读写与渲染
│   └── tools.mjs           # 6 个教学工具(pi-agent-core AgentTool 接口)
├── students/               # 运行时生成:<id>.json 档案、<id>.session.jsonl 会话
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
npm test    # 17 项:检索命中章/节、记忆模块与记忆工具 execute 路径、JS/Python 沙箱、mock 全链路、会话 JSONL
```
