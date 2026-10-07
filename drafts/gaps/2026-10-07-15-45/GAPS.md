# 知识盲区分析 · 全部教学包

> meta-导师自动生成 · 显式盲区 3 · 检索脱靶 0

## 主题聚类与补课方案

### 1. LLM 教学与评估(优先级 高)

- **归入的盲区**:
  - 怎么设计 LLM 课程的教学质量评估集？
- **推荐方案**:paper — arXiv:2305.18654 (Evaluating Large Language Models: A Comprehensive Survey) 或 arXiv:2307.09288 (Llama 2 中的评估方法)
- **示例命令**:

```bash
node scripts/make-paper-page.mjs --pdf <论文PDF> --slug 补课-arXiv23051 --title-en "<论文标题>"
```

### 2. LLM 推理部署与选型(优先级 高)

- **归入的盲区**:
  - 小团队如何选择 LLM 推理框架（vLLM/TGI）？
- **推荐方案**:repo — vllm-project/vllm 和 huggingface/text-generation-inference 的官方文档与基准测试
- **示例命令**:

```bash
node scripts/make-pack-from-repo.mjs --repo <owner/name> --skill 补课-vllm-project
```

### 3. Agent 安全与提示注入防御(优先级 高)

- **归入的盲区**:
  - 学生开发的 Agent 如何防提示注入？
- **推荐方案**:paper — arXiv:2302.12173 (Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection) 及后续防御论文
- **示例命令**:

```bash
node scripts/make-paper-page.mjs --pdf <论文PDF> --slug 补课-arXiv23021 --title-en "<论文标题>"
```

## 总结

盲区集中在 LLM 教学评估、推理部署选型与 Agent 安全三个方向。最优先补课的是 Agent 提示注入防御，因其直接关系学生项目安全；其次为推理框架选型与教学评估集设计。

## 原始清单

- [导师留档] 主题: 测试盲区-评测 | 问题: 怎么设计 LLM 课程的教学质量评估集?
- [导师留档] 主题: 测试盲区-部署 | 问题: 小团队如何选择 LLM 推理框架(vLLM/TGI)?
- [导师留档] 主题: 测试盲区-安全 | 问题: 学生开发的 Agent 如何防提示注入?
