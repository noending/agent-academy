# 人审清单 · 教学包 llm-course

- 来源: mlabonne/llm-course
- 课程: 从训练到部署：LLM 全栈实战课程(9 章)
- 知识库: kb/llm-course-kb.json(60 块,其中 51 块被大纲引用)
- 起步问题: 学习这门课程需要哪些前置知识？ / 如何选择适合自己的微调方法（全量微调 vs LoRA）？ / RAG 和 Agent 在实际项目中如何结合使用？ / 部署 LLM 时如何平衡性能、成本和隐私？

## 审校要点
1. [ ] 课程大纲顺序合理、覆盖仓库核心(对照原仓库 README)
2. [ ] 每章 chunkIds 引用是否对题(抽查 3 章)
3. [ ] 领域教学要点是否准确
4. [ ] 试教: node src/tutor.mjs --pack packs/llm-course 问 2~3 个问题看质量

## 使用
```bash
node src/tutor.mjs --pack packs/llm-course
```
知识库为自动生成的「机器初稿」——大纲与引用待人审,知识内容本身来自原仓库(可溯源)。
