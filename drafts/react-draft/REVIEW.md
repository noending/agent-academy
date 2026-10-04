# 人审清单 · ReAct(机器初稿)

- 论文: ReAct: Synergizing Reasoning and Acting in Language Models
- PDF: `/Users/liam/ZCodeProject/agent-academy/papers/pdf/react.pdf`
- 草稿页: `full-react-draft.html`(已在站点根,**未挂导航、未加 papers 条目**)
- 规模: 105 段(译 27 / 略 78)· 关键句 6 · 模型 deepseek-v4-flash

## 审校要点
1. [ ] 抽查 5 段翻译:术语、数字、逻辑是否忠实
2. [ ] 所有 <b> 强调是否放在真正重要的位置
3. [ ] 「解读」是否准确、有无过度演绎
4. [ ] 关键句精读 6 条:原句完整?解析到位?
5. [ ] 结构:小节标题是否符合论文实际
6. [ ] 全文搜索「机器生成,待审」——发布前删除全部字样

## 发布步骤(审完执行)
1. 改名 full-react-draft.html(去掉 draft 语义或保留)
2. papers.html 添加条目(元信息 + 原文 PDF 链接 + 指向本页)
3. 删除页内「人审须知」callout 与所有待审字样
4. node scripts/check-site.mjs 全绿
5. git commit + push
