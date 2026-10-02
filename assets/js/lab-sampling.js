/* ============================================================
   实验室 9：采样温度实验室（LLM 基础速成页）
   固定的下一词概率分布 × 温度滑块，实时演示温度如何重排分布。
   数学完全真实：q_i = softmax(logits / T)，logits = ln(p_i)。
   ============================================================ */
"use strict";

function initSamplingLab() {
  const root = document.getElementById("lab-sampling");
  if (!root) return;

  const slider = root.querySelector("#temp-slider");
  const readEl = root.querySelector(".temp-read");
  const barsEl = root.querySelector(".temp-bars");
  const sampleBtn = root.querySelector("[data-act=sample]");
  const resetBtn = root.querySelector("[data-act=reset]");
  const chipsEl = root.querySelector(".temp-samples");

  // 上下文：「今天天气真___」的下一词分布（教学示例）
  const DIST = [
    { t: "好", p: 0.55 }, { t: "棒", p: 0.15 }, { t: "冷", p: 0.12 },
    { t: "热", p: 0.06 }, { t: "糟", p: 0.04 }, { t: "宜人", p: 0.03 },
    { t: "诡异", p: 0.03 }, { t: "崩坏", p: 0.02 },
  ];
  DIST.forEach(d => { d.logit = Math.log(d.p); });
  const samples = [];

  function probs(T) {
    const qs = DIST.map(d => Math.exp(d.logit / T));
    const Z = qs.reduce((a, b) => a + b, 0);
    return qs.map(q => q / Z);
  }
  function verdict(T) {
    if (T < 0.25) return "T→0：几乎永远选最高概率词（贪心）。输出最稳定，也最容易单调重复——Agent 主循环、抽取、分类用这一档。";
    if (T < 0.7) return "低温：分布向头部集中，偶有变化。写作助理、代码修改的常用区间。";
    if (T <= 1.05) return "T≈1：按模型「原生判断」采样。创意任务的起点。";
    if (T <= 1.5) return "高温：长尾被放大，冷门词频繁出现。适合头脑风暴，不适合交付。";
    return "T 极高：分布接近均匀——每个词都「差不多可能」，输出开始失去意义。";
  }
  function render() {
    const T = parseFloat(slider.value);
    const ps = probs(T);
    const maxP = Math.max(...ps);
    const topIdx = ps.indexOf(maxP);
    barsEl.innerHTML = DIST.map((d, i) => `
      <div class="temp-row">
        <span class="temp-token">${d.t}</span>
        <div class="temp-track"><div class="temp-fill ${i === topIdx ? "top" : ""}" style="width:${(ps[i] * 100).toFixed(1)}%"></div></div>
        <span class="temp-p">${(ps[i] * 100).toFixed(1)}%</span>
      </div>`).join("");
    readEl.innerHTML = `温度 T = <b>${T.toFixed(2)}</b><br>${verdict(T)}`;
    const tv = root.querySelector("#temp-val");
    if (tv) tv.textContent = T.toFixed(2);
    chipsEl.innerHTML = samples.map(s =>
      `<span class="temp-chip ${s === DIST[topIdx].t ? "hot" : ""}">${s}</span>`).join("");
  }
  sampleBtn.addEventListener("click", () => {
    const T = parseFloat(slider.value);
    const ps = probs(T);
    let r = Math.random(), acc = 0, picked = DIST[DIST.length - 1].t;
    for (let i = 0; i < DIST.length; i++) {
      acc += ps[i];
      if (r <= acc) { picked = DIST[i].t; break; }
    }
    samples.unshift(picked);
    if (samples.length > 14) samples.pop();
    render();
  });
  resetBtn.addEventListener("click", () => {
    slider.value = 0.7; samples.length = 0; render();
  });
  slider.addEventListener("input", render);
  render();
}

document.addEventListener("DOMContentLoaded", initSamplingLab);
