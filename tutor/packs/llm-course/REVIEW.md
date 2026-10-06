# 人审清单 · 教学包 llm-course

- 来源: mlabonne/llm-course
- 课程: 从训练到部署：LLM 全栈实战课程(8 章)
- 知识库: kb/llm-course-kb.json(60 块,其中 50 块被大纲引用)
- 起步问题: 这门课程适合什么基础的人学习？需要先学哪些预备知识？ / 从零开始训练一个 LLM 需要经历哪些主要阶段？ / 微调 LLM 时，全量微调和 LoRA 等参数高效方法该如何选择？ / 如何把训练好的 LLM 部署成生产级应用并保证安全？

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
