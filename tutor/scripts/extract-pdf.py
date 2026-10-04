#!/usr/bin/env python3
# 通用 PDF → 文本提取(pypdf layout 模式):论文管线第一步。
# 用法: python3 extract-pdf.py --pdf <path> --out <json>
# 产出: {"pdf": 路径, "pages": N, "text": 全文(页间以 \n\n 连接)}
import argparse
import json
import re
from pathlib import Path

from pypdf import PdfReader

LIGATURES = {"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl"}


def normalize(s: str) -> str:
    for k, v in LIGATURES.items():
        s = s.replace(k, v)
    s = s.replace("-\n", "")  # 行尾软连字符
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    reader = PdfReader(args.pdf)
    pages = [normalize(p.extract_text(extraction_mode="layout") or "") for p in reader.pages]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps({
        "pdf": args.pdf,
        "pages": len(pages),
        "text": "\n\n".join(pages),
    }, ensure_ascii=False))
    print(f"✓ {len(pages)} 页 → {args.out}({sum(len(p) for p in pages)} 字符)")


if __name__ == "__main__":
    main()
