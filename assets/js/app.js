/* ============================================================
   Agent 学院 · 共享脚本
   侧边导航 / 主题 / 进度 / 代码高亮与复制 / 目录 / 翻页
   ============================================================ */
"use strict";

/* ---------- 站点导航表 ---------- */
const NAV = [
  { id: "index", file: "index.html", icon: "目", title: "学习路径", group: "开始" },
  { id: "basics", file: "llm-basics.html", icon: "基", title: "LLM 基础速成", group: "开始" },
  { id: "ch1", file: "01-agent-basics.html", no: "01", title: "Agent 基础认知", group: "第一部分 · 亲手造一个 Agent" },
  { id: "ch2", file: "02-first-agent.html", no: "02", title: "动手写第一个 Agent", group: "第一部分 · 亲手造一个 Agent" },
  { id: "ch3", file: "03-prompt-engineering.html", no: "03", title: "Prompt 工程与上下文设计", group: "第一部分 · 亲手造一个 Agent" },
  { id: "ch4", file: "04-knowledge-base.html", no: "04", title: "知识库与 RAG 全链路", group: "第二部分 · 接入知识与记忆" },
  { id: "ch5", file: "05-agent-patterns.html", no: "05", title: "Agent 工程进阶", group: "第二部分 · 接入知识与记忆" },
  { id: "ch6", file: "06-ontology.html", no: "06", title: "深入理解 Ontology", group: "第三部分 · 两大核心概念" },
  { id: "ch7", file: "07-harness.html", no: "07", title: "深入理解 Harness", group: "第三部分 · 两大核心概念" },
  { id: "ch8", file: "08-ship-it.html", no: "08", title: "调试、评估与上线", group: "第四部分 · 上线与毕业" },
  { id: "ch9", file: "09-capstone.html", no: "09", title: "综合实战项目", group: "第四部分 · 上线与毕业" },
  { id: "ch10", file: "10-design-patterns.html", no: "10", title: "智能体设计模式", group: "第五部分 · 模式与拓展" },
  { id: "fde", file: "fde.html", icon: "职", title: "FDE 能力地图", group: "第五部分 · 模式与拓展" },
  { id: "briefs", file: "briefs.html", icon: "实", title: "企业简报库", group: "实训 · 企业简报" },
  { id: "courses", file: "courses.html", icon: "管", title: "课程管理", group: "附录" },
  { id: "papers", file: "papers.html", icon: "论", title: "论文精读", group: "附录" },
  { id: "translations", file: "translations.html", icon: "译", title: "中文精读版", group: "附录" },
  { id: "full", file: "full-react.html", icon: "全", title: "全文翻译（8 篇）", group: "附录" },
  { id: "res", file: "resources.html", icon: "索", title: "资源与术语表", group: "附录" },
];
const CHAPTER_IDS = ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "ch8", "ch9", "ch10"];

/* ---------- localStorage 安全封装 ---------- */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("agentAcademy." + key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem("agentAcademy." + key, JSON.stringify(val)); } catch (e) { /* 忽略 */ }
  },
};

const Progress = {
  data() { return store.get("progress", {}); },
  isDone(id) { return !!this.data()[id]; },
  toggle(id) {
    const d = this.data();
    if (d[id]) delete d[id]; else d[id] = true;
    store.set("progress", d);
    return !!d[id];   // 返回标记后的最新状态
  },
  count() { return CHAPTER_IDS.filter(id => this.isDone(id)).length; },
};

/* ---------- 主题 ---------- */
function initTheme() {
  const saved = store.get("theme", null);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("theme-btn");
  if (btn) {
    const sync = () => { btn.textContent = theme === "dark" ? "☀️" : "🌙"; btn.title = "切换亮 / 暗主题"; };
    sync();
    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      store.set("theme", next);
      btn.textContent = next === "dark" ? "☀️" : "🌙";
    });
  }
}

/* ---------- 侧边栏与顶栏 ---------- */
function renderSidebar() {
  const aside = document.getElementById("sidebar");
  if (!aside) return;
  const cur = document.body.getAttribute("data-chapter") || "index";
  let html = "";
  let lastGroup = null;
  let navOpen = false;
  for (const item of NAV) {
    if (item.group !== lastGroup) {
      if (navOpen) html += `</nav>`;
      html += `<div class="side-group">${item.group}</div><nav class="side-nav">`;
      lastGroup = item.group;
      navOpen = true;
    }
    const active = item.id === cur ? " active" : "";
    const no = item.no ? `<span class="no">${item.no}</span>` : `<span class="no">${item.icon || "·"}</span>`;
    const done = (item.no && Progress.isDone(item.id)) ? `<span class="done-mark">✓</span>` : "";
    html += `<a href="${item.file}" class="${active.trim()}">${no}<span>${item.title}</span>${done}</a>`;
  }
  if (navOpen) html += `</nav>`;
  const doneCount = Progress.count();
  html += `<div class="side-meta">
    学习进度：<b style="color:var(--accent)">${doneCount} / ${CHAPTER_IDS.length} 章</b><br>
    进度保存在浏览器本地，<br>随时中断、随时继续。
  </div>`;
  aside.innerHTML = html;

  const pill = document.getElementById("progress-pill");
  if (pill) pill.innerHTML = `进度 <b>${doneCount}/${CHAPTER_IDS.length}</b> 章`;
}

function initHamburger() {
  const btn = document.getElementById("hamburger");
  if (!btn) return;
  btn.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("nav-open") &&
        !e.target.closest(".sidebar") && !e.target.closest("#hamburger")) {
      document.body.classList.remove("nav-open");
    }
  });
}

/* ---------- 简易代码高亮（粘性正则逐位扫描） ---------- */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const KW_PY = /\b(def|class|return|if|elif|else|for|while|import|from|as|with|try|except|finally|raise|in|not|and|or|is|None|True|False|lambda|yield|break|continue|pass|global|assert|async|await|del)\b/;
const KW_JS = /\b(const|let|var|function|return|if|else|for|while|import|from|export|default|class|extends|new|try|catch|finally|throw|typeof|instanceof|async|await|yield|break|continue|switch|case|do|in|of|this|null|undefined|true|false|delete)\b/;
const RULES = {
  python: [
    [/("""[\s\S]*?"""|'''[\s\S]*?''')/, "c-str"],
    [/(#[^\n]*)/, "c-com"],
    [/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/, "c-str"],
    [/(@[\w.]+)/, "c-bi"],
    [KW_PY, "c-kw"],
    [/\b(print|len|range|str|int|dict|list|set|tuple|open|json|isinstance|enumerate|zip|type|super)\b/, "c-bi"],
    [/\b(\d[\d_]*(?:\.\d+)?)\b/, "c-num"],
    [/([A-Za-z_]\w*)(?=\s*\()/, "c-fn"],
  ],
  javascript: [
    [/(\/\/[^\n]*)/, "c-com"],
    [/(`(?:[^`\\]|\\.)*`)/, "c-str"],
    [/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/, "c-str"],
    [KW_JS, "c-kw"],
    [/\b(console|JSON|Math|Object|Array|Promise|process|require)\b/, "c-bi"],
    [/\b(\d[\d_]*(?:\.\d+)?)\b/, "c-num"],
    [/([A-Za-z_$][\w$]*)(?=\s*\()/, "c-fn"],
  ],
  json: [
    [/("(?:[^"\\]|\\.)*")(?=\s*:)/, "c-key"],
    [/("(?:[^"\\]|\\.)*")/, "c-str"],
    [/\b(true|false|null)\b/, "c-kw"],
    [/-?\b\d+(?:\.\d+)?\b/, "c-num"],
  ],
  bash: [
    [/(#[^\n]*)/, "c-com"],
    [/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/, "c-str"],
    [/\b(export|cd|pip|python3?|node|npm|npx|curl|git|mkdir|source)\b/, "c-kw"],
    [/(^\s*\$\s)/, "c-bi"],
    [/(-{1,2}[\w-]+)/, "c-num"],
  ],
  text: [],
};
function highlightCode(src, lang) {
  const rules = RULES[lang] || [];
  const sticky = rules.map(([re]) => { const r = new RegExp(re.source, re.flags.includes("y") ? re.flags : re.flags + "y"); return r; });
  let out = "", i = 0;
  while (i < src.length) {
    let best = null;
    for (let k = 0; k < sticky.length; k++) {
      sticky[k].lastIndex = i;
      const m = sticky[k].exec(src);
      if (m && m.index === i && (!best || m[0].length > best.len)) best = { len: m[0].length, text: m[0], cls: rules[k][1] };
    }
    if (best) {
      out += best.cls ? `<span class="${best.cls}">${escapeHtml(best.text)}</span>` : escapeHtml(best.text);
      i += best.len;
    } else {
      out += escapeHtml(src[i]); i += 1;
    }
  }
  return out;
}
function initCodeBlocks() {
  document.querySelectorAll(".codeblock pre code").forEach(codeEl => {
    const langMatch = (codeEl.className || "").match(/language-([\w-]+)/);
    const block = codeEl.closest(".codeblock");
    if (langMatch && RULES[langMatch[1]]) {
      codeEl.innerHTML = highlightCode(codeEl.textContent, langMatch[1]);
    }
    if (block && !block.querySelector(".copy-btn")) {
      const head = block.querySelector(".code-head");
      const btn = document.createElement("button");
      btn.className = "copy-btn"; btn.textContent = "复制";
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(codeEl.textContent);
          btn.textContent = "已复制 ✓";
        } catch (e) {
          const ta = document.createElement("textarea");
          ta.value = codeEl.textContent; document.body.appendChild(ta);
          ta.select(); document.execCommand("copy"); ta.remove();
          btn.textContent = "已复制 ✓";
        }
        setTimeout(() => { btn.textContent = "复制"; }, 1600);
      });
      if (head) head.appendChild(btn);
    }
  });
}

/* ---------- JupyterLite 在线运行（CDN 引入官方 REPL，点击代码块按钮时才加载 iframe） ---------- */
const LITE_BASE = "https://jupyterlite.github.io/demo/repl/index.html";
// import 名 → pip 包名(Pyodide 内置或纯 Python wheel,可 micropip 自动安装);
// 不在表内且非标准库的 import → 该块标记「需本地运行」
const LITE_PKG_MAP = {
  numpy: "numpy", pandas: "pandas", matplotlib: "matplotlib", scipy: "scipy",
  sklearn: "scikit-learn", rdflib: "rdflib", owlrl: "owlrl", pydantic: "pydantic",
  openai: "openai", httpx: "httpx", tqdm: "tqdm", yaml: "pyyaml",
  bs4: "beautifulsoup4", networkx: "networkx", dotenv: "python-dotenv",
};
const LITE_STDLIB = new Set(("abc asyncio base64 collections copy csv dataclasses datetime enum functools hashlib "
  + "heapq inspect itertools json math os pathlib pickle random re secrets shutil statistics string "
  + "sys textwrap time typing uuid warnings zipfile").split(" "));
// 出现这些用法 → 浏览器内必然失败(联网 API / 本地文件 / 无法在 Pyodide 运行的框架)
const LITE_LOCAL_ONLY = /client\.chat\.completions|OpenAI\(|api_key\s*=|\.launch\(|gradio|torch|transformers|pd\.read_csv|requests\.(get|post)|urlopen|embeddings\.create/;

function liteAnalyze(code) {
  const imports = new Set();
  for (const line of code.split("\n")) {
    let m = line.match(/^\s*import\s+([a-zA-Z_][\w.]*)/);
    if (m) imports.add(m[1].split(".")[0]);
    m = line.match(/^\s*from\s+([a-zA-Z_][\w.]*)/);
    if (m) imports.add(m[1].split(".")[0]);
  }
  const needs = [...imports].filter((m) => LITE_PKG_MAP[m]);
  const unknown = [...imports].filter((m) => !LITE_PKG_MAP[m] && !LITE_STDLIB.has(m));
  return { needs, unknown, localOnly: LITE_LOCAL_ONLY.test(code) || unknown.length > 0 };
}

function litePrelude(pkgs) {
  if (!pkgs.length) return "";
  const imports = JSON.stringify(pkgs);
  const map = JSON.stringify(Object.fromEntries(pkgs.map((p) => [p, LITE_PKG_MAP[p]])));
  return [
    "# ⚡ 以下为 Agent 学院自动注入的依赖安装(课程代码在后面)",
    "import importlib.util as _ilu, micropip as _mp",
    `_need = ${imports}`,
    `_pip = ${map}`,
    "_missing = [m for m in _need if _ilu.find_spec(m) is None]",
    "if _missing:",
    "    print('⏳ 自动安装缺失依赖:', ', '.join(_missing), '(首次约 10-30 秒)…')",
    "    await _mp.install([_pip[m] for m in _missing])",
    "    print('✓ 依赖就绪,下面运行课程代码')",
    ""
  ].join("\n");
}
function liteSrc(code) {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  return LITE_BASE + "?kernel=python&toolbar=1&execute=0&showBanner=0"
    + "&theme=" + (dark ? "JupyterLab%20Dark" : "JupyterLab%20Light")
    + "&code=" + encodeURIComponent(code);
}
function initLite() {
  document.querySelectorAll(".codeblock").forEach(block => {
    const head = block.querySelector(".code-head");
    const codeEl = block.querySelector("pre code");
    if (!head || !codeEl) return;
    const lang = ((codeEl.className || "").match(/language-([\w-]+)/) || [])[1];
    const label = head.querySelector(".code-lang");
    if (lang !== "python" || !label) return;
    if (LITE_SKIP.some(name => label.textContent.includes(name))) return;

    const code = codeEl.textContent;
    const { needs, unknown, localOnly } = liteAnalyze(code);

    // 需本地运行:联网 API / 本地文件 / 无法在 Pyodide 运行的包——不给 ⚡,给明确提示
    if (localOnly) {
      const badge = document.createElement("span");
      badge.className = "lite-local";
      const why = unknown.length ? "用到浏览器内无法安装的包: " + unknown.join(", ")
                                 : "需要联网 API 或本地文件";
      badge.innerHTML = "🔌 需本地运行(" + why + ")";
      badge.title = "请在本地 Python 环境运行(课程第 2 章有环境配置);代码仍可复制学习";
      head.insertBefore(badge, head.querySelector(".copy-btn"));
      return;
    }

    const btn = document.createElement("button");
    btn.className = "lite-btn"; btn.textContent = "⚡ 运行";
    btn.title = "在浏览器内的 JupyterLite(Pyodide)中运行;缺失的纯 Python 包会自动安装";
    btn.addEventListener("click", () => {
      const old = block.querySelector(".lite-frame");
      if (old) { old.remove(); btn.textContent = "⚡ 运行"; return; }
      const frame = document.createElement("div");
      frame.className = "lite-frame";
      frame.innerHTML =
        '<div class="lite-note">⏳ 正在加载浏览器内 Python 环境(首次需下载内核,几秒到几十秒)。' +
        '代码已预填(缺失依赖会自动安装),等提示符出现后按 <b>Shift + Enter</b> 运行。</div>';
      const iframe = document.createElement("iframe");
      iframe.setAttribute("allow", "clipboard-read; clipboard-write");
      iframe.src = liteSrc(litePrelude(needs) + code);
      iframe.addEventListener("load", () => frame.classList.add("ready"));
      frame.appendChild(iframe);
      block.appendChild(frame);
      btn.textContent = "⚡ 收起";
      frame.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    head.insertBefore(btn, head.querySelector(".copy-btn"));
  });
}

/* ---------- 自动编号 h2/h3 + 生成右侧目录 ---------- */
function initToc() {
  const content = document.querySelector(".content");
  if (!content) return;
  const heads = content.querySelectorAll("h2, h3");
  if (!heads.length) return;
  let h2n = 0, h3n = 0;
  const items = [];
  heads.forEach(h => {
    if (h.closest(".lab") || h.closest(".quiz")) return;
    if (h.tagName === "H2") { h2n++; h3n = 0; h.id = h.id || `sec-${h2n}`; items.push({ id: h.id, text: h.textContent, lvl: 2 }); }
    else { h3n++; h.id = h.id || `sec-${h2n}-${h3n}`; items.push({ id: h.id, text: h.textContent, lvl: 3 }); }
  });
  if (items.length < 3) return;
  const toc = document.createElement("nav");
  toc.className = "toc";
  toc.innerHTML = `<div class="toc-title">本页目录</div>` + items.map(it =>
    `<a href="#${it.id}" class="${it.lvl === 3 ? "lvl3" : ""}">${it.text}</a>`).join("");
  document.body.appendChild(toc);
}

/* ---------- 章节页脚：完成按钮 + 翻页 ---------- */
function initChapterFooter() {
  const cur = document.body.getAttribute("data-chapter");
  if (!CHAPTER_IDS.includes(cur)) return;   // 仅正文章节有页脚；附录页不挂
  const content = document.querySelector(".content .content-inner") || document.querySelector(".content");
  if (!content || content.querySelector(".chapter-footer")) return;

  const idx = NAV.findIndex(n => n.id === cur);
  const prev = NAV[idx - 1], next = NAV[idx + 1];
  const footer = document.createElement("div");
  footer.className = "chapter-footer";
  footer.innerHTML = `
    <button class="btn btn-done" id="mark-done">
      ${Progress.isDone(cur) ? "✓ 已标记学完（点击取消）" : "☐ 标记本章已学完"}
    </button>
    <div class="pager">
      ${prev ? `<a href="${prev.file}"><span class="dir">← 上一章</span><span class="pg-title">${prev.title}</span></a>` : "<span style='flex:1'></span>"}
      ${next ? `<a href="${next.file}" class="next"><span class="dir">下一章 →</span><span class="pg-title">${next.title}</span></a>` : "<span style='flex:1'></span>"}
    </div>`;
  content.appendChild(footer);
  const btn = footer.querySelector("#mark-done");
  btn.addEventListener("click", () => {
    const nowDone = Progress.toggle(cur);
    btn.textContent = nowDone ? "✓ 已标记学完（点击取消）" : "☐ 标记本章已学完";
    renderSidebar();
    const pill = document.getElementById("progress-pill");
    if (pill) pill.innerHTML = `进度 <b>${Progress.count()}/${CHAPTER_IDS.length}</b> 章`;
  });
}

/* ---------- 首页：卡片完成状态 ---------- */
function markIndexCards() {
  document.querySelectorAll(".ch-card[data-ch]").forEach(card => {
    if (Progress.isDone(card.getAttribute("data-ch"))) card.classList.add("done");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  renderSidebar();
  initHamburger();
  initCodeBlocks();
  initLite();
  initToc();
  initChapterFooter();
  markIndexCards();
});

/* ============================================================
   UX v3 · 阅读进度 / 返回顶部 / 目录滚动高亮 / 键盘翻章 / 站内搜索
   ============================================================ */
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    /* ── 阅读进度条 + 返回顶部 ── */
    const bar = document.createElement("div");
    bar.id = "read-progress";
    const top = document.createElement("button");
    top.id = "back-top"; top.title = "返回顶部"; top.textContent = "↑";
    top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    document.body.append(bar, top);
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + "%";
      top.classList.toggle("show", h.scrollTop > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* ── 目录滚动高亮（scroll-spy）── */
    const toc = document.querySelector(".toc");
    if (toc && "IntersectionObserver" in window) {
      const links = [...toc.querySelectorAll("a")];
      const map = new Map(links.map(a => [a.getAttribute("href").slice(1), a]));
      const obs = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            links.forEach(a => a.classList.remove("active"));
            const a = map.get(e.target.id);
            if (a) a.classList.add("active");
          }
        });
      }, { rootMargin: "-90px 0px -72% 0px" });
      map.forEach((a, id) => {
        const el = document.getElementById(id);
        if (el) obs.observe(el);
      });
    }

    /* ── 键盘翻章（← →）── */
    document.addEventListener("keydown", e => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector(".search-overlay.open")) return;
      const cur = document.body.getAttribute("data-chapter");
      if (!cur) return;
      const idx = NAV.findIndex(n => n.id === cur);
      if (idx === -1) return;
      const target = NAV[e.key === "ArrowRight" ? idx + 1 : idx - 1];
      if (target) location.href = target.file;
    });
  });
})();

/* ── 站内搜索（Ctrl/⌘ + K）── */
(function () {
  let index = null, failed = false, sel = -1, items = [];

  function overlay() {
    let ov = document.querySelector(".search-overlay");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.className = "search-overlay";
    ov.innerHTML = `<div class="search-panel">
      <input type="text" placeholder="搜索全站：章节、概念、论文、代码主题……" />
      <div class="search-results"><div class="search-empty">正在构建索引……</div></div>
      <div class="search-foot"><span>↑↓ 选择</span><span>↵ 打开</span><span>esc 关闭</span></div>
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) close(); });
    const input = ov.querySelector("input");
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { sel = Math.min(sel + 1, items.length - 1); paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
      else if (e.key === "Enter" && items[sel]) { go(items[sel]); }
    });
    return ov;
  }
  function close() {
    const ov = document.querySelector(".search-overlay");
    if (ov) ov.classList.remove("open");
  }
  function go(item) {
    close();
    location.href = item.page + (item.id ? "#" + item.id : "");
  }
  function paint() {
    const box = document.querySelector(".search-results");
    [...box.querySelectorAll(".sr")].forEach((el, i) => el.classList.toggle("sel", i === sel));
    if (items[sel]) items[sel].el?.scrollIntoView({ block: "nearest" });
  }
  function render(q) {
    const box = document.querySelector(".search-results");
    q = (q || "").trim().toLowerCase();
    items = [];
    sel = -1;
    if (!q) { box.innerHTML = `<div class="search-empty">输入关键词，检索全部章节、概念与论文段落</div>`; return; }
    const words = q.split(/\s+/).filter(Boolean);
    items = index.filter(e => words.every(w =>
      e.heading.toLowerCase().includes(w) || e.text.toLowerCase().includes(w) || e.title.toLowerCase().includes(w)));
    items.sort((a, b) => (b.heading.toLowerCase().includes(q) ? 1 : 0) - (a.heading.toLowerCase().includes(q) ? 1 : 0));
    items = items.slice(0, 14);
    if (!items.length) { box.innerHTML = `<div class="search-empty">没有找到「${q}」——换个说法试试（如：幻觉、沙箱、MCP、思维链）</div>`; return; }
    box.innerHTML = "";
    items.forEach((e, i) => {
      const a = document.createElement("a");
      a.className = "sr";
      a.href = e.page + (e.id ? "#" + e.id : "");
      a.innerHTML = `<div class="sr-head"><span class="sr-page">${e.title}</span><span>${e.heading}</span></div>
        <div class="sr-snip">${e.text.slice(0, 120)}</div>`;
      a.addEventListener("click", () => close());
      box.appendChild(a);
      e.el = a;
    });
  }
  async function build() {
    try {
      const idx = [];
      for (const item of NAV) {
        const res = await fetch(item.file);
        if (!res.ok) throw new Error("fetch fail");
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");
        const main = doc.querySelector(".content-inner") || doc.body;
        const heads = [...main.querySelectorAll("h2, h3")];
        if (!heads.length) {
          idx.push({ page: item.file, title: item.title, id: "", heading: item.title, text: (main.innerText || "").replace(/\s+/g, " ").slice(0, 400) });
          continue;
        }
        heads.forEach((h, i) => {
          if (!h.id) h.id = "sec-i" + i;
          let txt = "", node = h.nextElementSibling;
          while (node && !/^H[23]$/.test(node.tagName)) { txt += " " + (node.innerText || ""); node = node.nextElementSibling; }
          idx.push({ page: item.file, title: item.title, id: h.id, heading: h.innerText.trim(), text: txt.replace(/\s+/g, " ").slice(0, 400) });
        });
        idx.push({ page: item.file, title: item.title, id: "", heading: item.title, text: "页面入口 · " + item.title });
      }
      return idx;
    } catch (e) { failed = true; return null; }
  }
  async function open() {
    const ov = overlay();
    ov.classList.add("open");
    const input = ov.querySelector("input");
    input.value = ""; render(""); setTimeout(() => input.focus(), 30);
    if (!index && !failed) {
      index = await build();
      render(input.value);
      if (failed) document.querySelector(".search-results").innerHTML =
        `<div class="search-empty">搜索需要通过本地服务器访问：<br><b>python3 -m http.server 8765</b> 后刷新本页（file:// 直开不支持跨页检索）</div>`;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    /* 顶栏搜索按钮 */
    const btn = document.createElement("button");
    btn.className = "search-btn"; btn.title = "搜索（Ctrl/⌘ + K）";
    btn.innerHTML = `搜索 <span class="k">⌘K</span>`;
    const pill = document.getElementById("progress-pill");
    pill?.parentNode.insertBefore(btn, pill);
    btn.addEventListener("click", open);
    /* 快捷键 */
    document.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); open();
      } else if (e.key === "Escape") close();
    });
  });
})();
