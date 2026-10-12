// 浏览器到 ToonFlow 2.0.4 MCP。永远通过公开工具调用，不写画布 JSON。
export class ToonflowMcp {
  constructor(endpoint, token) {
    this.endpoint = endpoint || "/mcp";
    this.token = token || "";
    this.session = "";
    this.requestId = 0;
  }
  async rpc(method, params = {}, notification = false) {
    const id = notification ? undefined : ++this.requestId;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25"
    };
    if (this.token) headers.Authorization = "Bearer " + this.token;
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const response = await fetch(this.endpoint, {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params })
    });
    if (!response.ok) throw new Error("MCP " + response.status + "：" + (await response.text()).slice(0, 350));
    this.session = response.headers.get("mcp-session-id") || this.session;
    if (notification || response.status === 202) return null;
    const type = response.headers.get("content-type") || "";
    let payload;
    if (type.includes("text/event-stream")) {
      const raw = await response.text();
      const events = raw.split(/\r?\n\r?\n/).flatMap(chunk => {
        const lines = chunk.split(/\r?\n/).filter(s => s.startsWith("data:"));
        if (!lines.length) return [];
        try { return [JSON.parse(lines.map(s => s.slice(5).trim()).join("\n"))]; }
        catch { return []; }
      });
      payload = events.find(e => e.id === id) || events.find(e => e.result || e.error);
      if (!payload) throw new Error("MCP SSE 未返回有效工具响应");
    } else payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    return payload.result;
  }
  async init() {
    await this.rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "toonflow-producer-studio", version: "0.1.0" }
    });
    await this.rpc("notifications/initialized", {}, true);
    const info = await this.rpc("tools/list", {});
    this.tools = new Set((info.tools || []).map(t => t.name));
    return this;
  }
  async tool(name, args = {}, target) {
    if (this.tools && !this.tools.has(name)) throw new Error("新版未提供工具：" + name);
    const input = { args, ...(target ? { target } : {}) };
    if (name === "getAppState") return this.unwrap(await this.rpc("tools/call", { name, arguments: {} }));
    return this.unwrap(await this.rpc("tools/call", { name, arguments: input }));
  }
  unwrap(result) {
    if (result?.isError) throw new Error(result.content?.map(c => c.text).join("\n") || "ToonFlow 工具执行失败");
    if (result?.structuredContent) return result.structuredContent;
    const content = result?.content?.find(c => c.type === "text")?.text;
    if (content) { try { return JSON.parse(content); } catch { return { text: content }; } }
    return result || {};
  }
}
export function pickId(result) {
  const obj = result || {};
  const id = [obj.nodeId, obj.node?.id, obj.addedNode?.id, obj.id, obj.data?.nodeId, obj.data?.node?.id,
    obj.result?.nodeId, obj.result?.node?.id, obj.result?.id].find(v => typeof v === "string" && v.length);
  if (!id) throw new Error("节点创建结果没有可识别的节点 ID：" + JSON.stringify(obj).slice(0, 300));
  return id;
}
// ToonFlow 2.x 在画布中注册的名称是 remote-textNode、remote-imageNode 等。
 // 不要将远程节点插件名 textNode 直接传给 addNode。
export function resolveAvailableNodeTypes(result) {
  const types = result.availableNodeTypes || result.nodeTypes || result.availableTypes || result.data?.availableNodeTypes || [];
  const resolved = new Map();
  for (const item of types) {
    const type = typeof item === "string" ? item : item?.type || item?.id;
    if (!type) continue;
    resolved.set(type, type);
    if (type.startsWith("remote-")) resolved.set(type.slice("remote-".length), type);
  }
  return resolved;
}
function nodePorts(result, nodeId) {
  const found = (result.nodes || result.data?.nodes || []).find(n => n.id === nodeId || n.nodeId === nodeId);
  return found?.ports || found?.handles || found?.data?.handles || [];
}
function compatible(a, b, source, target) {
  if (!a.length || !b.length) return false; // 不在未校验端口时猜测并连线
  const s = a.find(p => p.id === source && (p.type === "source" || p.direction === "source"));
  const t = b.find(p => p.id === target && (p.type === "target" || p.direction === "target"));
  if (!s || !t) return false;
  const x = [].concat(s.dataType || []), y = [].concat(t.dataType || []);
  return x.some(v => y.includes(v));
}
function extractNodeTools(result, nodeId) {
  const candidates = [result?.nodeTools, result?.node?.nodeTools, result?.addedNode?.nodeTools,
    result?.data?.nodeTools, result?.data?.node?.nodeTools];
  const tools = candidates.find(value => Array.isArray(value)) || [];
  return tools.filter(tool => !tool?.nodeId || tool.nodeId === nodeId);
}
function toolNames(tools) { return (tools || []).map(tool => tool?.name).filter(Boolean); }
function resolveNodeTool(tools, name) {
  const wanted = name.startsWith("node:") ? name : "node:" + name;
  return (tools || []).find(tool => tool?.name === wanted || tool?.name === name)?.name || wanted;
}
function hasNodeTool(tools, name) {
  const wanted = name.startsWith("node:") ? name : "node:" + name;
  return (tools || []).some(tool => tool?.name === wanted || tool?.name === name);
}
import { normalizeGeneration, parseModelValue } from "./generation.mjs";

export async function assemblePanels({ client, panels, assets, project, onProgress, onSaved, boardOnly = false }) {
  // 画布 v3 只有显式 include 才返回节点类型；旧版不接受 include，按需回退。
  let current;
  try { current = await client.tool("getCanvas", { include: ["nodeTypes"] }); }
  catch (error) {
    const legacy = await client.tool("getCanvas", {});
    if (!legacy.availableNodeTypes && !legacy.nodeTypes) throw error;
    current = legacy;
  }
  const canvasId = current.canvasId || current.activeCanvasId || current.id || current.canvas?.id;
  if (!canvasId) throw new Error("没有活动画布。请在新版中打开项目的无限画布再执行");
  const types = resolveAvailableNodeTypes(current);
  const generation = normalizeGeneration(project.generation);
  if (boardOnly) {
    const videoType = generation.video.mode === "rh" ? "runninghubWorkflowNode" : "videoGenerationNode";
    if (generation.video.mode === "rh" && !generation.video.rhAppUid) throw new Error("请先在项目设置中选择 RH 视频应用");
    if (!types.has(videoType)) throw new Error("当前画布未启用视频生成节点：" + videoType + "。请启用后重试");
    if (generation.video.mode === "rh" && !types.has("textNode")) throw new Error("RH 视频需要文本节点承载视频提示词，请启用 textNode 后重试");
    if (panels.some(panel => (panel.assetIds || []).length) && !types.has("imageNode")) throw new Error("当前画布未启用图片节点，无法放入分镜板参考资产");
    const target = { canvasId }, created = [];
    const getOrCreate = async (binding, key, type, label, position) => {
      const installedType = types.get(type);
      if (binding[key]) {
        let snapshot;
        try {
          snapshot = await client.tool("getCanvasNodes", {
            canvasId, nodeIds: [binding[key]], fields: ["type"]
          }, target);
        } catch (error) {
          // 稳定版 v3 对已删除的 ID 直接抛出“节点不存在”，不能把它误当成其他接口异常。
          if (!/节点不存在|node not found/i.test(error?.message || String(error))) throw error;
          snapshot = { nodes: [] };
        }
        const existing = (snapshot.nodes || []).find(node => node.id === binding[key] || node.nodeId === binding[key]);
        if (existing && existing.type !== installedType) {
          throw new Error("已绑定节点类型与当前生成方式不符：" + label + "，请检查项目设置");
        }
        if (existing) return { id: binding[key], tools: [] };
        onProgress?.("此前绑定的 " + label + " 已不在画布中，重新创建");
        delete binding[key];
        delete binding[key + "Tools"];
        onSaved?.();
      }
      const result = await client.tool("addNode", { type: installedType, position, label }, target);
      const id = pickId(result);
      binding[key] = id;
      // 先记录实际创建的 ID；后续写入失败时，重试也不会重复创建。
      onSaved?.();
      return { id, tools: extractNodeTools(result, id) };
    };
    const invoke = async (node, name, args = {}) => {
      const wanted = name.startsWith("node:") ? name : "node:" + name;
      let tools = node.tools || [];
      // ToonFlow 的节点工具在 Vue 组件 mounted 后注册，addNode 返回时可能尚未就绪。
      for (let attempt = 0; !hasNodeTool(tools, name); attempt++) {
        if (attempt >= 40) {
          throw new Error("节点 " + node.id + " 尚未注册 " + wanted + "；当前可用：" + (toolNames(tools).join("、") || "暂无"));
        }
        await new Promise(resolve => setTimeout(resolve, 125));
        // 一次取得当前节点全部已注册函数；后续还要判断 getConfig/setConfig，
        // 若仅查询 setPrompt，会误以为其他配置函数不存在。
        const found = await client.tool("getNodeTools", { nodeIds: [node.id] }, target);
        tools = (found.nodeTools || []).filter(tool => tool.nodeId === node.id);
      }
      node.tools = tools;
      return client.tool("nodeTools", { nodeId: node.id, name: resolveNodeTool(tools, name), args }, target);
    };
    const connect = async (sourceId, sourceHandle, targetId, targetHandle, key, binding) => {
      const snapshot = await client.tool("getCanvasEdges", { nodeIds: [sourceId, targetId] }, target);
      const exists = (snapshot.edges || []).some(edge =>
        edge.source === sourceId && edge.sourceHandle === sourceHandle &&
        edge.target === targetId && edge.targetHandle === targetHandle);
      if (exists) {
        if (!binding.connections.includes(key)) { binding.connections.push(key); onSaved?.(); }
        return;
      }
      const a = await client.tool("getCanvasNodes", { canvasId, nodeIds: [sourceId], fields: ["ports"] }, target);
      const b = await client.tool("getCanvasNodes", { canvasId, nodeIds: [targetId], fields: ["ports"] }, target);
      const sourcePorts = nodePorts(a, sourceId), targetPorts = nodePorts(b, targetId);
      if (!compatible(sourcePorts, targetPorts, sourceHandle, targetHandle)) throw new Error("节点端口未就绪或不兼容：" + sourceHandle + " → " + targetHandle);
      await client.tool("connectNodes", { connections: [{ source: sourceId, sourceHandle, target: targetId, targetHandle }] }, target);
      binding.connections.push(key); onSaved?.();
    };
    for (let index = 0; index < panels.length; index++) {
      const panel = panels[index], binding = panel.canvasBindings || {};
      if (binding.canvasId && binding.canvasId !== canvasId) throw new Error("分镜 " + panel.shot + " 已绑定其他画布");
      binding.canvasId = canvasId; binding.videoMode = generation.video.mode; binding.connections ||= []; binding.assetNodes ||= {};
      binding.completed = false;
      panel.canvasBindings = binding; onSaved?.();
      const y = 120 + index * 520;
      onProgress?.("分镜板 " + (panel.boardNo || panel.shot) + "：创建视频生成节点");
      const video = await getOrCreate(binding, "videoId", videoType, (panel.boardNo ? "分镜板 " + panel.boardNo : panel.shot) + (generation.video.mode === "rh" ? " · RH 视频工作流" : " · 视频生成"), { x: 800, y });
      const prompt = (project.directorManual ? project.directorManual + "\n" : "") + "画面比例：" + (project.aspectRatio || "16:9") + "。分镜板视频提示词：" + (panel.videoPrompt || panel.prompt || panel.excerpt || "");
      if (generation.video.mode === "rh") {
        await invoke(video, "selectRunningHubApplication", { uid: generation.video.rhAppUid });
        const promptNode = await getOrCreate(binding, "videoPromptId", "textNode", "分镜板提示词", { x: 420, y: y + 260 });
        await invoke(promptNode, "setText", { text: prompt });
        await connect(promptNode.id, "text", video.id, "in", "video-prompt", binding);
      } else {
        await invoke(video, "setPrompt", { prompt });
        const selected = generation.video.mode === "model" ? parseModelValue(generation.video.model) : null;
        const canReadConfig = hasNodeTool(video.tools, "getConfig");
        const canSetConfig = hasNodeTool(video.tools, "setConfig");
        const config = canReadConfig ? await invoke(video, "getConfig", {}) : null;
        const currentModel = config?.config?.providerId && config?.config?.modelId ? config.config : null;
        if (!selected && currentModel && config?.models && !config.models.some(model => model.providerId === currentModel.providerId && model.modelId === currentModel.modelId)) {
          throw new Error("视频节点默认模型在当前 ToonFlow 模型列表中不可用：" + currentModel.modelId);
        }
        if (selected) {
          if (!canReadConfig || !canSetConfig) throw new Error("视频节点未提供模型配置函数，无法验证默认模型：" + selected.modelId);
          if (config?.models && !config.models.some(model => model.providerId === selected.providerId && model.modelId === selected.modelId)) {
            throw new Error("视频模型在当前 ToonFlow 模型列表中不可用：" + selected.modelId);
          }
          await invoke(video, "setConfig", selected);
          const verified = await invoke(video, "getConfig", {});
          if (verified?.config?.providerId !== selected.providerId || verified?.config?.modelId !== selected.modelId) {
            throw new Error("视频节点未成功使用默认模型：" + selected.modelId);
          }
        }
      }
      const linked = (assets || []).filter(asset => (panel.assetIds || []).includes(asset.id));
      for (let assetIndex = 0; assetIndex < linked.length; assetIndex++) {
        const asset = linked[assetIndex], versionId = panel.assetVersions?.[asset.id];
        const version = (asset.images || []).find(image => image.id === versionId) || (asset.images || []).find(image => image.id === asset.defaultImageId) || (asset.imagePath ? { path: asset.imagePath, mimeType: asset.mimeType } : null);
        if (!version?.path) continue;
        const ref = await getOrCreate(binding.assetNodes, asset.id, "imageNode", "参考 · " + asset.name, { x: 120 + assetIndex * 300, y: y + 260 });
        await invoke(ref, "setImage", { path: version.path, mimeType: version.mimeType || asset.mimeType });
        await connect(ref.id, "image", video.id, "in", "asset-" + asset.id, binding);
      }
      const nodeIds = [binding.videoId, binding.videoPromptId, ...Object.values(binding.assetNodes)].filter(Boolean);
      for (const nodeId of nodeIds) {
        const verified = await client.tool("getCanvasNodes", { canvasId, nodeIds: [nodeId], fields: ["type"] }, target);
        if (!(verified.nodes || []).some(node => node.id === nodeId || node.nodeId === nodeId)) {
          throw new Error("画布节点创建后校验失败：" + nodeId + "，分镜板尚未完成装配");
        }
      }
      binding.completed = true;
      created.push({ shot: panel.shot, boardNo: panel.boardNo, ...binding }); onSaved?.();
    }
    if (created.length) {
      const nodeIds = [...new Set(created.flatMap(item =>
        [item.videoId, item.videoPromptId, ...Object.values(item.assetNodes || {})].filter(Boolean)))];
      try {
        await client.tool("fitCanvas", { nodeIds }, target);
      } catch (error) {
        onProgress?.("分镜板节点已创建，但自动定位视图失败：" + (error?.message || String(error)));
      }
    }
    onProgress?.("完成：" + created.length + " 个分镜板已放入画布");
    return { canvasId, imported: created.length, items: created };
  }
  const chosenModels = {
    text: parseModelValue(generation.text.model),
    image: generation.image.mode === "model" ? parseModelValue(generation.image.model) : null,
    video: generation.video.mode === "model" ? parseModelValue(generation.video.model) : null,
    audio: generation.audio.mode === "model" ? parseModelValue(generation.audio.model) : null
  };
  const imageType = generation.image.mode === "rh" ? "runninghubWorkflowNode" : "imageGenerationNode";
  const videoType = generation.video.mode === "rh" ? "runninghubWorkflowNode" : "videoGenerationNode";
  const audioType = generation.audio.mode === "rh" ? "runninghubWorkflowNode" : "audioGenerationNode";
  const required = ["textNode", imageType, videoType, ...(generation.audio.mode !== "off" ? [audioType] : [])];
  if (generation.image.mode === "rh" && !generation.image.rhAppUid) throw new Error("请先在项目设置中选择 RH 图片应用");
  if (generation.video.mode === "rh" && !generation.video.rhAppUid) throw new Error("请先在项目设置中选择 RH 视频应用");
  if (generation.audio.mode === "rh" && !generation.audio.rhAppUid) throw new Error("请先在项目设置中选择 RH 音频应用");
  if (generation.audio.mode === "model" && !types.has("audioGenerationNode")) {
    throw new Error("当前 ToonFlow 只有音频素材节点 audioNode，没有音频生成节点 audioGenerationNode。请在项目设置将音频改为 RH，或先安装兼容的音频生成节点。未修改画布。");
  }
  const missing = required.filter(type => !types.has(type));
  if (missing.length) {
    const found = [...new Set(types.values())];
    throw new Error("当前画布尚未加载所需节点：" + missing.join("、") +
      "；当前实际可用节点：" + (found.length ? found.join("、") : "无") +
      "。请在节点插件管理中启用对应节点并刷新画布。");
  }
  const target = {}; // 保持宿主当前画布上下文，canvasId 在每次业务参数中校验。
  const active = { canvasId };
  const created = [];
  const getOrCreate = async (binding, key, type, label, position) => {
    if (binding[key]) return binding[key];
    const installedType = types.get(type);
    if (!installedType) throw new Error("当前画布未加载节点：" + type);
    const n = await client.tool("addNode", { type: installedType, position, label }, target);
    binding[key] = pickId(n);
    onSaved?.();
    return binding[key];
  };
  const invoke = (nodeId, name, args) =>
    client.tool("nodeTools", { nodeId, name: "node:" + name, args }, target);
  const setChosenModel = async (nodeId, kind) => {
    const selected = chosenModels[kind];
    if (!selected) return;
    if (kind === "text") {
      const response = await client.tool("setTextNodeModel", { nodeId, ...selected }, target);
      const expected=JSON.stringify([selected.providerId,selected.modelId]);
      if (response?.model!==expected) throw new Error("文本节点默认模型校验失败：" + nodeId);
      return;
    }
    // 媒体生成节点需要提供 getConfig / setConfig；未获得真实确认不会假设模型写入成功。
    const before = await invoke(nodeId, "getConfig", {});
    if (!before?.models?.some(m=>m.providerId===selected.providerId && m.modelId===selected.modelId)) {
      throw new Error(({image:"图片",video:"视频",audio:"音频"})[kind]+"模型在当前 ToonFlow 模型列表中不可用："+selected.modelId);
    }
    await invoke(nodeId, "setConfig", selected);
    const after = await invoke(nodeId, "getConfig", {});
    if (after?.config?.providerId!==selected.providerId || after?.config?.modelId!==selected.modelId) {
      throw new Error(({image:"图片",video:"视频",audio:"音频"})[kind]+"节点未成功使用指定模型："+selected.modelId);
    }
  };
  const connect = async (sourceId, sourceHandle, targetId, targetHandle, key, binding) => {
    if (binding.connections.includes(key)) return;
    const a = await client.tool("getCanvasNodes", { canvasId, nodeIds: [sourceId], fields: ["ports"] }, target);
    const b = await client.tool("getCanvasNodes", { canvasId, nodeIds: [targetId], fields: ["ports"] }, target);
    if (!compatible(nodePorts(a, sourceId), nodePorts(b, targetId), sourceHandle, targetHandle)) {
      throw new Error("未找到兼容端口：" + sourceHandle + " → " + targetHandle);
    }
    await client.tool("connectNodes", { connections: [{
      source: sourceId, sourceHandle, target: targetId, targetHandle
    }] }, target);
    binding.connections.push(key); onSaved?.();
  };
  const baseX = 100, rowSpacing = 680;
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const old = panel.canvasBindings;
    if (old?.canvasId && old.canvasId !== canvasId) {
      throw new Error("分镜 " + panel.shot + " 已绑定其他画布，不能重复导入到当前画布");
    }
    // 原节点可能已由模型节点生成；不能因为项目设置变更而把旧 ID 当成 RH 节点来调用。
    if (old?.imageId && (old.imageMode || "model") !== generation.image.mode) {
      throw new Error("分镜 " + panel.shot + " 已绑定图片生成节点，生成方式已变化；请先确认是否需要重新装配该分镜");
    }
    if (old?.videoId && (old.videoMode || "model") !== generation.video.mode) {
      throw new Error("分镜 " + panel.shot + " 已绑定视频生成节点，生成方式已变化；请先确认是否需要重新装配该分镜");
    }
    if (old?.audioId && (old.audioMode || "off") !== generation.audio.mode) {
      throw new Error("分镜 " + panel.shot + " 已绑定音频生成节点，生成方式已变化；请先确认是否需要重新装配该分镜");
    }
    if (old?.audioId && generation.audio.mode === "off") {
      throw new Error("分镜 " + panel.shot + " 已关联音频节点；关闭音频不会删除已有节点，请先确认并处理旧绑定");
    }
    const binding = old || { canvasId, connections: [], assetNodes: {} };
    binding.assetNodes ||= {};
    binding.imageMode = generation.image.mode;
    binding.videoMode = generation.video.mode;
    binding.audioMode = generation.audio.mode;
    binding.connections ||= [];
    panel.canvasBindings = binding;
    onSaved?.();
    const y = 120 + i * rowSpacing;
    onProgress?.("分镜 " + panel.shot + "：创建提示词与生成节点");
    const textId = await getOrCreate(binding, "textId", "textNode", panel.shot + " · 分镜脚本", { x: baseX, y });
    const imagePrompt = (project.visualManual ? project.visualManual + "\n" : "") +
      "画面比例：" + project.aspectRatio + "。分镜：" + panel.prompt;
    const videoPrompt = (project.directorManual ? project.directorManual + "\n" : "") +
      "画面比例：" + project.aspectRatio + "。内容：" + (panel.videoPrompt || panel.prompt);
    await invoke(textId, "setText", { text: generation.image.mode === "rh" ? imagePrompt : panel.excerpt });
    await setChosenModel(textId, "text");
    const imgId = await getOrCreate(binding, "imageId", imageType, panel.shot +
      (generation.image.mode === "rh" ? " · RH 首帧" : " · 首帧"), { x: baseX + 480, y });
    if (generation.image.mode === "rh") {
      await invoke(imgId, "selectRunningHubApplication", { uid: generation.image.rhAppUid });
    } else {
      await invoke(imgId, "setPrompt", { prompt: imagePrompt });
      await setChosenModel(imgId, "image");
    }
    const vidId = await getOrCreate(binding, "videoId", videoType, panel.shot +
      (generation.video.mode === "rh" ? " · RH 视频" : " · 视频"), { x: baseX + 960, y });
    if (generation.video.mode === "rh") {
      await invoke(vidId, "selectRunningHubApplication", { uid: generation.video.rhAppUid });
      const videoPromptId = await getOrCreate(binding, "videoPromptId", "textNode",
        panel.shot + " · 视频提示词", { x: baseX + 560, y: y + 300 });
      await invoke(videoPromptId, "setText", { text: videoPrompt });
      await setChosenModel(videoPromptId, "text");
      await connect(videoPromptId, "text", vidId, "in", "video-prompt", binding);
    } else {
      await invoke(vidId, "setPrompt", { prompt: videoPrompt });
      await setChosenModel(vidId, "video");
    }
    await connect(textId, "text", imgId, "in", "text-img", binding);
    await connect(imgId, "image", vidId, "in", "img-video", binding);
    if (generation.audio.mode !== "off") {
      onProgress?.("分镜 " + panel.shot + "：装配音频工作流");
      const audioPromptId = await getOrCreate(binding, "audioPromptId", "textNode",
        panel.shot + " · 音频文案", { x: baseX + 560, y: y + 540 });
      await invoke(audioPromptId, "setText", { text: "根据以下分镜生成对白、旁白或环境音；保留原台词语义，不增加无关内容：\n" + panel.excerpt });
      await setChosenModel(audioPromptId, "text");
      const audioId = await getOrCreate(binding, "audioId", audioType, panel.shot +
        (generation.audio.mode === "rh" ? " · RH 音频" : " · 音频"), { x: baseX + 960, y: y + 540 });
      if (generation.audio.mode === "rh") {
        await invoke(audioId, "selectRunningHubApplication", { uid: generation.audio.rhAppUid });
      } else {
        await invoke(audioId, "setPrompt", { prompt: panel.excerpt });
        await setChosenModel(audioId, "audio");
      }
      await connect(audioPromptId, "text", audioId, "in", "audio-prompt", binding);
      await connect(audioId, "audio", vidId, "in", "audio-video", binding);
    }
    const linked = assets.filter(a => panel.assetIds.includes(a.id) && a.imagePath && a.kind !== "场景" ? true :
      panel.assetIds.includes(a.id) && a.imagePath);
    if (linked.length && !types.has("imageNode")) throw new Error("当前画布未启用图片节点 imageNode，无法放入参考图。请启用节点插件后重试");
    for (let j = 0; j < linked.length; j++) {
      const asset = linked[j];
      const versionId = panel.assetVersions?.[asset.id];
      const version = (asset.images || []).find(image => image.id === versionId) ||
        (asset.images || []).find(image => image.id === asset.defaultImageId) ||
        (asset.imagePath ? { path: asset.imagePath, mimeType: asset.mimeType } : null);
      if (!version?.path) continue;
      onProgress?.("分镜 " + panel.shot + "：关联素材 " + asset.name);
      const refId = await getOrCreate(binding.assetNodes, asset.id, "imageNode", "参考 · " + asset.name, { x: baseX - 380, y: y + j * 210 });
      await invoke(refId, "setImage", { path: version.path, mimeType: version.mimeType || asset.mimeType });
      await connect(refId, "image", imgId, "in", "asset-" + asset.id, binding);
    }
    created.push({ shot: panel.shot, ...binding });
    onSaved?.();
  }
  onProgress?.("完成：" + created.length + " 个分镜已装配到画布；未自动触发媒体生成");
  return { canvasId, imported: created.length, items: created };
}
