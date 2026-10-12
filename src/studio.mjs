import { parseModelValue } from "./generation.mjs";
// 纯数据层：不依赖 ToonFlow 内部状态，所有转换均可单独测试。
export function uid(prefix = "id") {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + "-" + id;
}

export const visualPresets = [
  { name: "现代都市真人影视", text: "现代都市真人影视风格，人物真实自然，脸型、服装、发型有明显差异；角色保持一致性；场景图不出现人物，道具图保持干净背景。" },
  { name: "古装写实影视", text: "古装真人影视，真实织物、古建和自然光；人物面容、服饰及道具前后一致，避免现代元素。" },
  { name: "自定义", text: "" }
];
export const directorPresets = [
  { name: "快节奏短剧导演", text: "以人物动机和情绪转折推动镜头；抓取开场钩子、反转和悬念，镜头语言清晰，优先使用短镜头。" },
  { name: "电影叙事导演", text: "遵守场面调度与轴线逻辑，动作连续，景别变化服务叙事；保留关键台词和表演空间。" },
  { name: "自定义", text: "" }
];

export function emptyStudio() {
  return { schemaVersion: 1, project: null, novelName: "", chapters: [], events: [],
    scripts: [], assets: [], panels: [], videoScripts: [], storyboards: [], storyboardBoards: [], taskQueues: {}, history: [], updatedAt: "" };
}
export function createProject(input) {
  if (!String(input.name || "").trim()) throw new Error("请填写项目名称");
  return { id: uid("project"), name: String(input.name).trim(), aspectRatio: input.aspectRatio || "9:16",
    visualManual: input.visualManual || "", directorManual: input.directorManual || "",
    visualPreset: input.visualPreset || "自定义", directorPreset: input.directorPreset || "自定义",
    createdAt: new Date().toISOString() };
}
const chapterPattern = /^\s*(第[零〇○一二两三四五六七八九十百千万亿0-9]+[章节回卷][^\n]{0,55})\s*$/u;
export function splitNovel(input, filename = "导入小说") {
  const text = String(input || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("小说内容为空");
  const lines = text.split("\n");
  const blocks = [];
  let name = "", body = [], preface = [];
  const push = () => {
    const current = body.join("\n").trim();
    if (current) blocks.push({ id: uid("chapter"), order: blocks.length + 1, title: name || "正文", content: current });
  };
  for (const line of lines) {
    const candidate = line.match(chapterPattern);
    if (candidate && line.trim().length <= 60) {
      if (!name && !blocks.length && body.length) preface = body;
      else push();
      name = candidate[1].trim();
      body = [];
    } else body.push(line);
  }
  if (name) push();
  else if (body.join("").trim()) blocks.push({ id: uid("chapter"), order: 1, title: filename.replace(/\.[^.]+$/, ""), content: body.join("\n").trim() });
  if (preface.join("").trim()) blocks.unshift({ id: uid("chapter"), order: 0, title: "序章", content: preface.join("\n").trim() });
  blocks.forEach((x, i) => { x.order = i + 1; });
  return blocks;
}
export function eventCandidates(chapter) {
  const sentences = (chapter.content.match(/[^。！？!?\n；;]+[。！？!?；;]?/gu) || [])
    .map(s => s.trim()).filter(s => s.length >= 8);
  const verbs = /发现|决定|遇见|得知|质问|冲突|争执|离开|进入|出发|抵达|失去|得到|揭露|反转|拒绝|答应|威胁|请求|交给|拿出|看见|听见|说|问|跑|走|打|救|买|卖|吃|哭|笑|死|逃|回忆/;
  const picked = sentences.filter(s => verbs.test(s));
  const sources = (picked.length ? picked : sentences).slice(0, 18);
  return sources.map((source, i) => ({
    id: uid("event"), chapterId: chapter.id, order: i + 1,
    summary: source.slice(0, 180), evidence: source.slice(0, 300),
    participants: [...source.matchAll(/([\u4e00-\u9fff]{2,5})[：:](?=[“"「]?)/gu)].map(x => x[1]).slice(0, 5)
  }));
}
export function adaptScript(chapter, events, episodeNumber = 1) {
  // 简易改编仍以章节原文为底稿，避免事件候选过滤掉原著台词。
  const raw = [chapter.content];
  const lines = [];
  for (const str of raw) {
    const parts = String(str).split("\n").map(x => x.trim()).filter(Boolean);
    for (const part of parts) {
      const match = part.match(/^([\u4e00-\u9fff]{2,6})[：:]\s*(.+)$/u);
      lines.push(match ? match[1] + "：" + match[2] : "△ " + part);
    }
  }
  const heading = String(episodeNumber) + "-1 未确定场景 日 内";
  return {
    id: uid("script"), chapterId: chapter.id, title: "第" + episodeNumber + "集 · " + chapter.title,
    episode: episodeNumber, status: "草稿",
    scenes: [{ id: uid("scene"), heading, location: "未确定场景", time: "日", interior: "内", body: lines.join("\n") }],
    text: heading + "\n" + lines.join("\n"), sourceEventIds: events.map(x => x.id)
  };
}
const props = ["手机", "钥匙", "电脑", "书", "合同", "信封", "文件", "银行卡", "钱包", "眼镜", "戒指", "项链", "桌子", "椅子", "汽车", "手表", "餐盘", "饭盒", "刀", "剑", "酒杯", "照片", "背包", "箱子"];
export function extractAssets(scripts, current = []) {
  const names = new Map(current.map(a => [a.kind + ":" + a.name, a]));
  const add = (kind, name) => {
    const n = name.trim(); if (!n || n.length > 40) return;
    const key = kind + ":" + n;
    if (!names.has(key)) names.set(key, { id: uid("asset"), kind, name: n, description: "", imagePath: "", mimeType: "", status: "待完善" });
  };
  for (const script of scripts) {
    add("场景", script.scenes?.[0]?.location || "未确定场景");
    for (const scene of script.scenes || []) add("场景", scene.location || "未确定场景");
    for (const m of script.text.matchAll(/(?:^|\n)([\u4e00-\u9fff]{2,5})[：:]/gu)) {
      if (!["旁白", "动作", "时间", "地点"].includes(m[1])) add("角色", m[1]);
    }
    for (const prop of props) if (script.text.includes(prop)) add("道具", prop);
  }
  return [...names.values()];
}
export function buildPanels(scripts, assets, existing = [], assetMentions = []) {
  const retained = existing.filter(p => !scripts.some(s => s.id === p.scriptId));
  const panels = [...retained];
  for (const script of scripts) {
    const sequences = script.scenes?.length ? script.scenes : [{ id: uid("scene"), location: "未确定场景", body: script.text }];
    let seq = 0;
    for (const scene of sequences) {
      const lines = scene.body.split("\n").map(v => v.trim()).filter(Boolean);
      const groups = [];
      let current = "";
      for (const line of lines) {
        if (current && current.length + line.length > 145) { groups.push(current); current = ""; }
        current += (current ? "\n" : "") + line;
      }
      if (current) groups.push(current);
      for (const excerpt of groups.slice(0, 100)) {
        seq++;
        const matched = assets.filter(a => {
          const roleTitle = a.kind==='角色' && /^(大师兄|二师兄|师兄|师姐|师父|掌门|宗主|长老|少主|师尊|公子|小姐)$/u.test(a.name);
          const duplicateName = assets.some(other=>other.id!==a.id && other.kind===a.kind && other.name===a.name);
          // 身份含糊的称呼或同名人物，只按本集已确认的归属匹配，不跨剧本匹配所有同名资产。
          const canonical = a.name!=='未确定场景' && excerpt.includes(a.name) &&
            (!(roleTitle||duplicateName) || a.scriptIds?.includes(script.id));
          const mention = assetMentions.some(m=>m.scriptId===script.id && m.assetId===a.id &&
            [m.mentionedAs,...(m.aliases||[])].some(alias=>alias && excerpt.includes(alias)));
          return canonical || (a.kind==='场景' && a.name===scene.location) || mention;
        });
        const shot = seq === 1 ? "全景" : (seq % 3 === 0 ? "特写" : "中景");
        panels.push({
          id: uid("panel"), scriptId: script.id, episode: script.episode,
          shot: script.episode + "-" + String(seq).padStart(2, "0"),
          shotType: shot, location: scene.location || "未确定场景", excerpt,
          prompt: shot + "，" + (scene.location || "剧情场景") + "，" + excerpt.replace(/^△\s*/gm, "").slice(0, 250),
          assetIds: matched.map(a => a.id), selected: true, canvasBindings: null
        });
      }
    }
  }
  return panels;
}

export function parseScriptScenes(text, episode = 1) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const re = /^(\d+-\d+)\s+(.+?)\s+(日|夜)\s+(内|外)\s*$/u;
  const scenes = [];
  let scene = null, body = [];
  const flush = () => {
    if (scene) { scene.body = body.join("\n").trim(); scenes.push(scene); }
  };
  for (const line of lines) {
    const match = line.trim().match(re);
    if (match) {
      flush();
      scene = { id: uid("scene"), heading: line.trim(), location: match[2], time: match[3], interior: match[4], body: "" };
      body = [];
    } else {
      if (!scene) {
        scene = { id: uid("scene"), heading: String(episode) + "-1 未确定场景 日 内",
          location: "未确定场景", time: "日", interior: "内", body: "" };
      }
      body.push(line);
    }
  }
  flush();
  return scenes;
}

// 专业分镜表数据层：分镜表 -> 分镜板 -> 视频提示词
export function buildStoryboard(script, assets = [], existing = []) {
  const old = existing.filter(x => x.scriptId === script.id);
  if (old.length) return old;
  const scenes = script.scenes?.length ? script.scenes : parseScriptScenes(script.text, script.episode);
  const rows = [];
  let index = 1;
  for (const scene of scenes) {
    const blocks = scene.body.split(/\n+/).map(x => x.trim()).filter(Boolean);
    for (const block of blocks.slice(0, 80)) {
      rows.push({
        id: uid("storyboard"), scriptId: script.id, episode: script.episode,
        index, shotNo: `${script.episode}-${String(index).padStart(2, "02")}`,
        duration: 3, shotSize: index % 3 === 0 ? "特写" : "中景",
        camera: "固定镜头", action: block,
        imageGenerated: false, videoMode: "minimaxH3",
        referenceMode: "全能参考模式", status: "待制作",
        assetIds: assets.filter(a => block.includes(a.name)).map(a => a.id),
        videoPrompt: ""
      });
      index++;
    }
  }
  return rows;
}

export function createStoryboardBoard(rows) {
  const selected = rows.filter(x => x.selected).sort((a, b) => (a.index || 0) - (b.index || 0));
  if (!selected.length) return null;
  const videoMode = selected[0].videoMode || "minimaxH3";
  const referenceMode = selected[0].referenceMode || "全能参考模式";
  if (selected.some(x => (x.videoMode || "minimaxH3") !== videoMode)) throw new Error("同一个分镜板的镜头必须使用同一视频模型");
  if (selected.some(x => (x.referenceMode || "全能参考模式") !== referenceMode)) throw new Error("同一个分镜板的镜头必须使用同一参考模式");
  const assets = [...new Set(selected.flatMap(x => x.assetIds || []))];
  return {
    id: uid("board"), sourceIds: selected.map(x => x.id), scriptId: selected[0].scriptId, episode: selected[0].episode,
    shotNo: selected.map(x => x.shotNo).join("、"),
    shots: selected.map(x => ({ ...x })), duration: selected.reduce((sum, x) => sum + Math.max(0, Number(x.duration) || 0), 0),
    videoMode, referenceMode,
    imageMode: selected[0].imageMode || "不生成", imageModel: selected[0].imageModel || "",
    status: "待生成视频提示词", assets, assetIds: assets, videoPrompt: "", promptModel: ""
  };
}

export const STORYBOARD_SYSTEM_PROMPT = `你是专业影视分镜师。根据一集完整短剧剧本和资产清单，输出严格 JSON，不要 Markdown、解释或代码围栏。
格式：{"shots":[{"shotNo":"1-01","duration":3,"shotSize":"中景","camera":"固定镜头","movement":"缓慢推近","composition":"人物位于画面右侧，保留视线空间","action":"可拍摄的动作与表演","dialogue":"本镜头台词，没有则空字符串","lighting":"光线与色彩","sound":"对白、环境声或音乐","transition":"硬切","assetNames":["资产名"]}]}
规则：镜头按剧本顺序连续编号；每个镜头时长为整数1-12秒；一句关键台词不得和另一句关键台词挤在同一镜头；动作必须可拍摄，不能写抽象心理；assetNames 只能使用提供的资产名称；覆盖场景建立、人物动作、反应、关键道具和转场。`;

function stripJsonFence(raw) {
  return String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export function storyboardRequest(script, assets = [], project = {}, videoScript = "") {
  if (!script?.text?.trim()) throw new Error("剧本正文为空，无法制作分镜表");
  if (videoScript !== undefined && videoScript !== null && typeof videoScript !== 'string') throw new Error('视频脚本格式无效');
  const assetText = assets.map(a => `${a.kind}｜${a.name}｜${a.description || ""}`).join("\n") || "（暂无资产，按剧本设计镜头）";
  return `项目画幅：${project.aspectRatio || "9:16"}\n第${script.episode}集：${script.title || ""}\n【导演手册：镜头叙事规范】\n${project.directorManual || '（未设置）'}\n【视觉手册：统一影像审美】\n${project.visualManual || '（未设置）'}\n【原始剧本（用于核对台词及人物）】\n${script.text}\n${videoScript.trim() ? `【已确认的视频脚本（分镜表必须以此为主依据）】\n${videoScript}\n` : ''}【资产清单】\n${assetText}\n【结束】\n请只输出符合协议的 JSON。`;
}

export function parseStoryboardRows(raw, script, assets = []) {
  let value;
  try { value = JSON.parse(stripJsonFence(raw)); } catch { throw new Error("分镜表模型未返回合法 JSON"); }
  if (!value || !Array.isArray(value.shots) || !value.shots.length) throw new Error("分镜表必须包含 shots 数组");
  if (value.shots.length > 200) throw new Error("单集分镜超过200个镜头，请缩短剧本或拆分制作");
  const byName = new Map(assets.map(a => [a.name, a.id]));
  return value.shots.map((shot, i) => {
    const duration = Number(shot.duration);
    if (!Number.isInteger(duration) || duration < 1 || duration > 12) throw new Error(`镜头${i + 1}时长必须是1-12秒整数`);
    const names = Array.isArray(shot.assetNames) ? shot.assetNames : [];
    return {
      id: uid("storyboard"), scriptId: script.id, episode: script.episode, index: i + 1,
      shotNo: String(shot.shotNo || `${script.episode}-${String(i + 1).padStart(2, "0")}`), duration,
      shotSize: String(shot.shotSize || "中景"), camera: String(shot.camera || "固定镜头"), movement: String(shot.movement || "静止"),
      composition: String(shot.composition || "自然构图"), lighting: String(shot.lighting || "按场景自然光"),
      sound: String(shot.sound || "现场环境声"), transition: String(shot.transition || "硬切"), action: String(shot.action || "").trim(),
      dialogue: String(shot.dialogue || "").trim(), imageGenerated: false, imageModel: "", imageMode: "不生成",
      videoMode: "minimaxH3", referenceMode: "全能参考模式", status: "待制作",
      assetIds: [...new Set(names.map(name => byName.get(String(name).trim())).filter(Boolean))], videoPrompt: ""
    };
  });
}

export async function generateStoryboard({ script, assets = [], project = {}, model, videoScript = '', fetchFn = fetch, signal }) {
  if (!model?.providerId || !model.modelId) throw new Error("请先在项目设置中选择文本模型");
  const response = await fetchFn("/api/ai/generate", {
    method: "POST", signal, headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ providerId: model.providerId, modelId: model.modelId, context: {
      systemPrompt: STORYBOARD_SYSTEM_PROMPT, messages: [{ role: "user", timestamp: Date.now(), content: storyboardRequest(script, assets, project, videoScript) }]
    } })
  });
  const stream = await import("./eventAnalysis.mjs");
  return parseStoryboardRows(await stream.readEventModelStream(response, signal), script, assets);
}
// 根据分镜板信息生成给多模态模型的结构化输入。
// 实际模型调用由宿主模型服务完成，这里负责保持分镜资产链路。
export function buildVideoPromptRequest(board, assets = [], project = {}) {
  const refs = (board.assets || board.assetIds || [])
    .map(id => assets.find(a => a.id === id))
    .filter(Boolean)
    .map(a => {
      const versionId = board.assetVersions?.[a.id];
      const version = (a.images || []).find(image => image.id === versionId) ||
        (a.images || []).find(image => image.id === a.defaultImageId);
      return { kind: a.kind, name: a.name, imagePath: version?.path || a.imagePath || "" };
    });
  return {
    model: board.videoMode || "minimaxH3",
    referenceMode: board.referenceMode || "全能参考模式",
    duration: board.duration || 3,
    shot: board.shotNo,
    scene: board.excerpt || board.shots?.map(x => x.action).join("\\n") || "",
    shots: board.shots || [],
    references: refs,
    system: project.directorManual || "",
    outputRequirement: "根据视频模型规范输出可直接复制的完整视频生成提示词；包含主体、动作、镜头、时长、运镜、光线、连续性约束和负面约束，不输出解释。"
  };
}


export function promptModelRequest(board, assets = [], project = {}) {
  const request = buildVideoPromptRequest(board, assets, project);
  return `你是视频生成提示词工程师。根据下面 JSON 生成一段可直接复制的视频提示词。模型：${request.model}；参考模式：${request.referenceMode}；总时长：${request.duration}秒。必须严格遵守模型的时长和参考图规范，保持角色妆造、场景、道具连续。只输出提示词正文，不要 Markdown、标题或解释。\n${JSON.stringify(request, null, 2)}`;
}
export async function generateStoryboardImage({ row, project = {}, modelValue = "", files, fetchFn = fetch, signal }) {
  const selected = parseModelValue(modelValue || project.generation?.image?.model || "");
  if (!selected) throw new Error("请先在项目设置中选择图片模型");
  if (!row?.action?.trim()) throw new Error("镜头缺少动作描述，无法生成分镜图");
  const directory = (await files.list()).directory;
  const outputDirectory = `assets/storyboards/${String(project.id || "project").replace(/[^\w-]/g, "")}`;
  const response = await fetchFn("/api/ai/media/generate", {
    method: "POST", signal, headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ directory, outputDirectory, mediaType: "image", providerId: selected.providerId, modelId: selected.modelId,
      prompt: `${row.shotSize || "中景"}，${row.camera || "固定镜头"}，${row.movement || "静止"}。${row.action}。${row.composition || "自然构图"}，${row.lighting || "自然光"}。保持参考资产角色、场景、道具一致。`, ratio: project.aspectRatio || "9:16" })
  });
  if (!response.ok) throw new Error("分镜图生成失败 HTTP " + response.status + "：" + (await response.text()).slice(0, 240));
  const data = await response.json();
  const image = data.code === 200 && Array.isArray(data.data) ? data.data.find(item => item?.mediaType === "image" && item.path) : null;
  if (!image) throw new Error(data.message || "分镜图生成未返回有效文件");
  return { path: image.path, mimeType: image.mimeType || "image/png" };
}
export async function generateVideoPrompt({ board, assets = [], project = {}, model, fetchFn = fetch, signal }) {
  if (!model?.providerId || !model.modelId) throw new Error("请先在项目设置中选择文本模型");
  const response = await fetchFn("/api/ai/generate", {
    method: "POST", signal, headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ providerId: model.providerId, modelId: model.modelId, context: {
      systemPrompt: "你是多模态视频提示词工程师。只输出可直接复制的视频提示词正文，不输出标题、解释或 Markdown。必须保留镜头段落顺序、总时长和参考资产连续性。",
      messages: [{ role: "user", timestamp: Date.now(), content: promptModelRequest(board, assets, project), attachments: buildVideoPromptRequest(board, assets, project).references.filter(item => item.imagePath).map(item => ({ kind: item.kind, name: item.name, path: item.imagePath })) }]
    } })
  });
  const stream = await import("./eventAnalysis.mjs");
  const text = String(await stream.readEventModelStream(response, signal) || "").trim();
  if (!text) throw new Error("模型没有返回视频提示词");
  return text;
}
export function updateStoryboardBoardStatus(rows, status) {
  return rows.map(row => ({ ...row, status }));
}

export function parseStudio(text) {
  if (!String(text || "").trim()) return emptyStudio();
  const value = JSON.parse(text);
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.chapters)) throw new Error("制片项目文件结构不兼容");
  return { ...emptyStudio(), ...value };
}
