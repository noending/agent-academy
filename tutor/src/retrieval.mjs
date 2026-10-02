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
      const tf = new Map();
      for (const t of tokenize(`${c.title} ${c.title} ${c.text}`)) {
        // 标题加权:计两次
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

  static load(path) {
    const { chunks } = JSON.parse(readFileSync(path, "utf8"));
    return new CourseIndex(chunks);
  }

  search(query, topK = 3, filterChapter = null) {
    const qTokens = tokenize(query).filter((t) => (this.df.get(t) || 0) > 0);
    const N = this.docs.length;
    const scores = this.docs.map((tf, i) => {
      if (filterChapter && this.chunks[i].chapter !== filterChapter) return -1;
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
      .map(
        (h, n) =>
          `【${n + 1}】${h.section ? h.section + " " : ""}${h.title}(第${h.chapter}章 · ${h.chapterTitle},相关度 ${h.score})\n${h.text}`
      )
      .join("\n\n———\n\n");
  }
}
