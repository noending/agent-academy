#!/usr/bin/env python3
# 书章节页补强(确定性补丁,不调 LLM):
# ① 代码块补 language-* class(语法高亮/复制按钮/⚡ 运行的触发条件)
# ② PDF 链接补 #page= 页码锚点 + 「本章起于第 X 页」(跳原书对应位置)
# 幂等:已带 language- 的代码块跳过;已带 #page= 的链接跳过。
# 用法: python3 extract-book-figures.py 的章起始扫描逻辑复用 → 先输出章起始页,再逐页打补丁。
import json
import re
from pathlib import Path

import pymupdf

SITE = Path(__file__).resolve().parents[2]  # scripts → tutor → 站点根
PDF = SITE / "papers/pdf/gulli-agentic-design-patterns.pdf"
SLUG = "gulli-patterns"
LANGS = {"python", "javascript", "bash", "json", "js"}

# 1) 章起始页(与 extract-book-figures 同扫描)
doc = pymupdf.open(PDF)
starts = []
for i, page in enumerate(doc):
    head = page.get_text("text")[:300]
    m = re.search(r"Chapter\s+(\d{1,2})[:\s]", head)
    if m:
        starts.append((i + 1, int(m.group(1))))
    else:
        m2 = re.search(r"^Appendix\s+([A-G])\b", head, re.M)
        if m2:
            starts.append((i + 1, 100 + "ABCDEFG".index(m2.group(1))))
start_of_ch = {}
for idx, (pg, ch) in enumerate(starts):
    nxt = starts[idx + 1][0] if idx + 1 < len(starts) else doc.page_count
    if ch not in start_of_ch:
        start_of_ch[ch] = pg

# 2) 逐页打补丁
patched = 0
for p in sorted(SITE.glob(f"book-{SLUG}-ch*.html")):
    m = re.search(rf"book-{SLUG}-ch(\d+)\.html", p.name)
    no = int(m.group(1))
    html = p.read_text()
    orig = html
    # ① 代码块 language class:code-lang 标签后的裸 <pre><code>
    def add_lang(m):
        lang = m.group(1).lower()
        cls = "javascript" if lang == "js" else lang
        if cls not in LANGS:
            return m.group(0)
        return m.group(0).replace("<pre><code>", f'<pre><code class="language-{cls}">', 1)
    html = re.sub(r'<span class="code-lang">([\w-]+)</span></div>\s*<pre><code>', add_lang, html)
    # ② PDF 页码锚点
    pg = start_of_ch.get(no)
    if pg and "papers/pdf/gulli-agentic-design-patterns.pdf" in html:
        pdf_path = "papers/pdf/gulli-agentic-design-patterns.pdf"
        html = html.replace(f'<a class="chip" href="{pdf_path}">原书 PDF</a>',
                            f'<a class="chip" href="{pdf_path}#page={pg}">原书 PDF · 第{pg}页起</a>')
    if html != orig:
        p.write_text(html)
        patched += 1
print(f"✓ 补丁 {patched} 个章节页(章起始页映射 {len(start_of_ch)} 章)")
