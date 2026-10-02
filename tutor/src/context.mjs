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
  let acc = 0;
  let cut = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    acc += Math.ceil((c.length + 8) * TOKENS_PER_CHAR);
    if (acc > budget) break;
    if (m.role === "user" && messages.length - i >= keepMin) cut = i;
  }
  if (cut <= 0) return messages; // 没有安全切割点,原样返回,由上层兜底
  const marker = {
    role: "user",
    content: "(注:更早的对话因长度限制已被修剪;学生档案与学习进度见系统提示,不受影响)",
    timestamp: Date.now(),
  };
  return [marker, ...messages.slice(cut)];
}
