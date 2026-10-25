# 人审清单 · Agentic Design Patterns(机器导读初稿)(读书导读)

- 书: Agentic Design Patterns / Antonio Gulli · 2025
- kb: `kb/gulli-patterns.json` + ctx
- 草稿页: `book-gulli-patterns.html`(已在站点根,**未挂导航**;books.html 动态收录 manifest kind=book 条目)
- 读书导师包: `tutor/packs/gulli-patterns/`(pack.json + system-prompt.md;已存在则本次未覆盖)
- 规模: 589 块 · 28 章 · 金句池 82(校验通过 82/丢弃 2)· 模型 deepseek-v4-flash

## 审校要点(导读模板验证点)
1. [ ] **一句话定位/写给谁/读不读**:是否准确、是否有过度演绎
2. [ ] **核心论点 5 条**:论点是否真是全书之魂,章节回链是否站得住
3. [ ] **全书骨架分部**:分部逻辑是否符合书的实际结构;每章 oneLiner 抽查 3 章
4. [ ] **三条阅读路径**:快读路径 2~4 章是否真能拿到核心;问题驱动的入口是否真实常见
5. [ ] **金句 12 条**:已逐字校验,但需人审「语境是否被误读」
6. [ ] **站内关联**:链接逐一点开验证
7. [ ] **读书导师 pack**:抽查 2 个问题验证「引用章节 + 检索不到就明说」行为

## 发布步骤(审完执行)
1. node scripts/publish-book.mjs --slug gulli-patterns(剥初稿标记,manifest 标记 approved)
2. 导航已含 books.html(读书板块索引,动态渲染);如未挂请检查 app.js NAV
3. node scripts/check-site.mjs 全绿
4. git commit + push
