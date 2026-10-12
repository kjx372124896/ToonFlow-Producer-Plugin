// 文本固定为原生文本节点；媒体使用模型或 RH。音频为可选工作流，旧项目默认关闭。
export function defaultGeneration() {
  return {
    text: { mode: "model", model: "" },
    image: { mode: "model", model: "", rhAppUid: "" },
    video: { mode: "model", model: "", rhAppUid: "" },
    audio: { mode: "off", model: "", rhAppUid: "" }
  };
}
// 可选模型值与 ToonFlow 原生节点 data.model 保持一致，即 JSON.stringify([providerId, modelId])
export function modelValue(providerId, modelId) {
  return JSON.stringify([providerId, modelId]);
}
export function parseModelValue(value) {
  if (!value) return null;
  try {
    const parts = JSON.parse(value);
    if (Array.isArray(parts) && parts.length === 2 && parts.every(x => typeof x === "string" && x.length > 0))
      return { providerId: parts[0], modelId: parts[1] };
  } catch {}
  throw new Error("所选默认模型配置无效，请重新选择模型");
}
export function normalizeGeneration(value) {
  const g = defaultGeneration();
  // 文本始终走模型节点，旧项目中的 RH 文本设置自动归一化
  g.text.model = String(value?.text?.model ?? "");
  for (const kind of ["image", "video", "audio"]) {
    const mode = value?.[kind]?.mode;
    g[kind] = {
      mode: kind === "audio" && mode !== "rh" && mode !== "model" ? "off" : mode === "rh" ? "rh" : "model",
      model: String(value?.[kind]?.model ?? ""),
      rhAppUid: String(value?.[kind]?.rhAppUid ?? "")
    };
  }
  return g;
}
export async function loadAvailableModels(fetchFn = fetch) {
  async function read(url) {
    const response = await fetchFn(url, { cache: "no-store", headers: { "x-toonflow-workspace": "1" } });
    if (!response.ok) throw new Error("模型列表请求失败：" + response.status);
    const payload = await response.json();
    if (payload.code !== 200 || !Array.isArray(payload.data))
      throw new Error(payload.message || "模型列表数据格式不正确");
    return payload.data;
  }
  const [text, media] = await Promise.all([read("/api/ai/models"), read("/api/ai/media/models")]);
  const normalized = (models, kind) => models
    .filter(m => m && typeof m.providerId === "string" && typeof m.modelId === "string" && m.providerId && m.modelId)
    .map(m => ({
      value: modelValue(m.providerId, m.modelId),
      providerId: m.providerId, modelId: m.modelId,
      label: m.label || m.modelId,
      providerLabel: m.providerLabel || m.providerId,
      kind
    }));
  return {
    text: normalized(text, "text"),
    image: normalized(media.filter(m => m.type === "image"), "image"),
    video: normalized(media.filter(m => m.type === "video"), "video"),
    audio: normalized(media.filter(m => m.type === "audio"), "audio")
  };
}
export function validateSelectedModels(value, available) {
  const cfg=normalizeGeneration(value);
  const selected={
    text: cfg.text.model,
    image: cfg.image.mode==="model" ? cfg.image.model : "",
    video: cfg.video.mode==="model" ? cfg.video.model : "",
    audio: cfg.audio.mode==="model" ? cfg.audio.model : ""
  };
  const names={text:"文本",image:"图片",video:"视频",audio:"音频"};
  for(const kind of Object.keys(names)) {
    if(!selected[kind]) continue;
    parseModelValue(selected[kind]);
    if(!available?.[kind]?.some(m=>m.value===selected[kind]))
      throw new Error(names[kind]+"默认模型已不可用，请在项目设置中重新选择");
  }
}
export async function loadRhApps(fetchFn=fetch) {
  const response=await fetchFn("/api/settings/get",{headers:{"x-toonflow-workspace":"1"},cache:"no-store"});
  if(!response.ok) throw new Error("无法读取 ToonFlow 设置："+response.status);
  const payload=await response.json();
  if(payload.code!==200)throw new Error(payload.message||"ToonFlow 设置接口失败");
  const settings=payload.data||{};
  const apps=settings.mediaProviderConfigs?.runninghub?.workflowApps||[];
  return (Array.isArray(apps)?apps:[]).filter(a=>a?.uid&&a?.webappId).map(a=>({
    uid:a.uid,name:a.name||a.webappId,webappId:a.webappId
  }));
}
