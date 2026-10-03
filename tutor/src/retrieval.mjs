// BM25 检索:中文按二元组切词,ASCII 按单词切词,纯实现零依赖。
import { readFileSync } from "node:fs";

const K1 = 1.5;
const B = 0.75;

export function tokenize(text) {
  const tokens = [];
  const ascii = text.toLowerCase().match(/[a-z0-9_+\-#.]+/g) || [];
  tokens.push(...ascii);
  const cjk = text.match(/[\u4e00-\u9fff]/g) || [];
  for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk[i] + cjk[i + 1]); // 二元组
  return tokens;
}

export class CourseIndex {
  constructor(chunks) {
    this.chunks = chunks;
    this.docs = chunks.map((c) => {
      // 上下文化索引:LLM 生成的前缀参与匹配,展示仍用原文
      const body = (c.context ? c.context + " " : "") + `${c.title} ${c.title} ${c.text}`;
      const tf = new Map();
      for (const t of tokenize(body)) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }
      return tf;
    });
    this.avgLen =
      this.docs.reduce((s, tf) => s + [...tf.values()].reduce((a, b) => a + b, 0), 0) /
      (this.docs.length || 1);
    this.df = new Map();
    for (const tf of this.docs) {
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
    }
  }

  static load(path, sourceLabel = "course") {
    const { chunks } = JSON.parse(readFileSync(path, "utf8"));
    for (const c of chunks) c.source = c.source || sourceLabel;
    return new CourseIndex(chunks);
  }

  // 双源合并索引:课程 + Gulli《Agentic Design Patterns》等外部教材,统一 BM25 排序
  static loadMerged(sources) {
    let all = [];
    for (const { path, source } of sources) {
      const { chunks } = JSON.parse(readFileSync(path, "utf8"));
      for (const c of chunks) c.source = c.source || source;
      all = all.concat(chunks);
    }
    return new CourseIndex(all);
  }

  search(query, topK = 3, filterChapter = null, filterSource = null) {
    const qTokens = tokenize(query).filter((t) => (this.df.get(t) || 0) > 0);
    const N = this.docs.length;
    const scores = this.docs.map((tf, i) => {
      const c = this.chunks[i];
      if (filterSource && c.source !== filterSource) return -1;
      if (filterChapter && c.chapter !== filterChapter) return -1;
      const len = [...tf.values()].reduce((a, b) => a + b, 0);
      let score = 0;
      for (const t of qTokens) {
        const f = tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - (this.df.get(t) || 0) + 0.5) / ((this.df.get(t) || 0) + 0.5));
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (len / this.avgLen))));
      }
      return score;
    });
    return scores
      .map((s, i) => ({ i, s }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, topK)
      .map(({ i, s }) => ({ ...this.chunks[i], score: +s.toFixed(2) }));
  }

  formatHits(hits) {
    if (!hits.length) return "课程库中没有找到相关内容。";
    return hits
      .map((h, n) => {
        const label =
          h.source === "gulli"
            ? `《Agentic Design Patterns》${h.chapterTitle} · ${h.title.replace(/^Chapter\s+\d+\s*[-:.]\s*/, "")}`
            : `${h.section ? h.section + " " : ""}${h.title}(第${h.chapter}章 · ${h.chapterTitle})`;
        return `【${n + 1}】${label} · 相关度 ${h.score}\n${h.text}`;
      })
      .join("\n\n———\n\n");
  }
}
