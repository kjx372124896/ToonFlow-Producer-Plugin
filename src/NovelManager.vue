<template>
  <div class="novel-manager">
    <div class="novel-toolbar">
      <div class="toolbar-left">
        <label class="novel-action primary-action">＋ 导入原文<input type="file" accept=".txt,.md,text/plain" :disabled="analysis.running || uploading" @change="importNovel" /></label>
        <button class="delete-action" :disabled="analysis.running || !selectedIds.length" @click="deleteSelected">▤ 批量删除</button>
        <button class="analyze-action" :disabled="!filteredChapters.length || uploading" @click="analyzeSelected">▣ {{ analysis.running ? '添加到队列' : '事件分析 / 自动排队' }}</button>
        <button class="plain-action" :disabled="rulesLoading || rulesSaving || rulesLoadFailed || !selectedRule" @click="editRule">✎ 提取规则</button>
        <button class="plain-action" :disabled="analysis.running || !failedQueueCount" @click="retryFailed">重试失败 ({{ failedQueueCount }})</button>
        <button v-if="!analysis.running && queueCounts.queued" class="plain-action" @click="resumeQueue">继续队列 ({{ queueCounts.queued }})</button>
        <button v-if="analysis.running" class="stop-action" @click="stopAnalysis">停止分析</button>
      </div>
      <div class="search-group"><input v-model="search" placeholder="搜索原文章节名称…" aria-label="搜索章节名称" /><button @click="page=1">⌕ 搜索</button></div>
    </div>
    <div class="novel-options">
      <label>导入编码 <select v-model="encoding" :disabled="analysis.running"><option value="utf-8">UTF-8</option><option value="gb18030">GBK / GB18030</option></select></label>
      <label>事件分析模型
        <select v-model="modelChoice" :disabled="analysis.running || loadingModels" @change="saveDefaultModel">
          <option value="">自动选择第一个已配置文本模型</option>
          <option v-for="m in models" :key="m.value" :value="m.value">{{ m.providerLabel }} · {{ m.label }}</option>
          <option v-if="modelChoice && !models.some(m=>m.value===modelChoice)" :value="modelChoice">⚠ 默认模型不可用，请重新选择</option>
        </select>
      </label>
      <button class="plain-action" :disabled="loadingModels || analysis.running" @click="refreshModels">{{ loadingModels ? '读取中…' : '刷新模型' }}</button>
      <label>提取规则
        <select v-model="ruleChoice" :disabled="rulesLoading || rulesSaving" @change="selectRule">
          <option v-for="rule in rules" :key="rule.id" :value="rule.id">{{ rule.source==='builtin'?'【内置】':'【自定义】' }}{{ rule.name }}</option>
          <option v-if="ruleChoice && !rules.some(rule=>rule.id===ruleChoice)" :value="ruleChoice">⚠ 规则已丢失，请重新选择</option>
        </select>
      </label>
      <button class="plain-action" :disabled="rulesLoading || rulesSaving || rulesLoadFailed" @click="newRule">＋ 新增规则</button>
      <span class="model-hint">自定义规则跨项目复用；输出仍采用七字段格式。</span>
    </div>
    <p v-if="modelError" class="novel-error">{{ modelError }}</p>
    <p v-if="ruleError" class="novel-error">{{ ruleError }}</p>
    <div v-if="analysis.running || analysis.last || queueCounts.total" class="analysis-progress" role="status">
      <div><strong>{{ analysis.running ? '并发分析中' : '分析任务队列' }}</strong> · 文本上限 {{ currentLimits.concurrency }}
        · 运行中 {{ queueCounts.running }} · 待生成 {{ queueCounts.queued+queueCounts.retrying }}
        · 成功 {{ queueCounts.success }} · 失败 {{ queueCounts.failed }}
        <span v-if="analysis.running"> · 累计完成 {{ analysis.done }} 项</span></div>
      <div class="progress-track"><div :style="{width:queueCounts.total ? ((queueCounts.success + queueCounts.failed) / queueCounts.total * 100) + '%' : '0%'}" /></div>
      <span v-if="analysis.last" class="subtle">{{ analysis.last }}</span>
    </div>
    <div class="novel-table-wrap">
      <table class="novel-table"><thead><tr>
        <th class="check-col"><input type="checkbox" :checked="allPageSelected" :disabled="analysis.running || !pageChapters.length" @change="selectPage($event.target.checked)" /></th>
        <th class="number-col">序号</th><th class="volume-col">卷</th><th class="title-col">章节名称</th>
        <th>章节内容</th><th class="event-col">事件</th><th class="operations-col">操作</th>
      </tr></thead><tbody>
        <tr v-for="ch in pageChapters" :key="ch.id">
          <td><input type="checkbox" :checked="selectedIds.includes(ch.id)" :disabled="analysis.running" @change="toggleSelected(ch.id,$event.target.checked)" /></td>
          <td>{{ ch.order }}</td><td>{{ ch.volume || '正文卷' }}</td>
          <td><span class="chapter-title" :title="ch.title">{{ ch.title }}</span></td>
          <td><span class="chapter-excerpt" :title="ch.content?.slice(0,600)">{{ ch.content?.trim() ? ch.content.slice(0,85) : '无' }}</span></td>
          <td><button class="status-button" :class="statusClass(ch)" @click="openAnalysis(ch)" :title="taskForChapter(ch)?.lastError || eventFor(ch)?.lastError || ''">
            {{ eventStatus(ch) }}
          </button></td>
          <td><div class="row-actions">
            <button class="edit-link" :disabled="analysis.running" @click="editChapter(ch)">✎ 编辑</button>
            <button class="remove-link" :disabled="analysis.running" @click="removeChapters([ch.id])">♜ 删除</button>
          </div></td>
        </tr>
        <tr v-if="!pageChapters.length"><td colspan="7" class="table-empty">{{ search ? '没有找到匹配的章节' : '尚无章节，请先导入 TXT / MD 小说原文' }}</td></tr>
      </tbody></table>
    </div>
    <div class="novel-footer">
      <span>共 {{ filteredChapters.length }} 条数据 · 已选择 {{ selectedIds.length }} 章</span>
      <div class="pages">
        <select v-model.number="pageSize" @change="page=1"><option :value="10">10 条/页</option><option :value="20">20 条/页</option><option :value="50">50 条/页</option><option :value="100">100 条/页</option></select>
        <button :disabled="page<=1" @click="page--">‹</button><span>{{ page }} / {{ maxPage }}</span><button :disabled="page>=maxPage" @click="page++">›</button>
      </div>
    </div>

    <div v-if="editor" class="novel-modal-mask" @click.self="editor=null" @wheel.stop @pointerdown.stop>
      <div class="novel-modal">
        <div class="modal-heading"><h3>{{ editor.kind==='chapter'?'编辑章节':'章节事件分析' }}</h3><button @click="editor=null">×</button></div>
        <template v-if="editor.kind==='chapter'">
          <label>章节名称 <input v-model="editor.title" maxlength="200" /></label>
          <label>章节原文 <textarea v-model="editor.content" rows="18" /></label>
          <p class="subtle">编辑原文后，已有分析将标为待重新分析。已有剧本及分镜不会被静默覆盖。</p>
          <div class="modal-actions"><button @click="editor=null">取消</button><button class="primary-action" @click="commitChapter">保存章节</button></div>
        </template>
        <template v-else>
          <p class="subtle">{{ editor.title }} · 严格七字段：章节 / 角色 / 核心事件 / 主线关系 / 密度 / 集长 / 情绪。原始分析结果按章节持久化。</p>
          <p v-if="editor.ruleName" class="subtle">提取规则：{{ editor.ruleName }}</p>
          <p v-if="editor.lastError" class="novel-error">最近失败原因：{{ editor.lastError }}</p>
          <p v-if="modelError" class="novel-error">{{ modelError }}</p>
          <label>事件分析结果（可直接编辑并校验）<textarea v-model="editor.raw" rows="8" placeholder="| 第1章 标题 | 角色 | 核心事件 | 强（理由） | 高 | 50秒 | 转折+悬疑 |" /></label>
          <p v-if="editor.model" class="subtle">使用模型：{{ editor.model.providerId }} / {{ editor.model.modelId }}</p>
          <div class="modal-actions"><button @click="editor=null">关闭</button>
            <button class="primary-action" :disabled="analysis.running" @click="saveEditedAnalysis">保存校正结果</button>
            <button :disabled="analysis.running" @click="reanalyzeEditor">重新分析该章</button>
          </div>
        </template>
      </div>
    </div>
    <div v-if="ruleEditor" class="novel-modal-mask" @click.self="!rulesSaving && (ruleEditor=null)" @wheel.stop @pointerdown.stop>
      <div class="novel-modal rule-modal" role="dialog" aria-modal="true" aria-label="提取规则编辑器">
        <div class="modal-heading">
          <div><h3>{{ ruleEditor.originalId ? '编辑提取规则' : '新增提取规则' }}</h3>
            <p class="subtle">{{ ruleEditor.originalSource==='builtin' ? '内置规则不可直接覆盖，保存时自动创建自定义副本。' : '自定义规则保存到 ToonFlow 工作区，其他项目也可选择。' }}</p></div>
          <button aria-label="关闭规则编辑器" :disabled="rulesSaving" @click="ruleEditor=null">×</button>
        </div>
        <label>规则名称 <input v-model="ruleEditor.name" maxlength="80" placeholder="例如：强冲突短剧事件提取" :disabled="rulesSaving" /></label>
        <label>提取指令（System Prompt）
          <textarea v-model="ruleEditor.prompt" rows="18" spellcheck="false" :disabled="rulesSaving" placeholder="请输入完整的事件提取规则…" />
        </label>
        <p class="subtle">可修改分析侧重点、内容与判定要求；结构化结果仍采用七字段单行格式，不符合协议会标为失败。已提交的章节使用提交时的规则快照。</p>
        <p v-if="ruleError" class="novel-error">{{ ruleError }}</p>
        <div class="modal-actions">
          <button v-if="ruleEditor.originalId && ruleEditor.originalSource==='custom'" class="remove-link" :disabled="rulesSaving" @click="deleteRule">删除规则</button>
          <button :disabled="rulesSaving" @click="ruleEditor=null">取消</button>
          <button v-if="ruleEditor.originalId" :disabled="rulesSaving" @click="duplicateRule">另存为新规则</button>
          <button class="primary-action" :disabled="rulesSaving || !ruleEditor.name.trim() || !ruleEditor.prompt.trim()" @click="saveRule">{{ rulesSaving?'正在保存…':'保存并选用' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { splitNovel, uid } from "./studio.mjs";
import { normalizeGeneration, parseModelValue } from "./generation.mjs";
import { analyzeChapter, chapterFingerprint, eventLine, loadTextModels, parseEventLine } from "./eventAnalysis.mjs";
import { enqueueTasks, recoverInterrupted, runTaskQueue, normalizeQueueSettings, queueStats, tasksFor } from "./taskQueue.mjs";
import { DEFAULT_EVENT_RULE_ID, allEventRules, createEventRule, loadEventRules, resolveEventRule,
  ruleFingerprint, saveEventRules, snapshotEventRule } from "./eventRules.mjs";

const props = defineProps({ studio: { type: Object, required: true }, context: { type: Object, required: true } });
const emit = defineEmits(["save", "chaptersChanged"]);
const selectedIds = ref([]), search = ref(""), page = ref(1), pageSize = ref(10);
const encoding = ref("utf-8"), editor = ref(null), uploading = ref(false);
const models = ref([]), modelChoice = ref(""), loadingModels = ref(false), modelError = ref("");
const customRules=ref([]),ruleChoice=ref(DEFAULT_EVENT_RULE_ID),ruleEditor=ref(null);
const rulesLoading=ref(false),rulesSaving=ref(false),rulesLoadFailed=ref(false),ruleError=ref("");
const rules=computed(()=>allEventRules(customRules.value));
const selectedRule=computed(()=>resolveEventRule(ruleChoice.value,customRules.value));
const analysis = reactive({ running:false, done:0, total:0, failures:0, active:"", activeId:"", last:"" });
let controller = null;
const queueItems=computed(()=>props.studio.taskQueues?.text || []);
const queueMap=computed(()=>new Map(queueItems.value.map(job=>[job.id,job])));
const queueCounts=computed(()=>queueStats(queueItems.value));
const currentLimits=computed(()=>normalizeQueueSettings(props.studio.project?.queueSettings).text);
const failedQueueCount=computed(()=>queueCounts.value.failed);
const taskForChapter=chapter=>queueMap.value.get(chapter.id);

watch(() => props.studio.project?.generation?.text?.model, value => { modelChoice.value = value || ""; }, { immediate:true });
watch(() => props.studio.project?.eventRuleId, value => {ruleChoice.value=value || DEFAULT_EVENT_RULE_ID;}, { immediate:true });
watch(search,()=>{page.value=1;selectedIds.value=[];});
const filteredChapters = computed(() => props.studio.chapters.filter(c => !search.value.trim() || c.title.toLowerCase().includes(search.value.trim().toLowerCase())));
const maxPage = computed(() => Math.max(1,Math.ceil(filteredChapters.value.length/pageSize.value)));
watch(maxPage, value => {if(page.value>value)page.value=value;});
const pageChapters = computed(() => filteredChapters.value.slice((page.value-1)*pageSize.value,page.value*pageSize.value));
const allPageSelected = computed(() => !!pageChapters.value.length && pageChapters.value.every(c=>selectedIds.value.includes(c.id)));
const eventsByChapter = computed(() => new Map(props.studio.events.map(e=>[e.chapterId,e])));
const eventFor = chapter => eventsByChapter.value.get(chapter.id);
function eventStatus(chapter) {
  const task=taskForChapter(chapter);
  if(task && task.sourceHash===chapterFingerprint(chapter)){
    if(task.status==="running")return `分析中 (${task.attempts}次)`;
    if(task.status==="queued")return "待生成";
    if(task.status==="retrying")return `等待重试 (${task.attempts}次)`;
    if(task.status==="failed")return "生成失败";
  }
  const event=eventFor(chapter);
  if(!event) return "未分析";
  if(event.status==="failed") return "生成失败";
  if(event.status==="success" && event.sourceHash===chapterFingerprint(chapter)) {
    const rule=selectedRule.value;
    if(rule && !event.ruleId && rule.id!==DEFAULT_EVENT_RULE_ID)return "待重新分析";
    if(rule && event.ruleDigest && event.ruleDigest!==ruleFingerprint(rule.prompt))return "待重新分析";
    if(rule && event.ruleId && event.ruleId!==rule.id)return "待重新分析";
    return "已完成";
  }
  if(event.status==="success") return "待重新分析";
  return "旧版事件";
}
function statusClass(chapter){const status=eventStatus(chapter);if(status.startsWith("分析中"))return "pending";if(status.startsWith("等待重试"))return "pending";return ({"待生成":"pending","生成失败":"failed","已完成":"completed","待重新分析":"pending","旧版事件":"pending"})[status]||"waiting";}
function toggleSelected(id, checked){selectedIds.value=checked ? [...new Set([...selectedIds.value,id])] : selectedIds.value.filter(x=>x!==id);}
function selectPage(checked){const ids=new Set(pageChapters.value.map(x=>x.id));selectedIds.value=checked?[...new Set([...selectedIds.value,...ids])]:selectedIds.value.filter(x=>!ids.has(x));}
async function refreshModels(){
  loadingModels.value=true;modelError.value="";
  try {models.value=await loadTextModels();if(!models.value.length)modelError.value="当前未配置可用文本模型，请先到 ToonFlow 设置中添加。";}
  catch(e){modelError.value=e.message;}finally{loadingModels.value=false;}
}
async function refreshRules(){
  rulesLoading.value=true;ruleError.value="";
  try {customRules.value=await loadEventRules(props.context.files);rulesLoadFailed.value=false;}
  catch(e){rulesLoadFailed.value=true;ruleError.value="读取自定义提取规则失败："+e.message+"。为防止覆盖原规则，暂时禁止修改规则文件。";}
  finally{rulesLoading.value=false;}
}
function selectRule(){
  if(!selectedRule.value){ruleError.value="所选规则不存在，请重新选择或检查规则文件";return;}
  if(props.studio.project){props.studio.project.eventRuleId=ruleChoice.value;emit("save");}
  ruleError.value="";
}
function newRule(){
  ruleError.value="";
  ruleEditor.value={...createEventRule(),originalId:"",originalSource:"custom"};
}
function editRule(){
  const rule=selectedRule.value;
  if(!rule){ruleError.value="所选提取规则不存在";return;}
  ruleError.value="";
  const draft=rule.source==="builtin" ? createEventRule(rule) : {...rule};
  ruleEditor.value={...draft,originalId:rule.id,originalSource:rule.source};
}
function duplicateRule(){
  if(!ruleEditor.value)return;
  const copy=createEventRule({name:ruleEditor.value.name,prompt:ruleEditor.value.prompt});
  ruleEditor.value={...copy,originalId:"",originalSource:"custom"};
}
async function saveRule(){
  if(!ruleEditor.value||rulesSaving.value||rulesLoadFailed.value)return;
  rulesSaving.value=true;ruleError.value="";
  try{
    const draft=ruleEditor.value;
    const rule={id:draft.id,name:draft.name,prompt:draft.prompt,updatedAt:Date.now()};
    const next=[...customRules.value.filter(x=>x.id!==rule.id),{...rule,source:"custom"}];
    const saved=await saveEventRules(props.context.files,next);
    customRules.value=saved;
    ruleChoice.value=rule.id;
    selectRule();
    await props.context.flushSave();
    ruleEditor.value=null;
  }catch(e){ruleError.value="保存提取规则失败："+e.message;}
  finally{rulesSaving.value=false;}
}
async function deleteRule(){
  const draft=ruleEditor.value;
  if(!draft||!draft.originalId||draft.originalSource!=="custom"||rulesSaving.value||rulesLoadFailed.value)return;
  if(!confirm(`确定删除自定义规则「${draft.name}」吗？其他项目若仍选用此规则，需要重新选择。已提交队列的规则快照不会删除。`))return;
  rulesSaving.value=true;ruleError.value="";
  try{
    customRules.value=await saveEventRules(props.context.files,customRules.value.filter(x=>x.id!==draft.id));
    if(ruleChoice.value===draft.id){ruleChoice.value=DEFAULT_EVENT_RULE_ID;selectRule();await props.context.flushSave();}
    ruleEditor.value=null;
  }catch(e){ruleError.value="删除规则失败："+e.message;}
  finally{rulesSaving.value=false;}
}
onMounted(async()=>{
  await Promise.all([refreshModels(),refreshRules()]);
  // 页面关闭、插件刷新后从工作区文件恢复未完成任务，已成功的任务不重复调用。
  if(props.studio.taskQueues?.text?.some(job=>["running","queued","retrying"].includes(job.status))){
    recoverInterrupted(props.studio,"text");
    void resumeQueue();
  }
});
onBeforeUnmount(()=>{controller?.abort();});
function saveDefaultModel(){
  props.studio.project.generation=normalizeGeneration(props.studio.project.generation);
  props.studio.project.generation.text.model=modelChoice.value;
  emit("save");
}
function ensureNotAnalyzing(){if(analysis.running)throw new Error("请先停止当前事件分析任务");}
async function importNovel(event){
  const file=event.target.files?.[0];event.target.value="";
  if(!file)return;
  if(analysis.running || uploading.value)return;
  if(props.studio.chapters.length && !confirm("重新导入将清空现有章节、事件、剧本及分镜（不会删除已生成的画布节点）。确认继续？"))return;
  uploading.value=true;
  try {
    const buf=await file.arrayBuffer();
    const content=new TextDecoder(encoding.value,{fatal:false}).decode(buf);
    const chapters=splitNovel(content,file.name);
    const folder=props.context.resource.path.split("/").slice(0,-1).join("/");
    const novelDir=folder+"/novel";
    try{await props.context.files.mkdir(novelDir);}catch(e){await props.context.files.list(novelDir);}
    const path=novelDir+"/"+file.name.replace(/[\\/:*?"<>|]/g,"_");
    await props.context.files.write(path,buf,false);
    props.studio.chapters=chapters;props.studio.events=[];props.studio.scripts=[];props.studio.panels=[];
    props.studio.taskQueues={};delete props.studio.scriptWorkspace;
    props.studio.novelName=file.name;props.studio.sourceNovelPath=path;
    selectedIds.value=[];search.value="";page.value=1;analysis.last="";
    emit("save");await props.context.flushSave();emit("chaptersChanged");
  }catch(e){modelError.value="导入失败："+e.message;}finally{uploading.value=false;}
}
function editChapter(chapter){editor.value={kind:"chapter",id:chapter.id,title:chapter.title,content:chapter.content};}
function commitChapter(){
  try{
    ensureNotAnalyzing();
    const ch=props.studio.chapters.find(x=>x.id===editor.value?.id);
    if(!ch)throw new Error("章节已不存在");
    if(!editor.value.title.trim())throw new Error("章节名不能为空");
    if(!editor.value.content.trim())throw new Error("章节原文不能为空");
    ch.title=editor.value.title.trim();ch.content=editor.value.content;
    emit("save");editor.value=null;
  }catch(e){modelError.value=e.message;}
}
function removeChapters(ids){
  if(analysis.running)return;
  const removed=new Set(ids);
  const n=props.studio.chapters.filter(ch=>removed.has(ch.id)).length;
  if(!n)return;
  const scripts=props.studio.scripts.filter(s=>(s.chapterIds?.length?s.chapterIds:[s.chapterId]).some(id=>removed.has(id)));
  const bound=props.studio.panels.some(p=>scripts.some(s=>s.id===p.scriptId) && p.canvasBindings);
  if(!confirm(`确定删除 ${n} 章及关联事件、剧本、分镜吗？${bound?'\n其中存在已绑定画布的分镜，画布节点不会自动删除。':''}`))return;
  const scriptIds=new Set(scripts.map(s=>s.id));
  props.studio.chapters=props.studio.chapters.filter(ch=>!removed.has(ch.id));
  props.studio.chapters.forEach((ch,i)=>{ch.order=i+1;});
  props.studio.events=props.studio.events.filter(e=>!removed.has(e.chapterId));
  props.studio.scripts=props.studio.scripts.filter(s=>!scriptIds.has(s.id));
  props.studio.panels=props.studio.panels.filter(p=>!scriptIds.has(p.scriptId));
  if(props.studio.taskQueues?.text)props.studio.taskQueues.text=props.studio.taskQueues.text.filter(job=>!removed.has(job.id));
  if(props.studio.scriptWorkspace?.chapterIds?.some(id=>removed.has(id)))delete props.studio.scriptWorkspace;
  selectedIds.value=selectedIds.value.filter(id=>!removed.has(id));
  emit("save");emit("chaptersChanged");
}
function deleteSelected(){removeChapters(selectedIds.value);}
function openAnalysis(chapter){
  const event=eventFor(chapter);
  editor.value={kind:"analysis",id:chapter.id,title:chapter.title,raw:event?.failedRaw || event?.raw || (event?.structured?eventLine(event.structured):""),
    lastError:event?.lastError || "",model:event?.model || null,ruleName:event?.ruleName || ""};
}
function saveEditedAnalysis(){
  try{
    ensureNotAnalyzing();
    const chapter=props.studio.chapters.find(x=>x.id===editor.value?.id);
    if(!chapter)throw new Error("章节不存在");
    const structured=parseEventLine(editor.value.raw);
    const old=eventFor(chapter);
    replaceEvent(chapter,{id:old?.id || uid("event"),structured,raw:editor.value.raw,status:"success",sourceHash:chapterFingerprint(chapter),
      model:old?.model || null,analyzedAt:new Date().toISOString(),manual:true,lastError:"",
      ruleId:ruleChoice.value,ruleName:selectedRule.value?.name || "",
      ruleDigest:selectedRule.value ? ruleFingerprint(selectedRule.value.prompt) : ""});
    const task=taskForChapter(chapter);
    if(task){
      task.status="success";task.lastError="";task.sourceHash=chapterFingerprint(chapter);
      if(selectedRule.value){task.rule=snapshotEventRule(selectedRule.value);task.ruleDigest=task.rule.digest;}
    }
    emit("save");editor.value=null;modelError.value="";
  }catch(e){modelError.value="校正结果保存失败："+e.message;}
}
function replaceEvent(chapter, patch){
  const old=eventFor(chapter);
  const record={...old,chapterId:chapter.id,order:1,...patch,
    summary:patch.structured?.coreEvent || old?.summary || "",
    evidence:patch.structured?.coreEvent || old?.evidence || "",
    participants:patch.structured?.characters?.split("、") || old?.participants || []};
  props.studio.events=props.studio.events.filter(e=>e.chapterId!==chapter.id).concat(record);
}
function resolvedModel(){
  const value=modelChoice.value || models.value[0]?.value;
  if(!value)throw new Error("没有可用文本模型，请先配置文本模型");
  const result=parseModelValue(value);
  if(!models.value.some(m=>m.value===value))throw new Error("所选默认文本模型已不可用，请刷新模型列表重新选择");
  return result;
}
function stopAnalysis(){controller?.abort();}
function analyzeSelected(){
  // 未勾选时批量加入当前搜索范围内未完成的章节；勾选后可强制重做已完成章节。
  const ids=new Set(selectedIds.value);
  const targets=ids.size?props.studio.chapters.filter(ch=>ids.has(ch.id)):
    filteredChapters.value.filter(ch=>eventStatus(ch)!=="已完成");
  if(!targets.length){analysis.last="当前没有待分析章节。勾选已完成章节可强制重新分析。";return;}
  if(!confirm(`将 ${targets.length} 章加入文本生成队列（并发上限 ${currentLimits.value.concurrency}，失败最多自动重试 ${currentLimits.value.retries} 次）。已有成功结果仅在手动勾选时覆盖，模型调用会产生费用。确定吗？`))return;
  void enqueueChapters(targets,{force:ids.size>0});
}
function reanalyzeEditor(){
  const chapter=props.studio.chapters.find(x=>x.id===editor.value?.id);
  if(!chapter)return;
  editor.value=null;
  if(confirm(`确认重新分析「${chapter.title}」？将加入队列并覆盖该章结果。`))void enqueueChapters([chapter],{force:true});
}
function retryFailed(){
  const ids=new Set(queueItems.value.filter(job=>job.status==="failed").map(job=>job.id));
  const chapters=props.studio.chapters.filter(ch=>ids.has(ch.id));
  if(chapters.length && confirm(`将 ${chapters.length} 个失败章节重新排队，并重置其重试次数？`)) void enqueueChapters(chapters,{force:true});
}
async function enqueueChapters(chapters,{force=false}={}){
  let model,rule;
  try {
    model=resolvedModel();
    rule=snapshotEventRule(selectedRule.value);
  } catch(e){modelError.value=e.message;return;}
  const items=chapters.map(ch=>({id:ch.id,sourceHash:chapterFingerprint(ch),model,
    rule:{...rule},ruleDigest:rule.digest,kind:"text",title:ch.title}));
  enqueueTasks(props.studio,"text",items,{force});
  modelError.value="";
  try {emit("save");await props.context.flushSave();}
  catch(e){modelError.value="保存待生成队列失败，尚未启动："+e.message;return;}
  if(!analysis.running)void resumeQueue();
}
async function resumeQueue(){
  if(analysis.running || !props.studio.project)return;
  const scope=props.studio,startingPath=props.context.resource.path;
  const jobs=tasksFor(scope,"text");
  if(!jobs.some(job=>job.status==="queued"))return;
  try {if(!models.value.length)await refreshModels();}
  catch(e){modelError.value=e.message;return;}
  // 不允许在模型列表不可用时将所有待生成任务错误标记为失败。
  const pending=jobs.filter(job=>job.status==="queued");
  if(pending.some(job=>!models.value.some(m=>m.value===JSON.stringify([job.model?.providerId,job.model?.modelId])))){
    modelError.value="队列中存在不可用的文本模型。请先修复模型供应商，或选中章节重新提交任务。";
    return;
  }
  controller=new AbortController();
  const token=controller;
  analysis.running=true;analysis.last="";analysis.done=0;
  const inProject=()=>!token.signal.aborted && props.studio===scope && props.context.resource.path===startingPath;
  let batchSave=null;
  // 100 个并发任务可能在同一时间完成。合并短时间内的磁盘写入，避免每个完成事件重写整部小说。
  function persistBatch(){
    if(!inProject())return Promise.resolve();
    if(!batchSave){
      batchSave=new Promise((resolve,reject)=>setTimeout(async()=>{
        try{if(inProject()){emit("save");await props.context.flushSave();}resolve();}
        catch(e){reject(e);}
        finally{batchSave=null;}
      },40));
    }
    return batchSave;
  }
  try {
    // 队列可以在运行中追加任务；执行一轮后检查追加的任务并继续。
    while(inProject() && jobs.some(job=>job.status==="queued")) {
      const settings=normalizeQueueSettings(scope.project.queueSettings).text;
      const before=analysis.done;
      const result=await runTaskQueue({
        jobs,concurrency:settings.concurrency,retries:settings.retries,signal:token.signal,
        async execute(job,signal){
          if(!inProject())throw new Error("项目已切换，停止生成");
          const chapter=scope.chapters.find(ch=>ch.id===job.id);
          if(!chapter)throw new Error("该章节已删除");
          if(chapterFingerprint(chapter)!==job.sourceHash)throw new Error("章节原文已改变，请重新加入队列");
          return analyzeChapter(chapter,job.model,{signal,prompt:job.rule?.prompt});
        },
        onSuccess(job,result){
          if(!inProject())return;
          const chapter=scope.chapters.find(ch=>ch.id===job.id);
          if(!chapter || chapterFingerprint(chapter)!==job.sourceHash)throw new Error("章节内容已变更，结果不写回");
          replaceEvent(chapter,{id:eventFor(chapter)?.id || uid("event"),...result,status:"success",sourceHash:job.sourceHash,
            model:job.model,ruleId:job.rule?.id || DEFAULT_EVENT_RULE_ID,
            ruleName:job.rule?.name || "章节事件提取（标准7字段）",
            ruleDigest:job.rule?.digest || ruleFingerprint(job.rule?.prompt || rules.value[0]?.prompt),
            analyzedAt:new Date().toISOString(),lastError:"",manual:false});
        },
        onFailure(job,error){
          if(!inProject())return;
          const chapter=scope.chapters.find(ch=>ch.id===job.id);
          if(chapter)replaceEvent(chapter,{id:eventFor(chapter)?.id || uid("event"),status:"failed",
            lastError:error instanceof Error?error.message:String(error),failedRaw:typeof error?.raw==="string"?error.raw:undefined,
            attemptedAt:new Date().toISOString()});
        },
        persist:persistBatch,
        onProgress({completed}){analysis.done=before+completed;}
      });
      analysis.done=before+result.completed;
      if(result.cancelled)break;
    }
    analysis.last=token.signal.aborted ? "任务已暂停；未完成任务保留在本地队列，重新打开项目后可以续跑。" :
      `队列已处理完毕：成功 ${queueCounts.value.success}，失败 ${queueCounts.value.failed}。失败次数耗尽的任务可点击「重试失败」。`;
  }catch(e){modelError.value="队列执行已停止："+e.message;analysis.last="队列已暂停，请检查错误后继续。";}
  finally {
    for(const job of jobs)if(job.status==="running" || job.status==="retrying")job.status="queued";
    if(props.studio===scope && props.context.resource.path===startingPath){
      try{await batchSave;emit("save");await props.context.flushSave();}catch(e){modelError.value="队列状态保存失败："+e.message;}
    }
    if(controller===token){controller=null;analysis.running=false;}
  }
}
</script>

<style scoped>
.novel-manager{display:flex;flex-direction:column;min-height:calc(100vh - 210px);gap:12px}.novel-toolbar,.toolbar-left,.search-group,.novel-options,.novel-footer,.pages,.row-actions,.modal-heading,.modal-actions{display:flex;align-items:center;gap:12px}.novel-toolbar{justify-content:space-between;flex-wrap:wrap}.novel-manager button,.novel-action{font-size:13px;border:1px solid var(--el-border-color,#d8dce4);border-radius:5px;padding:8px 14px;cursor:pointer;white-space:nowrap;background:var(--el-fill-color,#f2f4f8);color:inherit}.novel-manager button:disabled{opacity:.45;cursor:not-allowed}.novel-action{display:inline-flex;align-items:center;justify-content:center;margin:0!important}.novel-action input{display:none}.novel-manager .primary-action,.search-group button{background:#0752d8;color:white;border-color:#0752d8}.novel-manager .delete-action{background:#f46d62;color:white;border-color:#f46d62}.novel-manager .analyze-action{background:#669de8;color:white;border-color:#669de8}.novel-manager .stop-action{border-color:#d07736;color:#d07736}.search-group{gap:10px}.search-group input{width:260px!important}.novel-manager input:not([type=checkbox]):not([type=file]),.novel-manager select,.novel-manager textarea{border-radius:5px!important;border:1px solid var(--el-border-color,#d8dce4)!important;padding:8px 10px;background:var(--el-bg-color,#fff);color:inherit;font:inherit}.novel-options{flex-wrap:wrap;font-size:12px;color:var(--el-text-color-secondary,#8a929e);gap:16px}.novel-options label{display:flex!important;align-items:center;flex-direction:row!important;gap:8px;margin:0!important}.novel-options label select{width:auto;min-width:120px;max-width:350px}.novel-options .plain-action{font-size:12px;padding:5px 9px}.model-hint{font-size:11px}.novel-error{color:#e65353;font-size:12px;margin:0;white-space:pre-wrap}.novel-table-wrap{flex:1;overflow:auto;min-height:300px}.novel-table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px}.novel-table th{text-align:left;font-weight:400;font-size:12px;color:var(--el-text-color-secondary,#999);background:var(--el-bg-color,#fff);padding:12px 10px;white-space:nowrap}.novel-table td{padding:13px 10px;border-bottom:1px solid var(--el-border-color-lighter,#e8e8e8);vertical-align:middle}.novel-table tbody tr:nth-child(odd){background:var(--el-fill-color-light,#f6f7f8)}.novel-table .check-col{width:46px}.novel-table .number-col{width:64px}.novel-table .volume-col{width:82px}.novel-table .title-col{width:150px}.novel-table .event-col{width:155px}.novel-table .operations-col{width:166px}.chapter-title,.chapter-excerpt{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chapter-excerpt{color:var(--el-text-color-secondary,#9ca2ab)}.novel-manager .status-button{padding:4px 0;border:0;background:transparent;font-size:12px}.status-button.failed{color:#ed4940}.status-button.completed{color:#1fa36a}.status-button.pending{color:#d58c21}.status-button.waiting{color:var(--el-text-color-secondary,#8993a2)}.novel-manager .row-actions button{border:0;background:transparent;padding:5px 2px;font-size:12px}.row-actions{gap:16px}.row-actions .edit-link{color:#0061df}.row-actions .remove-link{color:#ed4940}.novel-footer{justify-content:space-between;padding:12px 8px 0;font-size:12px;color:var(--el-text-color-secondary,#8993a2)}.pages select{padding:5px!important;min-width:98px}.pages button{padding:4px 11px}.table-empty{text-align:center;padding:50px!important;color:var(--el-text-color-secondary,#8993a2)}.analysis-progress{padding:12px;border:1px solid var(--el-border-color,#d9dfe8);border-radius:6px;font-size:12px}.progress-track{margin:8px 0;background:var(--el-fill-color-light,#e8edf4);height:5px;border-radius:8px;overflow:hidden}.progress-track div{height:100%;background:#2366d7;transition:width .2s}.novel-modal-mask{position:fixed;inset:0;background:#0009;z-index:2000;display:flex;align-items:center;justify-content:center;padding:24px}.novel-modal{width:min(980px,95vw);max-height:92vh;overflow:auto;background:var(--el-bg-color,#fff);color:var(--el-text-color-primary,#222);border:1px solid var(--el-border-color,#ddd);border-radius:12px;padding:22px;box-shadow:0 15px 60px #0005}.modal-heading{justify-content:space-between;margin-bottom:16px}.modal-heading h3{margin:0;font-size:19px}.modal-heading button{font-size:22px;border:0;background:transparent}.novel-modal label{display:flex!important;flex-direction:column!important;gap:9px;margin:12px 0!important}.novel-modal textarea{resize:vertical;min-height:150px;line-height:1.65}.novel-modal input{width:100%}.modal-actions{justify-content:flex-end;padding-top:8px}.subtle{color:var(--el-text-color-secondary,#8993a2);font-size:12px}
.rule-modal{width:min(1100px,95vw)}.rule-modal textarea{min-height:340px;max-height:55vh;font:13px/1.65 Consolas,"Microsoft YaHei",monospace!important;white-space:pre-wrap}.rule-modal .modal-actions .remove-link{color:#e35b5b;margin-right:auto}
@media(max-width:850px){.novel-toolbar{align-items:stretch}.search-group input{width:200px!important}.novel-table{min-width:800px}.novel-options{gap:8px}.model-hint{display:none}}
/* Compact novel/events workspace */
.novel-manager{gap:8px;min-height:0;font-size:12px}
.novel-toolbar,.toolbar-left,.search-group,.novel-options,.novel-footer,.pages,.row-actions{gap:7px}
.novel-toolbar{align-items:center}
.toolbar-left{flex-wrap:wrap}
.novel-manager button,.novel-action{padding:5px 9px;min-height:30px;font-size:12px;border-radius:6px}
.novel-manager input:not([type=checkbox]):not([type=file]),.novel-manager select{padding:5px 8px;min-height:31px;font-size:12px}
.search-group{gap:6px}
.search-group input{width:205px!important}
.novel-options{gap:7px 11px;font-size:11px}
.novel-options label{gap:5px}
.novel-options label select{min-width:100px;max-width:280px}
.novel-options .plain-action{padding:4px 8px}
.novel-table{font-size:12px}
.novel-table th{font-size:11px;padding:8px 8px}
.novel-table td{padding:8px 8px}
.novel-table .check-col{width:36px}
.novel-table .number-col{width:52px}
.novel-table .volume-col{width:68px}
.novel-table .title-col{width:142px}
.novel-table .event-col{width:115px}
.novel-table .operations-col{width:126px}
.novel-manager .row-actions button{padding:3px 0;font-size:11px}
.row-actions{gap:10px}
.novel-footer{padding:8px 2px 0;font-size:11px}
.novel-footer .pages{gap:5px}
.pages button{padding:3px 9px;min-height:28px}
.analysis-progress{padding:8px 10px}
.novel-modal-mask{padding:12px}
.novel-modal{width:min(850px,96vw);max-height:88vh;padding:15px 17px;border-radius:10px}
.rule-modal{width:min(940px,96vw)}
.modal-heading{margin-bottom:10px}
.modal-heading h3{font-size:16px}
.novel-modal label{gap:5px;margin:8px 0!important}
.novel-modal textarea{min-height:115px;padding:8px;line-height:1.6}
.rule-modal textarea{min-height:270px;max-height:54vh}
.modal-actions{gap:7px;padding-top:6px}
@media(max-width:850px){
  .search-group input{width:170px!important}
  .novel-toolbar{align-items:stretch}
  .novel-table{min-width:750px}
}
</style>
