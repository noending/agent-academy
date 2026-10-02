#!/usr/bin/env python3
# 把《Agentic Design Patterns》(Gulli) PDF 提取切块,生成导师第二知识源。
# 用法: python3 scripts/build-gulli-kb.py [--pdf PATH]
# 产出: kb/gulli-patterns.json(与 course-chunks.json 同结构,source=gulli)
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PDF = ROOT.parent / "papers" / "pdf" / "gulli-agentic-design-patterns.pdf"
OUT = ROOT / "kb" / "gulli-patterns.json"
MAX_CHARS = 1600
MIN_CHARS = 120

# 连字归一(论文提取的老经验)与软连字符
LIGATURES = {"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl"}


def normalize(s: str) -> str:
    for k, v in LIGATURES.items():
        s = s.replace(k, v)
    s = s.replace("-\n", "")  # 行尾软连字符
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def main() -> None:
    pdf = Path(sys.argv[sys.argv.index("--pdf") + 1]) if "--pdf" in sys.argv else DEFAULT_PDF
    if not pdf.exists():
        sys.exit(f"PDF 不存在: {pdf}")
    reader = PdfReader(str(pdf))
    # layout 模式:该 PDF 用默认模式会逐词换行,layout 能保留行结构与段落
    pages = [normalize(p.extract_text(extraction_mode="layout") or "") for p in reader.pages]
    full = "\n\n".join(pages)

    # 章节标题:行首 "Chapter N: 标题" / "Appendix X: 标题"(分隔符含冒号/点/破折号,
    # 用 [ \t] 而非 \s,防止跨行匹配出带换行的伪标题)
    head_re = re.compile(r"^(Chapter[ \t]+(\d{1,2})[ \t]*[:.\-\u2013\u2014][ \t]*(.{3,90})|Appendix[ \t]+([A-G])[ \t]*[:.\-\u2013\u2014][ \t]*(.{3,90}))$", re.M)

    marks = []
    for m in head_re.finditer(full):
        line = m.group(0).strip()
        if len(line) > 110:
            continue
        title = re.sub(r"\s+", " ", line)
        marks.append((m.start(), title, m.group(2) or m.group(4)))
    # 去重:同一位置只留一个(不同页拼接处可能重复)
    marks = [(p, t, n) for i, (p, t, n) in enumerate(marks) if i == 0 or p - marks[i - 1][0] > 40]
    if not marks:
        sys.exit("未识别到任何章节标题,请检查正则")

    chunks = []
    cid = 0
    for i, (pos, title, num) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(full)
        body = full[pos:end]
        chap_label = f"Chapter {num}" if num.isdigit() else f"Appendix {num}"
        # 按段落边界切块
        cur = ""
        parts = []
        for para in body.split("\n\n"):
            if len(cur) + len(para) > MAX_CHARS and cur:
                parts.append(cur.strip())
                cur = ""
            cur += ("\n\n" if cur else "") + para
        if cur.strip():
            parts.append(cur.strip())
        for p in parts:
            if len(p) < MIN_CHARS:
                continue
            chunks.append({
                "id": f"g{cid:03d}",
                "source": "gulli",
                "chapter": int(num) if num.isdigit() else 100 + ord(num) - ord("A"),
                "chapterTitle": chap_label,
                "title": title,
                "chars": len(p),
                "text": p,
            })
            cid += 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "builtAt": __import__("datetime").datetime.now().isoformat(),
        "source": f"{pdf.name} ({len(reader.pages)} 页)",
        "chunkCount": len(chunks),
        "chapters": sorted({c["chapter"] for c in chunks}),
    }
    OUT.write_text(json.dumps({"meta": meta, "chunks": chunks}, ensure_ascii=False, indent=1))
    n_pages = len(reader.pages)
    print(f"✓ {n_pages} 页 → {len(chunks)} 块 · 章节 {meta['chapters']}")
    print(f"  → {OUT}")


if __name__ == "__main__":
    main()
