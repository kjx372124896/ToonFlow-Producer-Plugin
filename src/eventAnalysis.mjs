// 与 ToonFlow 原生文本模型共用 /api/ai/models + /api/ai/generate。
// 用户提供的模板有“7字段”和“涉及场景”8字段冲突；按最高优先级和示例采用7字段。
export const eventPrompt = `你是小说文本分析助手。用户每次提供一个章节原文，你仅提取该章的结构化事件信息。

【最高优先级：输出约束】
完整回复必须只有一行，第一字符和最后字符都是 |，恰好七个非空字段。
禁止引导语、总结、解释、表头、换行、Markdown、代码块；不要额外输出“涉及场景”列。
格式严格为：
| 第X章 {章节标题} | {涉及角色} | {核心事件} | {主线关系} | {信息密度} | {预估集长} | {情绪强度} |

章节：使用提供的实际章节编号及章节标题，不擅自修改。
涉及角色：仅写有实际戏份的角色，主要称呼使用原文形式，用顿号分隔；无角色写“无”。
核心事件：30-60字，包含动作和结果；多线并行优先对主角影响最大的一条，其余简要带过。
主线关系：严格使用 强（3-8字理由）、中（3-8字理由）、弱（3-8字理由）。强＝推动主角弧线；中＝补世界观、人物关系或伏笔；弱＝过渡或气氛。
信息密度：只能为 高、中、低。
预估集长：严格写整数X秒，不能写分钟；参考高密度且高情绪45-60秒，中等35-45秒，低25-35秒。需要结合实际情节，勿机械固定时长。
情绪强度：仅使用 冲突、恐怖、情感、转折、高潮、平铺、喜剧、悬疑、情感崩溃，多个用+连接，禁止数字与星级。

忠于原文，不推测、脑补或增写；对话密集章节重点关注对话带来的行动或结果，不要复述无意义对白。
完整正确示例：
| 第1章 职业危机与许愿 | 林逸 | 职业魔术师林逸因解密打假风潮导致事业崩塌，颓废中许愿，意外触发神奇魔法系统绑定 | 强（主角动机建立） | 高 | 50秒 | 转折+悬疑 |`;

const emotions = new Set(["冲突", "恐怖", "情感", "转折", "高潮", "平铺", "喜剧", "悬疑", "情感崩溃"]);
export class InvalidEventResultError extends Error {
  constructor(message, raw) { super(message); this.name = "InvalidEventResultError"; this.raw = raw; }
}
export function parseEventLine(input) {
  const raw = String(input ?? "");
  if (!raw.startsWith("|") || !raw.endsWith("|") || /[\r\n]/.test(raw))
    throw new InvalidEventResultError("模型输出不是以 | 开始和结束的单行文本", raw);
  const parts = raw.slice(1, -1).split("|").map(part => part.trim());
  if (parts.length !== 7 || parts.some(part => !part)) throw new InvalidEventResultError("事件分析必须恰好7个非空字段", raw);
  const [chapterTitle, characters, coreEvent, mainline, density, duration, mood] = parts;
  if (!/^第[零〇○一二两三四五六七八九十百千万亿\d]+[章节回卷]/u.test(chapterTitle) && chapterTitle !== "序章")
    throw new InvalidEventResultError("章节字段必须使用第X章/节/回或序章格式", raw);
  if ([...coreEvent].length < 30 || [...coreEvent].length > 60)
    throw new InvalidEventResultError("核心事件必须为30-60字，概括动作和结果", raw);
  if (!/^[强中弱]（[^（）]{3,20}）$/u.test(mainline)) throw new InvalidEventResultError("主线关系必须为 强/中/弱（理由）", raw);
  if (!["高", "中", "低"].includes(density)) throw new InvalidEventResultError("信息密度只能为高、中、低", raw);
  if (!/^[1-9]\d{0,2}秒$/u.test(duration)) throw new InvalidEventResultError("预估集长必须为整数X秒", raw);
  if (!mood.split("+").every(part => emotions.has(part))) throw new InvalidEventResultError("情绪强度包含不支持的标签", raw);
  return { chapterTitle, characters, coreEvent, mainline, density, duration, emotions: mood };
}

export function eventLine(fields) {
  return `| ${[fields.chapterTitle, fields.characters, fields.coreEvent, fields.mainline, fields.density, fields.duration, fields.emotions].join(" | ")} |`;
}

export function chapterFingerprint(chapter) {
  const source = String(chapter.title || "") + "\u0000" + String(chapter.content || "");
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return source.length + ":" + (hash >>> 0).toString(16);
}

export async function loadTextModels(fetchFn = fetch) {
  const response = await fetchFn("/api/ai/models", { headers: { "x-toonflow-workspace": "1" }, cache: "no-store" });
  if (!response.ok) throw new Error("文本模型列表请求失败（HTTP " + response.status + "）");
  const payload = await response.json();
  if (payload.code !== 200 || !Array.isArray(payload.data)) throw new Error(payload.message || "文本模型列表格式错误");
  return payload.data.filter(m => typeof m.providerId === "string" && m.providerId && typeof m.modelId === "string" && m.modelId)
    .map(m => ({ providerId: m.providerId, modelId: m.modelId, label: m.label || m.modelId, providerLabel: m.providerLabel || m.providerId,
      value: JSON.stringify([m.providerId, m.modelId]) }));
}

// 简单 SSE 解析器：支持 chunk 切断 data 行、CRLF、done/error，并校验最终 assistant 消息。
export async function readEventModelStream(response, signal) {
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error("文本分析请求失败 HTTP " + response.status + "：" + message.slice(0, 300));
  }
  if (!response.body || !/text\/event-stream/i.test(response.headers.get("content-type") || ""))
    throw new Error("模型未返回 ToonFlow 的 SSE 数据流");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", completed = null;
  const handle = block => {
    const lines = block.split("\n").filter(line => line.startsWith("data:"));
    if (!lines.length) return;
    const value = JSON.parse(lines.map(line => line.slice(5).trimStart()).join("\n"));
    if (value.type === "error") throw new Error(value.message || "模型返回错误");
    if (value.type !== "done") return;
    const msg = value.message;
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) throw new Error("模型结果缺少 assistant 正文");
    if (["error", "aborted", "length", "deferred", "pending"].includes(msg.stopReason))
      throw new Error(msg.errorMessage || "模型未完整输出，请重试");
    completed = msg.content.filter(x => x.type === "text").map(x => x.text || "").join("");
  };
  try {
    while (completed === null) {
      if (signal?.aborted) throw signal.reason || new DOMException("已取消", "AbortError");
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 4 * 1024 * 1024) throw new Error("模型事件流过长");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        handle(block);
        if (completed !== null) break;
      }
      if (done) break;
    }
    if (completed === null) throw new Error("AI 数据流提前结束，未返回完成标记");
    return completed;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function analyzeChapter(chapter, choice, { fetchFn = fetch, signal, prompt = eventPrompt } = {}) {
  if (!String(chapter.content || "").trim()) throw new Error("章节没有原文内容，无法分析");
  if (!choice?.providerId || !choice.modelId) throw new Error("请先选择文本模型");
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("提取规则正文不能为空");
  // 没有标准章节头的单章原文，合成可验证的显示章节名，不改用户原文件。
  const title = /^第[零〇○一二两三四五六七八九十百千万亿\d]+[章节回卷]/u.test(chapter.title) || chapter.title === "序章"
    ? chapter.title : `第${chapter.order || 1}章 ${chapter.title}`;
  const context = {
    systemPrompt: prompt,
    messages: [{ role: "user", timestamp: Date.now(), content:
      `请分析以下章节。章节字段严格填写「${title}」，只输出本章节的七字段单行表格。\n【章节原文开始】\n${chapter.content}\n【章节原文结束】` }]
  };
  // 只对格式违例自动重试一次，不对网络故障自动重试，避免可能的重复计费。
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) context.systemPrompt = prompt + "\n【格式纠正】前一次输出不符合7字段约束，这次务必严格按要求输出单行文本。";
    const response = await fetchFn("/api/ai/generate", {
      method: "POST", headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({ providerId: choice.providerId, modelId: choice.modelId, context }), signal
    });
    const raw = await readEventModelStream(response, signal);
    try {
      const structured = parseEventLine(raw);
      if (structured.chapterTitle.replace(/\s+/g, "") !== title.replace(/\s+/g, ""))
        throw new InvalidEventResultError("模型返回的章节名称与当前章节不一致", raw);
      return { raw, structured };
    }
    catch(e) { if (!(e instanceof InvalidEventResultError) || attempt) throw e; }
  }
}
