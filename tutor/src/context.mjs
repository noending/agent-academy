// 长对话上下文保护:估算 token 占用,超预算时从最早的完整轮次开始丢弃。
// 切割点只选 user 消息边界,保证 assistant 工具调用与 toolResult 始终成对保留。
const TOKENS_PER_CHAR = 0.6; // 中文约 0.6 token/字符;英文按此估会偏高,方向安全

export function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) {
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    chars += c.length + 8;
  }
  return Math.ceil(chars * TOKENS_PER_CHAR);
}

/**
 * 超预算时修剪历史,返回新的消息数组(短对话原样返回)。
 * - 从尾部向前累积,在「user 消息边界」找最远的可行切割点;
 * - 至少保留 keepMin 条最近消息;
 * - 切割处放一条提示,避免模型对突兀的开头困惑。
 */
export function pruneMessages(messages, maxTokens = 24_000, keepMin = 8) {
  if (estimateTokens(messages) <= maxTokens) return messages;
  const budget = Math.floor(maxTokens * 0.85);
  const cut = findCut(messages, budget, keepMin);
  if (cut <= 0) return messages; // 没有安全切割点,原样返回,由上层兜底
  const marker = {
    role: "user",
    content: "(注:更早的对话因长度限制已被修剪;学生档案与学习进度见系统提示,不受影响)",
    timestamp: Date.now(),
  };
  return [marker, ...messages.slice(cut)];
}

/** 找最远的可行切割点(只落 user 消息边界);找不到返回 -1 */
function findCut(messages, budgetTokens, keepMin) {
  let acc = 0;
  let cut = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    acc += Math.ceil((c.length + 8) * TOKENS_PER_CHAR);
    if (acc > budgetTokens) break;
    if (m.role === "user" && messages.length - i >= keepMin) cut = i;
  }
  return cut;
}

// ---------- ② 总结式压缩(LLM 摘要替代丢弃,课程 5.1 压缩器的生产版) ----------

const summaryCache = new Map(); // 被剪前缀的 hash → 摘要(前缀只增不变,可安全缓存)

function hashOf(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function transcriptOf(messages) {
  return messages
    .map((m) => {
      if (m.role === "user") {
        const t = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        return `[学生] ${t.slice(0, 400)}`;
      }
      if (m.role === "assistant") {
        const texts = (m.content || []).filter((c) => c.type === "text").map((c) => c.text).join(" ");
        const calls = (m.content || []).filter((c) => c.type === "toolCall").map((c) => c.name);
        return `[导师] ${texts.slice(0, 400)}${calls.length ? `(调用工具: ${calls.join(",")})` : ""}`;
      }
      if (m.role === "toolResult") {
        const t = (m.content || []).filter((c) => c.type === "text").map((c) => c.text).join(" ");
        return `[工具·${m.toolName}] ${t.slice(0, 200)}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * 总结式压缩:超预算时把被剪掉的前缀交给 summarize() 生成要点摘要,
 * 以「历史摘要」消息开头,替代直接丢弃。摘要按前缀内容缓存(对话只追加,
 * 同一前缀不会重复总结);summarize 抛错时回退到 pruneMessages(丢弃式)。
 */
export async function compactMessages(messages, { maxTokens = 24_000, keepMin = 8, summarize }) {
  if (estimateTokens(messages) <= maxTokens) return messages;
  const budget = Math.floor(maxTokens * 0.85);
  const cut = findCut(messages, budget, keepMin);
  if (cut <= 0) return pruneMessages(messages, maxTokens, keepMin);

  const dropped = messages.slice(0, cut);
  const kept = messages.slice(cut);
  const key = hashOf(JSON.stringify(dropped) + "|" + keepMin);
  let summary = summaryCache.get(key);
  if (summary === undefined) {
    try {
      summary = await summarize(transcriptOf(dropped));
      if (!summary || !String(summary).trim()) throw new Error("空摘要");
      summary = String(summary).trim().slice(0, 1200);
      summaryCache.set(key, summary);
    } catch {
      return pruneMessages(messages, maxTokens, keepMin); // 摘要失败 → 丢弃式兜底
    }
  }
  const digest = {
    role: "user",
    content: `[历史摘要(自动生成,细节可能有省略)]\n${summary}\n(以上为更早对话的摘要;学生档案与学习进度见系统提示,不受影响)`,
    timestamp: Date.now(),
  };
  return [digest, ...kept];
}
