#!/usr/bin/env python3
# 从书的 PDF 提取插图(位图通道):get_image_info 能看到藏在 Form XObject 里的 2048px 高清图
# (pypdf 的 page.images 看不见它们);按页归属章,去重后落 PNG + 清单 JSON。
# 用法: python3 extract-book-figures.py --pdf <path> --slug <slug> --out figures/<slug> --manifest <json>
import argparse
import json
import re
from pathlib import Path

import pymupdf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--out", required=True)  # 相对站点根,如 figures/gulli-patterns
    ap.add_argument("--manifest", required=True)
    args = ap.parse_args()

    doc = pymupdf.open(args.pdf)
    site = Path(args.manifest).resolve().parents[2]  # tutor/scripts → tutor → 站点根
    out_dir = site / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1) 章节起始页 → 每页归属章(附录 100+)
    ch_of_page, starts = {}, []
    for i, page in enumerate(doc):
        head = page.get_text("text")[:300]
        m = re.search(r"Chapter\s+(\d{1,2})[:\s]", head)
        if m:
            starts.append((i, int(m.group(1))))
        else:
            m2 = re.search(r"^Appendix\s+([A-G])\b", head, re.M)
            if m2:
                starts.append((i, 100 + "ABCDEFG".index(m2.group(1))))
    for idx, (pg, ch) in enumerate(starts):
        end = starts[idx + 1][0] if idx + 1 < len(starts) else doc.page_count
        for p in range(pg, end):
            ch_of_page[p] = ch

    # 2) 提取位图:按 xref 去重,过滤小图,统一转 PNG(2x 版面已 2048px,降到宽 1500 足够屏显)
    figures, seen_xref = [], set()
    for pno, page in enumerate(doc):
        ch = ch_of_page.get(pno)
        if ch is None:
            continue
        for info in page.get_image_info(xrefs=True):
            xref = info.get("xref", 0)
            if not xref or xref in seen_xref:
                continue
            seen_xref.add(xref)
            bbox = info["bbox"]
            if (bbox[2] - bbox[0]) < 120 or (bbox[3] - bbox[1]) < 100:
                continue  # 图标/装饰
            base = doc.extract_image(xref)
            pix = pymupdf.Pixmap(doc, xref)
            if pix.width < 400:
                continue
            if pix.colorspace and pix.colorspace.n > 3:  # CMYK 等 → RGB
                pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
            name = f"ch{ch}-p{pno + 1}.png"
            # 原尺寸存储(2048px 高清),屏显尺寸由 CSS max-width 控制
            pix.save(out_dir / name)
            figures.append({
                "chapter": ch, "page": pno + 1, "file": f"{args.out}/{name}",
                "w": pix.width, "h": pix.height,
            })

    by_ch = {}
    for f in figures:
        by_ch.setdefault(f["chapter"], []).append(f)
    manifest = {"slug": args.slug, "source": args.pdf,
                "chapters": {str(k): sorted(v, key=lambda x: x["page"]) for k, v in sorted(by_ch.items())}}
    Path(args.manifest).write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    total_kb = sum((out_dir / f["file"].split("/")[-1]).stat().st_size for f in figures) // 1024
    print(f"✓ 提取 {len(figures)} 张图(共 {total_kb // 1024} MB),覆盖 {len(by_ch)} 章 → {out_dir}")
    for ch, figs in sorted(by_ch.items()):
        print(f"  第{ch}章: {len(figs)} 图")


if __name__ == "__main__":
    main()
