<template>
  <div class="producer" @wheel.stop>
    <header class="top">
      <div><strong>🎬 ToonFlow 制片中心</strong><small>制片插件 v0.9 · {{ context.resource.label }}</small></div>
      <div class="topRight"><span v-if="studio.project">{{ studio.project.name }} · {{ studio.project.aspectRatio }}</span>
        <span class="saveState">{{ saveState }}</span><button @click="save">保存项目</button></div>
    </header>
    <div v-if="error" class="alert">{{ error }} <button @click="error=''">关闭</button></div>
    <div class="layout">
      <nav class="side">
        <button v-for="item in menu" :key="item.key" :class="{ current: tab===item.key }"
          :disabled="!studio.project && item.key!=='project'" @click="tab=item.key">
          <span>{{ item.icon }}</span>{{ item.title }}<small>{{ item.count }}</small>
        </button>
        <div class="sideTip">每个项目独立保存在画布工作区的本地文件夹中。</div>
      </nav>
      <main class="body">
        <section v-if="tab==='project'" class="section project-section"><ProjectSettings :studio="studio" :context="context" @save="save" /></section>
        <section v-if="tab==='novel'" class="section novel-section"><NovelManager :key="context.resource.path" :studio="studio" :context="context" @save="save" @chaptersChanged="syncSelection" /></section>
        <section v-if="tab==='scripts'" class="section scripts-section"><ScriptManager :key="context.resource.path" :studio="studio" :context="context" @save="save" @scriptsChanged="syncSelection" @extractAssets="extractFromScripts" /></section>
        <section v-if="tab==='assets'" class="section assets-section"><AssetLibrary :key="context.resource.path" :studio="studio" :context="context" :request="assetRequest" @save="save" /></section>
        <section v-if="tab==='storyboard'" class="section storyboard-section">
          <StoryboardWorkbench :studio="studio" :rows="storyboardRows" :selectedScript="selectedScript"
            :model-value="storyboardModelValue" :busy="storyboardBusy"
            @update:modelValue="storyboardModelValue=$event" @update:selectedScript="selectedScript=$event"
            @rowsChanged="replaceStoryboardRows" @save="save"
            @makeBoards="makeStoryboardBoards" @shotImage="generateStoryboardShotImage" />
        </section>
        <section v-if="tab==='boards'" class="section boards-section">
          <div v-if="storyboardNotice" class="alertInfo" role="status">{{ storyboardNotice }}</div>
          <div class="heading"><div><h2>分镜面板</h2><p>按剧本查看分镜板预览；打开详情后再编辑提示词、镜头表和资产版本。</p></div><button class="primary" :disabled="!selectedBoardPanels.length || busy" @click="pushSelectedBoardsToCanvas()">{{ busy ? '处理中…' : '放入已勾选分镜板（' + selectedBoardPanels.length + '） →' }}</button></div>
          <div class="card board-toolbar"><label>按第 N 集剧本筛选<select v-model="boardEpisode"><option value="">全部剧本</option><option v-for="s in studio.scripts" :key="s.id" :value="String(s.episode)">第{{ s.episode }}集 · {{ s.title }}</option></select></label><div class="actions"><button @click="selectVisiblePanels(true)">全选当前集</button><button @click="selectVisiblePanels(false)">清空当前集</button><button class="primary" :disabled="!selectedBoardPanels.length || storyboardBusy" @click="batchGeneratePrompts">批量生成视频提示词（{{ selectedBoardPanels.length }}）</button><button class="danger" :disabled="!selectedBoardPanels.length" @click="deleteSelectedBoards">删除选中分镜板（{{ selectedBoardPanels.length }}）</button></div><strong>{{ filteredPanels.length }} 个分镜板 · 已勾选 {{ selectedBoardPanels.length }} 个</strong></div>
          <div v-if="filteredPanels.length" class="board-preview-grid"><article class="board-preview-card" v-for="panel in filteredPanels" :key="panel.id"><header><label><input v-model="panel.selected" type="checkbox" @change="save" /> <strong>{{ boardLabel(panel) }}</strong></label><span :class="panel.canvasBindings?.completed ? 'success' : 'muted'">{{ panel.canvasBindings?.completed ? '已关联画布' : (panel.canvasBindings?.videoId ? '装配未完成' : (panel.status === '已放入画布' ? '待确认' : (panel.status || '待确认'))) }}</span></header><div class="board-preview-meta"><span>第{{ panelEpisode(panel) }}集</span><span>{{ panel.duration || 0 }}秒</span><span>{{ panel.videoModel || panel.videoMode || 'minimaxH3' }}</span><span>{{ panel.referenceMode || '全能参考模式' }}</span></div><div class="shot-strip"><span v-for="shot in panel.shots || []" :key="shot.id">{{ shot.shotNo }} · {{ shot.duration }}秒</span></div><div class="preview-images"><img v-for="shot in (panel.shots || []).filter(shot => shot.imagePath).slice(0,4)" :key="shot.id" :src="imageUrl(shot.imagePath, shot.imageMimeType)" :alt="shot.shotNo"><span v-if="!(panel.shots || []).some(shot => shot.imagePath)" class="preview-placeholder">暂无分镜图</span></div><p class="preview-prompt">{{ panel.videoPrompt || '尚未生成视频提示词' }}</p><div class="board-card-actions"><button class="open-board" @click="openBoardDetail(panel)">查看完整分镜板 ↗</button><button class="canvas-action" :disabled="busy" @click="pushBoardToCanvas(panel)">放入画布</button></div></article><div v-if="!filteredPanels.length" class="card empty">当前筛选下没有分镜板。</div></div><div v-else class="card empty">还没有已制作分镜板。请先在分镜表选择镜头并点击“制作分镜板”。</div>
        </section>
        <div v-if="boardDetail" class="board-overlay" @wheel.stop @pointerdown.stop><div class="board-dialog"><header class="dialog-head"><div><h2>{{ boardLabel(boardDetail) }}</h2><p>第{{ panelEpisode(boardDetail) }}集 · {{ boardDetail.duration || 0 }}秒 · {{ boardDetail.videoMode || 'minimaxH3' }} · {{ boardDetail.referenceMode || '全能参考模式' }}</p></div><button @click="boardDetail=null">关闭 ×</button></header><div class="dialog-body"><div v-if="storyboardNotice" class="alertInfo" role="status">{{ storyboardNotice }}</div><section class="dialog-block"><h3>资产参考</h3><div class="board-assets detail-assets"><button v-for="asset in panelAssets(boardDetail)" :key="asset.id" class="asset-choice" @click="openBoardAssetPicker(boardDetail,asset)"><img v-if="panelAssetImage(asset,boardDetail)" :src="imageUrl(panelAssetImage(asset,boardDetail), asset.mimeType)" :alt="asset.name"><span v-else class="asset-empty">暂无图片</span><strong>{{ asset.kind }} · {{ asset.name }}</strong><small>点击更换图片 / 生成版本</small></button><p v-if="!panelAssets(boardDetail).length" class="muted">暂无资产，可回到分镜表或资产库补选。</p></div></section><section class="dialog-block"><h3>视频提示词 <small>可直接编辑</small></h3><textarea v-model="boardDetail.videoPrompt" rows="10" @change="save" placeholder="尚未生成视频提示词"></textarea></section><section class="dialog-block"><h3>完整分镜表</h3><div class="shot-detail" v-for="shot in boardDetail.shots || []" :key="shot.id"><header><strong>{{ shot.shotNo }}</strong><span>{{ shot.duration }}秒 · {{ shot.shotSize }} · {{ shot.camera }} · {{ shot.movement }}</span></header><p><b>动作：</b>{{ shot.action || '—' }}</p><p><b>台词：</b>{{ shot.dialogue || '—' }}</p><p><b>构图：</b>{{ shot.composition || '—' }}　<b>光线：</b>{{ shot.lighting || '—' }}</p><p><b>声音：</b>{{ shot.sound || '—' }}　<b>转场：</b>{{ shot.transition || '—' }}</p><img v-if="shot.imagePath" :src="imageUrl(shot.imagePath, shot.imageMimeType)" :alt="shot.shotNo" class="shot-detail-image"></div></section><div class="dialog-actions"><button @click="boardDetail=null">返回分镜板列表</button><button class="primary" :disabled="busy" @click="pushBoardToCanvas(boardDetail)">放入画布 →</button></div></div></div></div>
        <div v-if="assetPicker" class="asset-picker-overlay" @wheel.stop @pointerdown.stop><div class="asset-picker-dialog"><header class="dialog-head"><div><h2>替换分镜板资产图片</h2><p>{{ assetPicker.asset.kind }} · {{ assetPicker.asset.name }}</p></div><button @click="closeBoardAssetPicker">关闭 ×</button></header><AssetLibrary mode="picker" :studio="studio" :context="context" :request="assetPickerRequest" @save="save" @imageSelected="handleBoardAssetImage" /></div></div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { emptyStudio, createProject,
  buildPanels, buildStoryboard, createStoryboardBoard, buildVideoPromptRequest, generateStoryboard, generateStoryboardImage, generateVideoPrompt, parseStudio, parseScriptScenes, uid, visualPresets, directorPresets } from "./studio.mjs";
import { assemblePanels } from "./mcp.mjs";
import { createLocalCanvasClient } from "./localCanvas.mjs";
import { parseModelValue } from "./generation.mjs";
import { loadTextModels } from "./eventAnalysis.mjs";
import ProjectSettings from "./ProjectSettings.vue";
import NovelManager from "./NovelManager.vue";
import ScriptManager from "./ScriptManager.vue";
import AssetLibrary from "./AssetLibrary.vue";
import StoryboardWorkbench from "./StoryboardWorkbench.vue";

const props = defineProps({ context: { type: Object, required: true } });
const menu = [
  { key: "project", title: "项目设置", icon: "◫" },
  { key: "novel", title: "小说 / 事件分析", icon: "▤" },
  { key: "scripts", title: "剧本管理", icon: "✎" },
  { key: "assets", title: "资产库", icon: "▧" },
  { key: "storyboard", title: "分镜表", icon: "☷" },
  { key: "boards", title: "分镜面板", icon: "▦" },
];
const ratios = ["9:16", "16:9", "1:1", "4:3", "3:4", "2:3", "3:2", "21:9"];
const studio = ref(emptyStudio());
const tab = ref("project");
const error = ref("");
const saveState = ref("未修改");
const draft = reactive({ name: "", aspectRatio: "9:16", visualPreset: visualPresets[0].name,
  directorPreset: directorPresets[0].name, visualManual: visualPresets[0].text,
  directorManual: directorPresets[0].text });
const selectedScript = ref("");
const checkedScripts = ref([]);
const storyboardRows = ref([]);
const textModels = ref([]);
const storyboardModelValue = ref("");
const storyboardBusy = ref(false);
const storyboardNotice = ref("");
const assetRequest = ref(null);
const boardEpisode = ref("");
const boardDetail = ref(null);
const assetPicker = ref(null);
const assetPickerRequest = ref(null);
const busy = ref(false);
const connectionLog = ref("");
let lastSerialized = "";
watch([() => props.context.text, () => props.context.loading], ([text, loading]) => {
  if (loading || (text || "") === lastSerialized) return;
  try {
    const parsed = parseStudio(text);
    studio.value = parsed;
    if(parsed.taskQueues?.text?.some(job=>["queued","running","retrying"].includes(job.status)))tab.value="novel";
    selectedScript.value = parsed.scripts[0]?.id || "";
    storyboardRows.value = Array.isArray(parsed.storyboards) ? parsed.storyboards : [];
    storyboardModelValue.value = parsed.project?.generation?.text?.model || "";
    checkedScripts.value = parsed.scripts.map(x => x.id);
    lastSerialized = text || "";
    error.value = "";
  } catch (e) { error.value = "项目文件无法解析：" + e.message; }
}, { immediate: true });
const panelEpisode = panel => panel?.episode || panel?.shots?.[0]?.episode || studio.value.scripts.find(s => s.id === panel?.scriptId)?.episode || "未知";
function boardLabel(panel) { return panel?.boardNo ? `第${panelEpisode(panel)}集 · 分镜板${panel.boardNo}` : `分镜板 ${panel?.shot || "未命名"}`; }
const storyboardPanels = computed(() => {
  const boardIds = new Set((studio.value.storyboardBoards || []).map(board => board.id));
  return studio.value.panels.filter(panel => panel.panelType === "storyboard-board" || boardIds.has(panel.id) || (Array.isArray(panel.sourceIds) && panel.sourceIds.length));
});
const filteredPanels = computed(() => storyboardPanels.value.filter(panel => !boardEpisode.value || String(panelEpisode(panel)) === String(boardEpisode.value)));
const selectedPanels = computed(() => storyboardPanels.value.filter(p => p.selected));
const selectedBoardPanels = computed(() => filteredPanels.value.filter(p => p.selected));
const currentStoryboardRows = computed(() => storyboardRows.value.filter(row => row.scriptId === selectedScript.value));
const selectedStoryboardRows = computed(() => currentStoryboardRows.value.filter(row => row.selected));
const storyboardTotalDuration = computed(() => selectedStoryboardRows.value.reduce((sum, row) => sum + Math.max(0, Number(row.duration) || 0), 0));
function assetName(id) { return studio.value.assets.find(asset => asset.id === id)?.name || "未知资产"; }
function panelAssets(panel) { return studio.value.assets.filter(asset => panel?.assetIds?.includes(asset.id)); }
function panelAssetImage(asset, panel) { const imageId = panel?.assetVersions?.[asset.id] || asset.defaultImageId; return asset.images?.find(image => image.id === imageId)?.path || asset.imagePath || ""; }
const previewUrls = ref({});
const previewHandles = new Map();
function imageUrl(path) { return path ? (previewUrls.value[path] || path) : ""; }
async function loadPreview(path, mimeType = "image/png") {
  if (!path || previewHandles.has(path)) return;
  try {
    const shared = props.context.files.acquireUrl?.(path, mimeType);
    const url = shared ? await shared.url : URL.createObjectURL(new Blob([await props.context.files.read(path)], { type: mimeType }));
    previewHandles.set(path, { release: () => shared ? shared.release() : URL.revokeObjectURL(url) });
    previewUrls.value = { ...previewUrls.value, [path]: url };
  } catch (e) {
    // 工作区文件暂不可读时保留路径，让 UI 显示占位，不阻断其他分镜板。
  }
}
watch(() => studio.value.assets.flatMap(asset => (asset.images || []).map(image => `${image.path}|${image.mimeType || "image/png"}`)).join("|"), () => {
  studio.value.assets.forEach(asset => (asset.images || []).forEach(image => void loadPreview(image.path, image.mimeType)));
}, { immediate: true });
watch(() => studio.value.panels.flatMap(panel => (panel.shots || []).map(shot => `${shot.imagePath}|${shot.imageMimeType || "image/png"}`)).join("|"), () => {
  studio.value.panels.forEach(panel => (panel.shots || []).forEach(shot => void loadPreview(shot.imagePath, shot.imageMimeType)));
}, { immediate: true });
onBeforeUnmount(() => { for (const handle of previewHandles.values()) handle.release(); previewHandles.clear(); });
function openBoardDetail(panel) { boardDetail.value = panel; }
function selectVisiblePanels(flag) { filteredPanels.value.forEach(panel => { panel.selected = flag; }); save(); }
async function batchGeneratePrompts() {
  if (!selectedBoardPanels.value.length || storyboardBusy.value) return;
  storyboardBusy.value = true; storyboardNotice.value = `正在批量生成 ${selectedBoardPanels.value.length} 个分镜板的视频提示词…`;
  try {
    const model = selectedTextModel();
    for (const panel of selectedBoardPanels.value) {
      panel.videoPrompt = await generateVideoPrompt({ board: panel, assets: studio.value.assets, project: studio.value.project || {}, model });
      panel.prompt = panel.videoPrompt; panel.status = "已制作分镜面板";
      await Promise.resolve(save());
    }
    storyboardNotice.value = `已完成 ${selectedBoardPanels.value.length} 个分镜板的视频提示词。`;
  } catch (e) { storyboardNotice.value = e.message; }
  finally { storyboardBusy.value = false; }
}
function deleteSelectedBoards() {
  const targets = selectedBoardPanels.value;
  if (!targets.length || !confirm(`确定删除选中的 ${targets.length} 个分镜板？对应分镜表镜头仍会保留。`)) return;
  const ids = new Set(targets.map(panel => panel.id)), sourceIds = new Set(targets.flatMap(panel => panel.sourceIds || []));
  studio.value.panels = studio.value.panels.filter(panel => !ids.has(panel.id));
  studio.value.storyboardBoards = (studio.value.storyboardBoards || []).filter(board => !ids.has(board.id) && !(board.sourceIds || []).some(id => sourceIds.has(id)));
  if (boardDetail.value && ids.has(boardDetail.value.id)) boardDetail.value = null;
  save();
}
function openBoardAssetPicker(panel, asset) { assetPicker.value = { panel, asset }; assetPickerRequest.value = { id: Date.now() + "-" + Math.random(), openAssetId: asset.id }; }
function closeBoardAssetPicker() { assetPicker.value = null; assetPickerRequest.value = null; }
function handleBoardAssetImage({ assetId, imageId }) { if (!assetPicker.value) return; setPanelAssetVersion(assetPicker.value.panel, assetId, imageId); closeBoardAssetPicker(); }
function syncSelection(){selectedScript.value=studio.value.scripts[0]?.id || "";checkedScripts.value=studio.value.scripts.map(x=>x.id);}
async function loadStoryboardModel() {
  try { textModels.value = await loadTextModels(); storyboardNotice.value = textModels.value.length ? `已读取 ${textModels.value.length} 个文本模型` : "当前没有可用文本模型"; }
  catch (e) { storyboardNotice.value = "读取文本模型失败：" + e.message; }
}
function selectedTextModel() {
  const value = storyboardModelValue.value || studio.value.project?.generation?.text?.model || "";
  return parseModelValue(value);
}
async function makeStoryboard() {
  const script = studio.value.scripts.find(x => x.id === selectedScript.value);
  if (!script) return;
  const videoScript = (studio.value.videoScripts || []).find(s => s.scriptId === script.id)?.text?.trim();
  if (!videoScript) { storyboardNotice.value = "请先在第一页制作并保存本集视频脚本"; return; }
  storyboardBusy.value = true; storyboardNotice.value = "正在根据视频脚本生成专业分镜表…";
  try {
    if (!textModels.value.length) await loadStoryboardModel();
    const rows = await generateStoryboard({ script, videoScript, assets: studio.value.assets, project: studio.value.project || {}, model: selectedTextModel() });
    rows.forEach(row => { row.selected = true; });
    replaceStoryboardRows([...storyboardRows.value.filter(r => r.scriptId !== script.id), ...rows]);
    storyboardNotice.value = `已生成本集 ${rows.length} 个镜头，可直接编辑表格字段。`;
  } catch (e) { storyboardNotice.value = e.message; }
  finally { storyboardBusy.value = false; }
}
function replaceStoryboardRows(rows) {
  storyboardRows.value = rows;
  studio.value.storyboards = rows;
  save();
}
function selectAllStoryboard() { currentStoryboardRows.value.forEach(x => x.selected = true); save(); }
function clearStoryboardSelection() { currentStoryboardRows.value.forEach(x => x.selected = false); save(); }
async function makeStoryboardBoards() {
  const board = createStoryboardBoard(selectedStoryboardRows.value);
  if (!board) return;
  storyboardBusy.value = true; storyboardNotice.value = "正在提交当前镜头和资产参考给多模态文本模型…";
  try {
    const model = selectedTextModel();
    const replacedBoard = (studio.value.storyboardBoards || []).find(item => (item.sourceIds || []).some(id => board.sourceIds.includes(id)));
    const episodeBoards = (studio.value.storyboardBoards || []).filter(item => String(item.episode) === String(board.episode) && item !== replacedBoard);
    board.boardNo = replacedBoard?.boardNo || Math.max(0, ...episodeBoards.map(item => Number(item.boardNo) || 0)) + 1;
    board.promptModel = storyboardModelValue.value || studio.value.project?.generation?.text?.model || "";
    board.videoPrompt = await generateVideoPrompt({ board, assets: studio.value.assets, project: studio.value.project || {}, model });
    board.status = "已制作分镜面板";
    storyboardRows.value.filter(row => board.sourceIds.includes(row.id)).forEach(row => { row.status = "已制作分镜面板"; });
    const panel = { ...board, panelType: "storyboard-board", shot: board.shotNo, excerpt: board.shots.map(shot => shot.action).join("\n"), prompt: board.videoPrompt, selected: true, assetIds: board.assets, assetVersions: {} };
    studio.value.storyboardBoards = [...(studio.value.storyboardBoards || []).filter(x => !x.sourceIds?.some(id => board.sourceIds.includes(id))), board];
    studio.value.panels = [...(studio.value.panels || []).filter(x => !x.sourceIds?.some(id => board.sourceIds.includes(id))), panel];
    storyboardNotice.value = `已制作分镜板：${board.shotNo}，总时长 ${board.duration} 秒。`;
    save(); tab.value = "boards";
  } catch (e) { storyboardNotice.value = e.message; }
  finally { storyboardBusy.value = false; }
}
async function generateStoryboardShotImage(row) {
  storyboardBusy.value = true; storyboardNotice.value = `正在生成 ${row.shotNo} 分镜图…`;
  try { const media = await generateStoryboardImage({ row, project: studio.value.project || {}, modelValue: row.imageModel, files: props.context.files }); row.imagePath = media.path; row.imageMimeType = media.mimeType; row.imageGenerated = true; storyboardNotice.value = `${row.shotNo} 分镜图已生成，可继续编辑或制作分镜板。`; save(); }
  catch (e) { storyboardNotice.value = e.message; }
  finally { storyboardBusy.value = false; }
}
function setPanelAssetVersion(panel, assetId, imageId) {
  panel.assetVersions ||= {};
  if (imageId) panel.assetVersions[assetId] = imageId; else delete panel.assetVersions[assetId];
  save();
}
function extractFromScripts(scriptIds){assetRequest.value={id:Date.now()+'-'+Math.random(),scriptIds};tab.value='assets';}
function save() {
  try {
    studio.value.updatedAt = new Date().toISOString();
    const current = JSON.stringify(studio.value, null, 2);
    lastSerialized = current;
    props.context.updateText(current);
    saveState.value = "已提交保存";
    error.value = "";
  } catch (e) { error.value = e.message; saveState.value = "保存失败"; }
}
function setManual(kind) {
  const visual = kind === "visual", arr = visual ? visualPresets : directorPresets;
  const key = visual ? draft.visualPreset : draft.directorPreset;
  if (visual) draft.visualManual = arr.find(x => x.name === key)?.text || "";
  else draft.directorManual = arr.find(x => x.name === key)?.text || "";
}
async function readManual(event, kind) {
  const file = event.target.files?.[0]; event.target.value = "";
  if (!file) return;
  try { const text = await file.text(); if (kind === "visual") { draft.visualManual = text; draft.visualPreset = "自定义"; }
    else { draft.directorManual = text; draft.directorPreset = "自定义"; } }
  catch (e) { error.value = "手册读取失败：" + e.message; }
}
function newProject() {
  try {
    studio.value.project = createProject(draft);
    save(); tab.value = "novel";
  } catch (e) { error.value = e.message; }
}
async function createNewDocument() {
  try {
    const folder = props.context.resource.path.split("/").slice(0, -1).join("/");
    const newPath = (folder ? folder + "/" : "") + "新项目-" + Date.now() + ".tfprod";
    await props.context.files.write(newPath, JSON.stringify(emptyStudio(), null, 2), true);
    await props.context.openFile(newPath);
  } catch (e) { error.value = "新建项目文件失败：" + e.message; }
}
function generateBoards() {
  if (!checkedScripts.value.length) return;
  const subset = studio.value.scripts.filter(s => checkedScripts.value.includes(s.id));
  if (studio.value.panels.some(p => subset.some(s => s.id === p.scriptId) && p.canvasBindings)
    && !confirm("选中的剧本已有导入画布的分镜，重建会清除这些绑定记录。确定继续？")) return;
  for (const s of subset) s.scenes = parseScriptScenes(s.text, s.episode);
  studio.value.panels = buildPanels(subset, studio.value.assets, studio.value.panels,studio.value.assetMentions||[]);
  save();
}
function togglePanelAsset(panel, assetId) {
  const idx = panel.assetIds.indexOf(assetId);
  if (idx >= 0) panel.assetIds.splice(idx, 1); else panel.assetIds.push(assetId);
  save();
}
function selectAllPanels(flag) { storyboardPanels.value.forEach(p => p.selected = flag); save(); }
function note(msg) {
  connectionLog.value = (connectionLog.value + "\n" + msg).trim();
  storyboardNotice.value = msg;
}
async function pushSelectedBoardsToCanvas(panels = selectedBoardPanels.value) {
  if (!studio.value.project || !panels.length || busy.value) return;
  busy.value = true; storyboardBusy.value = true; connectionLog.value = "";
  storyboardNotice.value = "正在校验当前画布并装配分镜板…";
  try {
    save();
    await props.context.flushSave();
    const client = createLocalCanvasClient(props.context.canvasProvider, { setTextNodeModel: props.context.setTextNodeModel });
    const result = await assemblePanels({
      client, panels, assets: studio.value.assets, project: studio.value.project, boardOnly: true,
      onProgress: note, onSaved: save
    });
    panels.forEach(panel => { panel.status = "已放入画布"; });
    save(); await props.context.flushSave();
    storyboardNotice.value = "完成：已将 " + result.imported + " 个完整分镜板放入画布。";
  } catch (e) {
    save();
    note("操作中止：" + e.message + "；已成功创建的节点绑定会保留，重新操作可继续。");
  } finally {
    busy.value = false; storyboardBusy.value = false;
  }
}
function pushBoardToCanvas(panel) {
  if (!panel) return;
  return pushSelectedBoardsToCanvas([panel]);
}

</script>

<style scoped>
.producer{width:100%;height:100%;min-width:620px;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;background:#f6f8fb;color:#25334a;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif}
.producer *{box-sizing:border-box}.top{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dbe3ed;padding:14px 22px;gap:20px;background:#fff}
.top strong{font-size:19px;letter-spacing:.3px}.top small{display:block;font-size:11px;color:var(--el-text-color-secondary,#9197a4);margin-top:3px}.topRight{display:flex;align-items:center;gap:12px}.topRight span{font-size:12px}
.saveState,.hint,.muted{color:var(--el-text-color-secondary,#999)}.layout{display:flex;flex:1;min-height:0}
.side{width:180px;flex-shrink:0;border-right:1px solid #dbe3ed;padding:18px 10px;display:flex;flex-direction:column;gap:5px;background:#eef3f8}
.side button{width:100%;display:flex;align-items:center;gap:10px;text-align:left;border:0;background:transparent;padding:11px 12px;border-radius:9px;color:inherit;cursor:pointer;font-size:13px}
.side button:hover,.side button.current{background:var(--el-color-primary-light-9,#27354a)}.side button.current{color:var(--el-color-primary,#66aaff);font-weight:600}.side button:disabled{opacity:.45;cursor:not-allowed}
.side button span{font-size:16px;min-width:16px}.sideTip{font-size:11px;line-height:1.7;color:var(--el-text-color-secondary,#888);margin-top:auto;padding:12px}
.body{flex:1;min-width:0;overflow:auto;background:#f6f8fb}.section{padding:22px 28px 44px;max-width:1300px;margin:auto}
.section.novel-section{max-width:none;padding:16px 22px 26px;min-height:100%;}
.section.scripts-section{max-width:none;padding:18px 22px 28px;min-height:100%}
.section.assets-section{max-width:none;padding:18px 22px 28px;min-height:100%}
.heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:20px}.heading h2{font-size:22px;margin:0 0 3px}.heading p{font-size:12px;margin:0;color:var(--el-text-color-secondary,#999)}
.card{background:#fff;border:1px solid #d7e0eb;border-radius:12px;padding:20px;margin-bottom:14px}
.card h3{font-size:15px;margin:0 0 14px}.formGrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.producer label:not(.inlineFile){display:flex;flex-direction:column;gap:7px;font-size:12px}
.producer label{margin-bottom:12px}.producer input:not([type="checkbox"]):not([type="file"]),.producer select,.producer textarea{width:100%;border:1px solid var(--el-border-color,#3b404c);background:#ffffff;color:inherit;border-radius:7px;padding:9px 11px;font:inherit;outline:none}
.producer textarea{resize:vertical;min-height:65px}.producer input:focus,.producer textarea:focus,.producer select:focus{border-color:var(--el-color-primary,#6aaaff)}
.producer button{cursor:pointer;border:1px solid var(--el-border-color,#3c4553);background:#ffffff;color:#2b4058;border-radius:7px;padding:8px 13px;font-size:12px;white-space:nowrap}
.producer button:hover{filter:brightness(1.12)}.producer button.primary{background:#347cdc;color:white;border-color:#347cdc}.producer button.danger{color:#d77f7f}.producer button:disabled{opacity:.5;cursor:not-allowed}
.actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 14px}.actions label{margin:0!important}
.inlineFile{display:inline-flex!important;align-items:center;justify-content:center;background:#2d3540;padding:8px 12px;border:1px solid #455161;border-radius:8px;cursor:pointer;font-size:12px;margin:0 10px 10px 0}
.inlineFile input{display:none}.hint{font-size:11px;line-height:1.7}.metrics{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.metrics span{padding:8px 13px;background:var(--el-fill-color,#242b35);border-radius:6px;font-size:12px}
.split{display:flex;gap:15px;min-height:360px}.chapters{width:220px;max-height:570px;overflow:auto;flex-shrink:0;border-right:1px solid var(--el-border-color,#30343e);padding-right:12px}
.chapters button{width:100%;text-align:left;margin-bottom:5px;white-space:normal}.chapters button.current{border-color:#347cdc;color:#6fb1ff}.preview{min-width:0;flex:1}.preview textarea{width:100%;height:480px;line-height:1.8}
.record,.boardRow{padding:15px 0;border-top:1px solid var(--el-border-color,#313741)}.recordTitle{font-weight:600;font-size:13px}.quote{border-left:2px solid #637185;padding:4px 12px;color:var(--el-text-color-secondary,#a5abb7);font-size:12px;white-space:pre-wrap}
.scriptText{line-height:1.8;font-family:"Microsoft YaHei",sans-serif;font-size:13px}
.assetRow{display:grid;grid-template-columns:90px 135px minmax(180px,1fr) 180px 58px;gap:12px;align-items:end;border-bottom:1px solid var(--el-border-color,#30343e);padding:10px 0}
.assetRow label{margin:0!important}.assetUpload small{font-size:10px;word-break:break-all;color:#9da9bb}
.checks{display:flex;flex-wrap:wrap;gap:12px}.checks label{display:flex!important;flex-direction:row!important;align-items:center;gap:6px;margin:0!important;font-size:12px}.checks.compact{padding-top:9px}.checks input{accent-color:#347cdc}
.boardHead{display:flex;align-items:center;gap:20px}.boardHead label{margin:0!important;display:flex!important;flex-direction:row!important;align-items:center;gap:8px}.boardHead span{font-size:12px}.success{color:#40bc83}.alert{margin:12px 20px 0;background:#552b26;color:#ffd2cc;padding:10px 12px;border-radius:7px;display:flex;justify-content:space-between}.alertInfo{padding:12px 16px;border:1px solid #365781;background:#223447;color:#c5dfff;border-radius:8px;font-size:12px}
.console{background:#080d14;color:#93d19c;padding:18px;white-space:pre-wrap;overflow:auto;min-height:140px;border-radius:8px;font-size:12px}.empty{padding:48px;text-align:center;color:var(--el-text-color-secondary,#888)}
.storyboard-toolbar{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:end}.storyboard-toolbar .hint{grid-column:1/-1;margin:0}.storyboard-table-wrap{overflow:auto}.storyboard-table{width:100%;min-width:1180px;border-collapse:collapse;font-size:12px}.storyboard-table th{position:sticky;top:0;background:#e8eef5;color:#30445b;text-align:left;padding:10px 8px;white-space:nowrap}.storyboard-table td{vertical-align:top;border-top:1px solid #dbe4ee;padding:8px;min-width:90px}.storyboard-table tr.chosen{background:#eef6ff}.storyboard-table input,.storyboard-table select,.storyboard-table textarea{margin-bottom:5px;padding:6px 7px;font-size:12px}.storyboard-table textarea{min-width:180px}.storyboard-table .tiny{width:58px}.storyboard-table small,.boardRow small{display:block;color:#8e98aa;font-size:10px}.asset-pills{display:flex;flex-wrap:wrap;gap:4px}.asset-pills span{padding:3px 6px;border-radius:10px;background:#29394e;color:#b9d6ff}.asset-pills small{min-width:120px}.shot-strip{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}.shot-strip span{padding:5px 8px;border-radius:6px;background:#e8f0f8;color:#35506d;font-size:11px}.shot-images{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 12px}.shot-images figure{margin:0;width:140px;border:1px solid #364352;border-radius:7px;overflow:hidden;background:#151c27}.shot-images img{display:block;width:100%;height:90px;object-fit:contain}.shot-images figcaption{padding:5px;font-size:10px;color:#aebbd0}.board-assets{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}.board-assets figure{width:112px;margin:0;border:1px solid #364352;border-radius:7px;overflow:hidden;background:#151c27}.board-assets img{display:block;width:100%;height:82px;object-fit:contain}.board-assets figcaption{padding:5px;font-size:10px;color:#aebbd0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.version-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin-top:12px}.version-grid label{margin:0!important}.version-grid select{margin-top:5px}.storyboard-section .heading{align-items:flex-start}@media(max-width:900px){.formGrid{grid-template-columns:1fr}.assetRow{grid-template-columns:1fr 1fr}.side{width:145px}.section{padding:18px}}
.board-toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.board-toolbar>label{min-width:240px;margin:0!important}.board-toolbar .actions{margin:0}.board-toolbar>strong{margin-left:auto;font-size:12px;color:#6c7e93}.board-preview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px}.board-preview-card{background:#fff;border:1px solid #d7e0eb;border-radius:12px;padding:15px;min-width:0}.board-preview-card>header{display:flex;justify-content:space-between;align-items:center;gap:8px}.board-preview-card>header label{display:flex!important;flex-direction:row!important;align-items:center;gap:7px;margin:0!important;min-width:0}.board-preview-card>header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.board-preview-meta{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0;color:#62758b;font-size:11px}.board-preview-meta span{background:#e8f0f8;color:#35506d;border-radius:5px;padding:4px 6px}.preview-images{display:flex;gap:6px;height:82px;overflow:hidden;background:#edf3f8;border-radius:7px;align-items:center}.preview-images img{width:25%;height:82px;object-fit:cover}.preview-placeholder{width:100%;text-align:center;color:#7f8fa4;font-size:11px}.preview-prompt{height:57px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;color:#62758b;font-size:12px;line-height:1.55;margin:11px 0}.board-card-actions{display:flex;gap:8px}.board-card-actions>button{flex:1}.open-board{width:100%;color:#28588e!important;background:#e8f2ff!important;border-color:#9fc3eb!important}.canvas-action{width:100%;color:#fff!important;background:#3b82d0!important;border-color:#3b82d0!important}.canvas-action:disabled{opacity:.55}.board-overlay,.asset-picker-overlay{position:fixed;inset:0;background:rgba(226,234,244,.84);z-index:1800;padding:24px;overflow:auto}.board-dialog,.asset-picker-dialog{max-width:1100px;margin:0 auto;background:#fff;border:1px solid #d1dce9;border-radius:14px;box-shadow:0 18px 70px rgba(43,68,99,.18);min-height:80vh}.asset-picker-dialog{max-width:1240px;padding:20px}.dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 24px;border-bottom:1px solid #e0e7ef}.dialog-head h2{margin:0 0 4px;font-size:20px}.dialog-head p{margin:0;color:#718198;font-size:12px}.dialog-body{padding:20px 24px 28px}.dialog-block{padding:0 0 20px;margin-bottom:20px;border-bottom:1px solid #e0e7ef}.dialog-block h3{margin:0 0 12px;font-size:15px}.dialog-block h3 small{color:#718198;font-size:11px;font-weight:normal}.detail-assets{display:flex;flex-wrap:wrap;gap:12px}.asset-choice{display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:6px!important;width:145px;padding:8px!important;text-align:left;background:#f7fafd!important;border:1px solid #d8e2ec!important}.asset-choice img,.asset-empty{width:127px;height:105px;object-fit:contain;background:#edf3f8;display:grid;place-items:center;color:#718198}.asset-choice strong{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asset-choice small{font-size:10px;color:#718198}.dialog-block textarea{min-height:120px}.shot-detail{border:1px solid #d7e1ec;background:#f7fafd;border-radius:8px;padding:12px;margin:10px 0}.shot-detail>header{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #d7e1ec;padding-bottom:8px}.shot-detail>header span,.shot-detail p{font-size:12px;color:#4e6078}.shot-detail p{margin:8px 0}.shot-detail-image{max-height:190px;max-width:270px;object-fit:contain;background:#edf3f8;border-radius:6px}.dialog-actions{display:flex;justify-content:flex-end;gap:10px}.asset-picker-dialog .asset-library{min-height:0}.asset-picker-dialog .asset-header{margin-bottom:12px}.asset-picker-dialog .asset-grid{max-height:480px;overflow:auto}.asset-picker-dialog .asset-overlay{z-index:2300}.boards-section .danger{color:#f09b91}@media(max-width:800px){.board-toolbar>strong{margin-left:0}.board-preview-grid{grid-template-columns:1fr}.board-overlay,.asset-picker-overlay{padding:10px}.dialog-head,.dialog-body{padding-left:15px;padding-right:15px}}/* Compact production workspace: retain readable 12-13px controls while reducing empty space. */
.producer{font-size:13px;line-height:1.45}
.top{padding:9px 16px;gap:12px;min-height:58px}
.top strong{font-size:16px}
.topRight{gap:8px}
.topRight span{font-size:11px}
.side{width:156px;padding:11px 7px;gap:3px}
.side button{gap:8px;padding:8px 9px;border-radius:7px;font-size:12px;min-height:34px}
.side button span{font-size:14px;min-width:15px}
.side button small{margin-left:auto;font-size:10px;opacity:.68}
.sideTip{font-size:10px;line-height:1.5;padding:8px}
.section,.section.novel-section,.section.scripts-section,.section.assets-section{padding:13px 16px 20px}
.section{max-width:1440px}
.heading{gap:12px;margin-bottom:12px;flex-wrap:wrap}
.heading h2{font-size:18px}
.heading p{font-size:11px}
.card{padding:13px 14px;margin-bottom:10px;border-radius:9px}
.card h3{font-size:13px;margin-bottom:9px}
.formGrid{gap:10px}
.producer label:not(.inlineFile){gap:4px;font-size:12px}
.producer label{margin-bottom:8px}
.producer input:not([type="checkbox"]):not([type="file"]),.producer select{padding:6px 9px;min-height:32px;border-radius:6px;font-size:12px}
.producer textarea{padding:7px 9px;min-height:54px;border-radius:6px;font-size:12px;line-height:1.55}
.producer button{padding:6px 10px;min-height:32px;font-size:12px;border-radius:6px}
.actions{gap:7px;margin-bottom:9px}
.inlineFile{padding:6px 9px;margin:0 6px 6px 0}
.metrics{gap:6px;margin-top:9px}
.metrics span{padding:5px 9px;font-size:11px}
.record,.boardRow{padding:10px 0}
.split{gap:11px;min-height:300px}
.chapters{width:184px;max-height:530px;padding-right:8px}
.preview textarea{height:380px}
.console{padding:12px;min-height:100px;font-size:11px}
.empty{padding:30px}
.alertInfo{padding:8px 10px}
.storyboard-toolbar{gap:10px}
.storyboard-table{min-width:1040px;font-size:11px}
.storyboard-table th{padding:7px 6px}
.storyboard-table td{padding:6px;min-width:72px}
.storyboard-table input,.storyboard-table select,.storyboard-table textarea{margin-bottom:4px;padding:5px 6px;font-size:11px;min-height:30px}
.storyboard-table textarea{min-width:148px;min-height:52px}
.board-toolbar{gap:8px}
.board-toolbar>label{min-width:188px}
.board-preview-grid{grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.board-preview-card{padding:11px;border-radius:9px}
.board-preview-meta{gap:4px;margin:7px 0;font-size:10px}
.board-preview-meta span{padding:3px 5px}
.shot-strip{margin:6px 0 8px;gap:4px}
.shot-strip span{padding:3px 5px}
.preview-images,.preview-images img{height:64px}
.preview-prompt{height:49px;font-size:11px;margin:8px 0}
.board-card-actions{gap:6px}
.board-overlay,.asset-picker-overlay{padding:14px;display:flex;align-items:center;justify-content:center;overflow:auto;background:rgba(20,32,48,.58)}
.board-dialog,.asset-picker-dialog{width:min(100%,990px);max-width:990px;max-height:calc(100vh - 28px);min-height:0;overflow:auto;margin:auto;border-radius:11px}
.asset-picker-dialog{width:min(100%,1040px);max-width:1040px;padding:12px}
.dialog-head{padding:12px 16px;gap:10px}
.dialog-head h2{font-size:17px}
.dialog-body{padding:13px 16px 18px}
.dialog-block{padding:0 0 12px;margin-bottom:12px}
.dialog-block h3{font-size:13px;margin-bottom:8px}
.detail-assets{gap:8px}
.asset-choice{width:115px;padding:6px!important;gap:4px!important}
.asset-choice img,.asset-empty{width:101px;height:76px}
.dialog-block textarea{min-height:90px}
.shot-detail{padding:9px;margin:7px 0}
.shot-detail p{margin:5px 0}
.shot-detail-image{max-height:148px;max-width:230px}
.asset-picker-dialog .asset-grid{max-height:390px}
@media(max-width:900px){
  .side{width:132px}
  .section,.section.novel-section,.section.scripts-section,.section.assets-section{padding:11px}
  .formGrid{grid-template-columns:1fr}
}
@media(max-width:700px){
  .top{padding:8px 10px}
  .topRight span:not(.saveState){display:none}
  .side{width:112px;padding:9px 5px}
  .side button{padding:7px 5px;font-size:11px;gap:5px}
  .sideTip{display:none}
  .board-preview-grid{grid-template-columns:1fr}
  .board-overlay,.asset-picker-overlay{padding:6px}
  .dialog-head,.dialog-body{padding:10px}
}
/* Project settings owns its full available canvas workspace; no centered max-width gutters. */
.section.project-section{max-width:none;width:100%;min-width:0;min-height:100%;margin:0;padding:12px 14px 20px;box-sizing:border-box}
@media(max-width:700px){.section.project-section{padding:8px}}
/* Professional storyboard workspace uses the full canvas width, without centered side gutters. */
.section.storyboard-section{max-width:none;width:100%;height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;padding:10px 12px 12px;margin:0;box-sizing:border-box;overflow:hidden}
.section.storyboard-section> .shot-workbench{flex:1;min-height:0}
@media(max-width:800px){.section.storyboard-section{overflow:auto;height:auto;min-height:100%;padding:8px}}
</style>
