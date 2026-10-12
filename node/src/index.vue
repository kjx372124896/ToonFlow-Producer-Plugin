<template>
  <nodeSkeleton v-bind="nodeProps" :previewReady="true">
    <div class="studio-node-card nodrag nopan" @dblclick.stop @mousedown.stop @pointerdown.stop>
      <div class="studio-node-head">
        <span class="studio-node-icon" aria-hidden="true">🎬</span>
        <div class="studio-node-name">
          <strong :title="projectTitle">{{ projectTitle }}</strong>
          <small>短剧制片中心</small>
        </div>
      </div>
      <div v-if="projectStats.ready" class="studio-stats" aria-label="项目统计">
        <span>{{ projectStats.chapters }}章</span>
        <span>{{ projectStats.scripts }}集剧本</span>
        <span>{{ projectStats.panels }}镜头</span>
      </div>
      <p v-else class="studio-node-placeholder">待创建项目</p>
      <div v-if="loadError" class="studio-node-error" :title="loadError">{{ loadError }}</div>
      <button type="button" class="studio-open-btn nodrag" :disabled="loading" @click.stop="openStudio">
        {{ loading ? "正在读取…" : "打开制片中心" }}
      </button>
    </div>
  </nodeSkeleton>
  <Teleport to="body">
    <div v-if="open" class="producer-node-overlay nodrag nopan nowheel" @wheel.stop @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
      <div class="producer-node-window">
        <header class="producer-node-top">
          <div><strong>🎬 短剧制片中心</strong><span>项目创建 / 小说 / 剧本 / 资产 / 分镜 / 画布装配</span></div>
          <div class="producer-node-actions">
            <span>{{ saveStatus }}</span>
            <button @click="flushSave">保存</button>
            <button class="producer-close" @click="closeStudio">关闭 ×</button>
          </div>
        </header>
        <div v-if="loading" class="producer-node-loading">正在加载制片项目…</div>
        <div v-else-if="loadError" class="producer-node-loading">
          <p>{{ loadError }}</p><button @click="loadProject">重试读取</button>
        </div>
        <Studio v-else class="producer-node-main" :context="ctx" />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref, watch } from "vue";
import { nodeSkeleton, useNode, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { useVueFlow } from "@vue-flow/core";
import Studio from "../../src/Studio.vue";
import { emptyStudio } from "../../src/studio.mjs";
import { createProjectOnDisk, listProjects, migrateLegacyProject } from "../../src/projectStorage.mjs";

defineOptions({
  inheritAttrs: false,
  handles: [{ id: "project", type: "source", dataType: "STRING", label: "项目概览" }] satisfies NodeHandle[]
});

const { id, node, nodeProps, outputs, files, nodeEvent } = useNode({
  label: "短剧制片中心",
  outputs: { project: { dataType: "STRING", value: "" } }
});
const open = ref(false);
const loading = ref(true);
const loadError = ref("");
const saveStatus = ref("未加载");
const filePath = ref(typeof node.data.producerStudioPath === "string"
  ? node.data.producerStudioPath : "producer-studio/" + id + "/项目.tfprod");
const workspace = files.getWorkspaceFiles();
const canvasFlow = useVueFlow();
// 原生 textNode 只公开 setText，尚未公开 setConfig。
// 在同一画布 Vue Flow store 中更新其 data.model（原生节点实际使用此字段）。
function setTextNodeModel(nodeId: string, providerId: string, modelId: string) {
  const target = canvasFlow.findNode(nodeId);
  if (!target || target.type !== "remote-textNode") throw new Error("找不到当前画布里的原生文本节点：" + nodeId);
  const model = JSON.stringify([providerId, modelId]);
  canvasFlow.updateNodeData(nodeId, { model });
  const updated = canvasFlow.findNode(nodeId);
  if (updated?.data?.model !== model) throw new Error("文本节点默认模型写入后校验失败");
  return { nodeId, model };
}
// RH 插件没有公开「写入工作流字段」命令，使用同画布 VueFlow store 写回并读后校验。
function setRhPrompt(nodeId: string, prompt: string) {
  const target=canvasFlow.findNode(nodeId);
  if(!target || target.type!=="remote-runninghubWorkflowNode")throw new Error("RH 节点不存在或已切换画布");
  const fields=Array.isArray(target.data.fields)?target.data.fields as Array<Record<string,unknown>>:[];
  const eligible=fields.filter(f=>/prompt|text|提示词|文本|台词|配音内容|文案/i.test(String(f.fieldName||'')) &&
    !/url|file|path/i.test(String(f.fieldName||'')) &&
    (!f.fieldType||/STRING|TEXT|PROMPT/i.test(String(f.fieldType))));
  if(!eligible.length)throw new Error('RH 应用未提供可识别的文本提示词字段，任务没有启动');
  const field=eligible.find(x=>/positive_prompt|text_prompt|prompt|提示词/i.test(String(x.fieldName)))||eligible[0];
  const copied=fields.map(f=>({...f,fieldValue:f.id===field.id?prompt:f.fieldValue}));
  canvasFlow.updateNodeData(nodeId,{fields:copied});
  const verify=canvasFlow.findNode(nodeId)?.data?.fields as Array<Record<string,unknown>>|undefined;
  if(!verify?.some(f=>f.id===field.id && f.fieldValue===prompt))throw new Error('RH 提示词写入验证失败');
  return {nodeId,fieldId:field.id};
}
// 画布组件通过 provide("canvas", getCanvasContext) 注入准确的当前画布。
// 该方法不需要 MCP 服务，也不会错误地绑定其它窗口中的画布。
const canvasProvider = inject<(() => { id: string; call: (request: { name: string; args: Record<string, unknown> }) => Promise<unknown> }) | undefined>("canvas", undefined);
let queue: Promise<void> = Promise.resolve();
let revision = 0;

const ctx = reactive({
  resource: { kind: "file", path: filePath.value, directory: "", label: "项目.tfprod" },
  text: "",
  loading: true,
  dirty: false,
  active: true,
  error: "",
  config: {},
  files: workspace,
  canvasProvider,
  setTextNodeModel,
  setRhPrompt,
  async createProjectFile(data: unknown, root: string) { return createProjectOnDisk(workspace,data,root); },
  async listProjects(root: string) { return listProjects(workspace,root); },
  async migrateCurrentProject(data: unknown) {
    await flushSave();
    const newPath=await migrateLegacyProject(workspace,filePath.value,data);
    if(newPath!==filePath.value) await switchProject(newPath);
    return newPath;
  },
  updateText(value: string) { enqueueWrite(value); },
  async flushSave() { await flushSave(); },
  async openFile(path: string) { await switchProject(path); },
  async saveConfig() {},
  async writeClipboardText(text: string) { await navigator.clipboard.writeText(text); }
});

function summaryText(value: string): string {
  try {
    const data = JSON.parse(value);
    if (!data?.project) return "待创建项目 · 点击打开";
    return (data.project.name || "未命名项目") + " · " + (data.chapters?.length || 0) +
      " 章 · " + (data.scripts?.length || 0) + " 集剧本 · " + (data.panels?.length || 0) + " 镜头";
  } catch { return "项目文件待修复"; }
}
const projectTitle = computed(() => {
  try { return JSON.parse(ctx.text)?.project?.name || "新建制片项目"; } catch { return "制片项目"; }
});
const projectStats = computed(() => {
  try {
    const data = JSON.parse(ctx.text);
    if (!data?.project) return { ready: false, chapters: 0, scripts: 0, panels: 0 };
    return {
      ready: true,
      chapters: Array.isArray(data.chapters) ? data.chapters.length : 0,
      scripts: Array.isArray(data.scripts) ? data.scripts.length : 0,
      panels: Array.isArray(data.panels) ? data.panels.length : 0
    };
  } catch {
    return { ready: false, chapters: 0, scripts: 0, panels: 0 };
  }
});
watch(() => ctx.text, text => { outputs.value.project.value = summaryText(text); });

async function ensureDirectory(directory: string) {
  try { await workspace.mkdir(directory); }
  catch (error) {
    try { await workspace.list(directory); }
    catch { throw error; }
  }
}
function checkPath(path: string) {
  if (!path || path.startsWith("/") || /^[a-zA-Z]:/.test(path) ||
      path.includes("..") || path.includes("\\") || !path.endsWith(".tfprod") || !path.includes("/")) {
    throw new Error("项目文件必须位于画布工作区的项目子文件夹内");
  }
}
function enqueueWrite(text: string) {
  if (ctx.loading || loadError.value) throw new Error("项目文件尚未就绪");
  const target = filePath.value, seq = ++revision;
  ctx.text = text;
  ctx.dirty = true;
  saveStatus.value = "保存中…";
  const next = queue.catch(() => {}).then(() => workspace.write(target, text, false)).then(() => {
    if (seq === revision) {
      ctx.dirty = false;
      ctx.error = "";
      saveStatus.value = "已保存";
    }
  }).catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    ctx.error = "项目保存失败：" + message;
    saveStatus.value = "保存失败";
    throw error;
  });
  queue = next;
  void next.catch(() => {});
}
async function flushSave() {
  await queue;
  if (ctx.error) throw new Error(ctx.error);
}
async function loadProject() {
  loading.value = true;
  loadError.value = "";
  ctx.loading = true;
  try {
    const defaultDir = "producer-studio/" + id;
    checkPath(filePath.value);
    const name = filePath.value.split("/").at(-1)!;
    if(filePath.value === defaultDir + "/项目.tfprod") {
      await ensureDirectory("producer-studio");
      await ensureDirectory(defaultDir);
      const listing = await workspace.list(defaultDir);
      if (!listing.entries.some(entry => entry.name === name)) {
        await workspace.write(filePath.value, JSON.stringify(emptyStudio(), null, 2), true);
      }
    }
    const content = await workspace.readText(filePath.value);
    JSON.parse(content);
    node.data.producerStudioPath = filePath.value;
    ctx.resource.path = filePath.value;
    ctx.resource.label = name;
    ctx.text = content;
    saveStatus.value = "已读取";
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
    saveStatus.value = "读取失败";
  } finally {
    loading.value = false;
    ctx.loading = false;
  }
}
async function switchProject(nextPath: string) {
  checkPath(nextPath);
  await flushSave();
  const previous = filePath.value;
  filePath.value = nextPath;
  await loadProject();
  if(loadError.value) {
    filePath.value=previous;
    await loadProject();
    throw new Error("目标项目无法读取，已恢复原项目");
  }
  node.data.producerStudioPath = nextPath;
}
function openStudio() {
  open.value = true;
  ctx.active = true;
  if (loadError.value) void loadProject();
}
async function closeStudio() {
  try {
    await flushSave();
    open.value = false;
    ctx.active = false;
  } catch (error) {
    ctx.error = error instanceof Error ? error.message : String(error);
  }
}
nodeEvent.on("save", async () => { await flushSave(); });
onMounted(() => { void loadProject(); });
</script>

<style scoped>
/* nodeSkeleton 的内容槽位宽度为 220px - el-card 左右各 8px；
   内容必须使用百分比布局，不能再用固定 280px 撑出横向滚动条。 */
.studio-node-card{width:100%;max-width:100%;min-width:0;padding:6px 6px 8px;box-sizing:border-box;display:flex;flex-direction:column;gap:9px;overflow:hidden;cursor:default}
.studio-node-head{display:flex;align-items:center;gap:8px;min-width:0}
.studio-node-icon{flex:0 0 32px;width:32px;height:32px;display:grid;place-items:center;border-radius:8px;background:var(--el-fill-color-light,#f3f6fa);font-size:20px;line-height:1}
.studio-node-name{flex:1;min-width:0}
.studio-node-name strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:650;line-height:18px}
.studio-node-name small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--el-text-color-secondary,#8993a3);font-size:10px;line-height:15px}
.studio-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;min-width:0}
.studio-stats span{display:block;min-width:0;padding:5px 1px;border-radius:6px;background:var(--el-fill-color-light,#f4f6f9);color:var(--el-text-color-secondary,#768196);font-size:10px;line-height:16px;text-align:center;white-space:nowrap}
.studio-node-placeholder{margin:0;font-size:11px;color:var(--el-text-color-secondary,#8993a3)}
.studio-node-error{font-size:10px;color:var(--el-color-danger,#ef6666);max-height:46px;overflow:auto;overflow-wrap:anywhere}
.studio-open-btn{display:block;width:100%;min-width:0;box-sizing:border-box;background:var(--el-color-primary,#2f7fd6);color:#fff;border:none;border-radius:7px;min-height:32px;padding:6px 8px;cursor:pointer;font-size:12px;font-weight:600;line-height:20px}
.studio-open-btn:hover:not(:disabled){filter:brightness(1.06)}
.studio-open-btn:disabled{opacity:.5;cursor:wait}
.producer-node-overlay{position:fixed;inset:0;z-index:2147480000;background:#0009;display:flex;justify-content:center;align-items:stretch;padding:14px;box-sizing:border-box}
.producer-node-window{width:100%;height:100%;max-width:1800px;max-height:100%;background:var(--el-bg-color,#131821);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--el-border-color,#40444e);border-radius:12px;box-shadow:0 12px 65px #0008;color:var(--el-text-color-primary,#f0f1f3)}
.producer-node-top{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:15px;padding:11px 18px;border-bottom:1px solid var(--el-border-color,#343945);background:var(--el-fill-color-light,#1c2230)}
.producer-node-top strong{font-size:15px}.producer-node-top span{font-size:11px;color:var(--el-text-color-secondary,#9199a4);margin-left:12px}
.producer-node-actions{display:flex;align-items:center;gap:9px}
.producer-node-actions button,.producer-node-loading button{border:1px solid var(--el-border-color,#505b6e);border-radius:7px;padding:7px 13px;background:var(--el-fill-color,#293341);color:inherit;cursor:pointer}
.producer-node-actions .producer-close{background:#b04747;border-color:#b04747;color:white}
.producer-node-main{flex:1;min-height:0;overflow:hidden}
.producer-node-loading{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px}
</style>
