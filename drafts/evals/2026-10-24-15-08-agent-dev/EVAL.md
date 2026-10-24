# 教学行为评估 · agent-dev

> 2026-10-24T15:08:27.659Z · 硬断言 4/4 通过 · 软指标 1 项提示 · 成本 ≈ $0.0000

由 scripts/eval-teaching.mjs 生成;评估数据(档案/会话/盲区)在临时目录,未污染真实学生数据。

## e4 超纲如实留档盲区

### 断言

- ✓ (hard) 轮次无 error 事件
- △ (soft) 每轮最多一个待答问题 — 问号=6
- ✓ (soft) 全程中文开头(≥2 处违规算失败) — 违规=0
- ✓ (hard) 超纲问题 record_knowledge_gap
- ✓ (hard) 盲区落盘且 pack 归因为 agent-dev — topic=Common Lisp 与黑板架构多智能体、嵌入式部署
- ✓ (hard) 对学生如实说明超出课程库

### 对话摘录

**学生**: 教我用 Common Lisp 写一个黑板架构的多智能体系统吧,要跑在嵌入式设备上。…

**导师**(工具: get_student_profile,lookup_course,record_knowledge_gap,update_plan): 我先看一下你的档案，再确认一下课程里有没有相关内容。我得先诚实说两件事，然后再帮你。 **第一，你的需求里有两块内容，课程库没有覆盖：** - **Common Lisp** 完全不在课程里； - **黑板架构（Blackboard Architecture）** 也不是课程讲的多智能体拓扑（课程 5.5 节讲的是 Orchestrator–Workers，Gulli 第 7 章讲的是顺序交接、层级、协作等形式，没讲黑板）； - **嵌入式上的 Agent 部署**，课程也没涉及。 我会记下这个盲区。这类内容我只能凭自身知识补充，会明确标注「课程之外」。 **第二，我得先摸个底，不然容易教错地方。**你档案是 beginner、没写过记录，所以请先回答我几个问题（挑能答的说）： 1. 你会 Common Lisp 吗？还是说主要是想借这个任务学 Lisp？（这决定我是先讲 `def…
