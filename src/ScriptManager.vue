<template>
  <div class="script-studio">
    <header class="script-header">
      <div><h2>剧本工作台</h2><p>选章节、查看原文、编辑剧本，再用改写要求持续生成或修改</p></div>
      <div class="script-top-actions">
        <button type="button" @click="showLibrary=true">剧本库（{{studio.scripts.length}}）</button>
        <button type="button" :disabled="busy" @click="resetDraft">重置工作稿</button>
      </div>
    </header>
    <p v-if="error" class="script-error" role="alert">{{error}} <button @click="error=''">关闭</button></p>
    <section class="script-card script-config-bar" aria-label="改编配置">
      <strong class="config-caption">改编配置</strong>
      <label class="config-episode">集数<input v-model.number="workspace.episode" type="number" min="1" max="9999" step="1" :disabled="busy" @change="saveWorkspace"/></label>
      <label class="config-duration">目标时长（秒）<input v-model.number="workspace.targetSeconds" type="number" min="15" max="3600" step="5" :disabled="busy" @change="saveWorkspace"/></label>
      <label class="config-title">本集名称<input v-model="workspace.title" placeholder="可留空，保存时自动命名" :disabled="busy" @change="saveWorkspace"/></label>
      <label class="config-model">文本模型<select v-model="workspace.modelValue" :disabled="busy || modelsLoading" @change="saveWorkspace">
        <option value="">项目默认文本模型</option>
        <option v-for="m in models" :key="m.value" :value="m.value">{{m.providerLabel}} · {{m.label}}</option>
      </select></label>
      <button class="config-refresh" :disabled="busy || modelsLoading" @click="refreshModels">{{modelsLoading?'读取中…':'刷新模型'}}</button>
    </section>
    <section class="generation-workspace" aria-label="单页剧本编辑工作台">
      <aside class="script-card chapter-pane">
        <div class="card-top"><strong>章节目录</strong><span>{{selected.length}} 章已选</span></div>
        <input v-model="chapterQuery" class="filter-chapters" placeholder="搜索章节…" aria-label="搜索章节"/>
        <div class="chapters-tools">
          <button :disabled="busy" @click="selectAllFiltered">全选筛选</button>
          <button :disabled="busy || !workspace.chapterIds.length" @click="clearSelected">清空</button>
        </div>
        <div class="chapter-select-list">
          <label v-for="ch in filteredChapters" :key="ch.id" class="chapter-checkbox" :class="{selected:workspace.chapterIds.includes(ch.id)}">
            <input type="checkbox" :checked="workspace.chapterIds.includes(ch.id)" :disabled="busy" @change="toggleChapter(ch.id,$event.target.checked)"/>
            <span :title="ch.title">{{ch.title}}</span><small>{{ch.content?.length||0}} 字</small>
          </label>
          <p v-if="!filteredChapters.length" class="script-muted">{{studio.chapters.length?'没有匹配的章节':'请先在小说管理中导入原文'}}</p>
        </div>
        <div class="chapter-pane-footer">已选 {{sourceChars}} 字 · 可合并多章</div>
      </aside>
      <div class="workbench-right">
        <section class="script-card source-pane">
          <div class="card-top"><strong>小说原文</strong><span>{{selected.length}} 章 · {{sourceChars}} 字</span></div>
          <pre class="source-reading">{{sourcePreview||'在左侧章节目录中勾选章节，这里会实时展示完整原文。'}}</pre>
        </section>
        <section class="script-card draft-pane">
          <div class="card-top"><strong>剧本正文 <small>可直接编辑</small></strong>
            <span>{{workspace.text.length}} 字 · {{scriptSceneCount}} 场 · {{workspace.revisions.length}} 个版本</span>
          </div>
          <textarea v-model="workspace.text" class="draft-text" spellcheck="false" :disabled="busy"
            placeholder="可以直接撰写剧本，也可以保持空白，在下方输入改写要求后让 AI 生成完整剧本。"
            @change="saveWorkspace"/>
          <div class="draft-editor-footer">
            <details v-if="workspace.revisions.length" class="draft-version-menu">
              <summary>历史版本（{{workspace.revisions.length}}）</summary>
              <div class="draft-version-list">
                <button v-for="(version,i) in workspace.revisions" :key="i" :title="version.request"
                  :disabled="busy" @click="restoreVersion(i)">V{{i+1}} · {{version.request||'生成剧本'}}</button>
              </div>
            </details>
            <span v-else class="script-muted">格式：1-1 地点 日/夜 内/外</span>
            <div class="draft-editor-actions">
              <button :disabled="busy || saving" @click="saveDraftNow">{{saving?'保存中…':'保存工作稿'}}</button>
              <button class="action-confirm" :disabled="busy || saving || !workspace.text.trim()" @click="confirmScript">
                {{saving?'保存中…':'确认入库'}}
              </button>
            </div>
          </div>
        </section>
        <section class="script-card instruction-pane">
          <div class="card-top"><strong>AI 改写要求</strong><span>发送所选原文＋当前剧本＋本轮要求</span></div>
          <textarea v-model="workspace.feedback" class="workbench-instruction-input" rows="2" :disabled="busy"
            placeholder="例如：保留原著台词、前三秒制造冲突、将第二场改得更紧凑。剧本为空也能生成。"
            @change="saveWorkspace"/>
          <div class="instruction-actions">
            <span class="script-muted">{{workspace.text.trim()?'根据当前正文修改，输出完整剧本':'当前剧本为空，将生成首稿'}}</span>
            <button v-if="busy" @click="cancelGenerate">停止生成</button>
            <button class="action-primary" :disabled="busy || saving || !selected.length || !workspace.feedback.trim()" @click="requestRewrite">
              {{busy?'AI 生成中…':'发送 AI 生成 / 改写'}}
            </button>
          </div>
        </section>
      </div>
    </section>
    <p v-if="busy" class="script-working"><span class="spinner"></span> {{workingLabel}} · 生成完成后会更新完整剧本；旧版本可从历史中恢复。</p>
    <div v-if="showLibrary" class="script-library-overlay" @click.self="showLibrary=false" @wheel.stop @pointerdown.stop>
    <section class="script-card manage-section">
      <div class="manage-top"><div><h3>已入库剧本</h3><p class="script-muted">勾选多集后可批量导出 TXT 压缩包，或交给文本模型提取角色、场景、道具。</p></div><input v-model="scriptQuery" placeholder="搜索集数、标题、原文章节…" /><button @click="showLibrary=false">关闭 ×</button></div>
      <div class="batch-toolbar"><span>已选择 {{ selectedScriptIds.length }} 集</span><button @click="chooseVisible">选择筛选结果</button><button @click="selectedScriptIds=[]">取消选择</button><button class="action-primary" :disabled="!selectedScriptIds.length" @click="exportSelected">批量导出 ZIP</button><button class="action-primary" :disabled="!selectedScriptIds.length" @click="extractSelected">提取所选剧本资产 →</button></div>
      <div class="script-table-wrap"><table class="script-table"><thead><tr><th><input type="checkbox" :checked="filteredScripts.length>0 && filteredScripts.every(s=>selectedScriptIds.includes(s.id))" @change="toggleVisible($event.target.checked)" /></th><th>集数</th><th>剧本名称</th><th>来源章节</th><th>目标时长</th><th>场次</th><th>状态</th><th>操作</th></tr></thead>
        <tbody><tr v-for="s in filteredScripts" :key="s.id"><td><input type="checkbox" :checked="selectedScriptIds.includes(s.id)" @change="toggleScript(s.id,$event.target.checked)" /></td><td>第{{ s.episode }}集</td><td class="script-name" :title="s.title">{{ s.title }}</td><td class="sources-cell" :title="sourceNames(s)">{{ sourceNames(s) }}</td><td>{{ s.targetSeconds ? s.targetSeconds+'秒' : '未设置' }}</td><td>{{ s.scenes?.length || '—' }}</td><td>{{ s.status }}</td><td class="manage-actions"><button @click="inspectScript(s)">查看 / 编辑</button><button class="danger" @click="removeScript(s)">删除</button></td></tr>
          <tr v-if="!filteredScripts.length"><td colspan="8" class="no-scripts">尚无已确认的剧本。在「剧本生成」中完成初稿、修改并确认后，会自动出现于此。</td></tr>
        </tbody></table></div>
    </section>


    </div>
    <div v-if="manageEditor" class="script-editor-overlay" @wheel.stop @pointerdown.stop>
      <div class="full-editor">
        <header><div><strong>编辑第{{ manageEditor.episode }}集</strong><p>已入库剧本 · 修改后同步更新场次数据，已有分镜不会被静默覆盖</p></div><button :disabled="saving" @click="manageEditor=null">关闭 ×</button></header>
        <div class="editor-fields"><label>名称 <input v-model="manageEditor.title" :disabled="saving" /></label><label>状态 <select v-model="manageEditor.status" :disabled="saving"><option>草稿</option><option>审核中</option><option>已定稿</option></select></label><span>{{ manageEditor.text.length }} 字</span></div>
        <textarea v-model="manageEditor.text" class="full-text" spellcheck="false" :disabled="saving" />
        <footer><p class="script-muted">场次格式：1-1 苏鸾寝殿 夜 内；动作以 △ 开头，对白以「角色：台词」排列。</p><button :disabled="saving" @click="manageEditor=null">取消</button><button class="action-primary" :disabled="saving" @click="saveManagedScript">{{ saving?'正在保存…':'保存修改' }}</button></footer>
      </div>
    </div>
  </div>
</template>

<script setup>
import {computed,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue';
import {loadTextModels} from './eventAnalysis.mjs';
import {parseModelValue} from './generation.mjs';
import {nextEpisode,selectedChapters,sourceSignature,draftPreviewSource,generateScript,makeEpisodeScript,
  validateDraftSettings,validateScriptText,writeEpisodeFile} from './scriptGeneration.mjs';
import {parseScriptScenes} from './studio.mjs';
import {makeScriptsZip} from './scriptZip.mjs';

const props=defineProps({studio:{type:Object,required:true},context:{type:Object,required:true}});
const emit=defineEmits(['save','scriptsChanged','extractAssets']);
const showLibrary=ref(false),chapterQuery=ref(''),scriptQuery=ref('');
const models=ref([]),modelsLoading=ref(false),error=ref(''),busy=ref(false),saving=ref(false),workingLabel=ref('');
const manageEditor=ref(null);
const selectedScriptIds=ref([]);
const defaults=()=>({chapterIds:[],episode:nextEpisode(props.studio.scripts),targetSeconds:120,modelValue:'',title:'',text:'',feedback:'',revisions:[],sourceHash:'',lastModel:null});
const workspace=reactive(defaults());
let controller=null;
function hydrate(){
  Object.assign(workspace,defaults(),props.studio.scriptWorkspace||{});
  workspace.chapterIds=Array.isArray(workspace.chapterIds)?workspace.chapterIds.filter(id=>props.studio.chapters.some(ch=>ch.id===id)):[];
  workspace.revisions=Array.isArray(workspace.revisions)?workspace.revisions:[];
}
hydrate();
watch(()=>props.studio,hydrate);
const filteredChapters=computed(()=>props.studio.chapters.filter(ch=>ch.title.toLowerCase().includes(chapterQuery.value.trim().toLowerCase())));
const selected=computed(()=>props.studio.chapters.filter(ch=>workspace.chapterIds.includes(ch.id)).sort((a,b)=>a.order-b.order));
const sourceChars=computed(()=>selected.value.reduce((n,ch)=>n+(ch.content?.length||0),0));
const sourcePreview=computed(()=>selected.value.length?draftPreviewSource(selected.value):'');
const scriptSceneCount=computed(()=>workspace.text.split('\n').filter(s=>/^\d+-\d+\s+.+\s+(日|夜)\s+(内|外)\s*$/u.test(s)).length);
const filteredScripts=computed(()=>props.studio.scripts.filter(s=>(String(s.title||'')+' '+s.episode+' '+sourceNames(s)).toLowerCase().includes(scriptQuery.value.trim().toLowerCase())).sort((a,b)=>a.episode-b.episode));
function toggleScript(id,checked){selectedScriptIds.value=checked?[...new Set([...selectedScriptIds.value,id])]:selectedScriptIds.value.filter(x=>x!==id);}
function toggleVisible(checked){const ids=new Set(filteredScripts.value.map(x=>x.id));selectedScriptIds.value=checked?[...new Set([...selectedScriptIds.value,...ids])]:selectedScriptIds.value.filter(x=>!ids.has(x));}
function chooseVisible(){toggleVisible(true);}
function exportSelected(){
  try{
    const chosen=props.studio.scripts.filter(s=>selectedScriptIds.value.includes(s.id)).sort((a,b)=>a.episode-b.episode);
    const data=makeScriptsZip(chosen);
    const url=URL.createObjectURL(new Blob([data],{type:'application/zip'}));
    const a=document.createElement('a');a.href=url;
    a.download=(props.studio.project?.name||'剧本')+'-'+chosen.length+'集剧本.zip';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    error.value='';
  }catch(e){error.value='导出剧本失败：'+e.message;}
}
function extractSelected(){
  const selected=props.studio.scripts.filter(s=>selectedScriptIds.value.includes(s.id));
  if(!selected.length){error.value='请选择需要提取资产的剧本';return;}
  emit('extractAssets',selected.map(s=>s.id));
}
function sourceNames(s){return s.sourceChapterTitles?.join('、') || props.studio.chapters.filter(ch=>(s.chapterIds||[s.chapterId]).includes(ch.id)).map(ch=>ch.title).join('、') || '旧版来源未知';}
function saveWorkspace(){
  props.studio.scriptWorkspace=JSON.parse(JSON.stringify(workspace));emit('save');
}
function toggleChapter(id,checked){workspace.chapterIds=checked?[...new Set([...workspace.chapterIds,id])]:workspace.chapterIds.filter(item=>item!==id);saveWorkspace();}
function selectAllFiltered(){workspace.chapterIds=[...new Set([...workspace.chapterIds,...filteredChapters.value.map(ch=>ch.id)])];saveWorkspace();}
function clearSelected(){workspace.chapterIds=[];saveWorkspace();}
async function refreshModels(){
  modelsLoading.value=true;
  try{models.value=await loadTextModels();if(!models.value.length)error.value='未找到可用文本模型，请先配置供应商';}
  catch(e){error.value='读取文本模型失败：'+e.message;}finally{modelsLoading.value=false;}
}
onMounted(refreshModels);
onBeforeUnmount(()=>controller?.abort());
function chosenModel(){
  // 每轮可独立切换文本模型，当前剧本为空或已有正文均可生成。
  const value=workspace.modelValue || props.studio.project?.generation?.text?.model || models.value[0]?.value;
  if(!value)throw new Error('没有可用文本模型，请在项目设置或本页选择');
  if(!models.value.some(m=>m.value===value))throw new Error('所选文本模型不在当前可用列表，请刷新模型或修改设置');
  return parseModelValue(value);
}
function checkedSource(){
  const chapters=selectedChapters(props.studio.chapters,workspace.chapterIds);
  validateDraftSettings({episode:workspace.episode,targetSeconds:workspace.targetSeconds,chapters});
  if(props.studio.scripts.some(s=>Number(s.episode)===Number(workspace.episode)))throw new Error(`第${workspace.episode}集已入库，请调整集数以免覆盖`);
  return chapters;
}
async function requestRewrite(){
  if(busy.value || saving.value)return;
  let chapters,model;
  try{
    chapters=checkedSource();model=chosenModel();
    if(!workspace.feedback.trim())throw new Error('请先填写改写要求');
  }catch(e){error.value=e.message;return;}
  const currentText=workspace.text;
  const feedback=workspace.feedback.trim();
  const episode=Number(workspace.episode),targetSeconds=Number(workspace.targetSeconds);
  error.value='';busy.value=true;
  workingLabel.value=currentText.trim()?'正在按原文、当前剧本和改写要求生成完整新版本':'正在根据选中章节和改写要求生成首稿';
  const studioRef=props.studio,resource=props.context.resource.path;
  controller=new AbortController();const token=controller;
  const signature=sourceSignature(chapters);
  try{
    const text=await generateScript({chapters,episode,targetSeconds,currentText,feedback,model,workbench:true,signal:token.signal});
    if(token.signal.aborted || props.studio!==studioRef || resource!==props.context.resource.path)
      throw new Error('项目已切换或任务已取消，未覆盖工作稿');
    if(sourceSignature(selectedChapters(props.studio.chapters,workspace.chapterIds))!==signature ||
       Number(workspace.episode)!==episode || Number(workspace.targetSeconds)!==targetSeconds)
      throw new Error('原文或配置在生成期间变化，未覆盖工作稿');
    if(workspace.text!==currentText)throw new Error('剧本正文在生成期间被编辑，未覆盖工作稿');
    workspace.text=text;workspace.sourceHash=signature;workspace.lastModel=model;
    workspace.revisions=[...workspace.revisions,{request:feedback,text,at:new Date().toISOString()}].slice(-30);
    workspace.feedback='';saveWorkspace();await props.context.flushSave();
  }catch(e){if(!token.signal.aborted)error.value='AI 改写失败：'+e.message;}
  finally{busy.value=false;if(controller===token)controller=null;}
}
async function saveDraftNow(){
  if(busy.value||saving.value)return;
  const scope=props.studio,resource=props.context.resource.path;
  saving.value=true;error.value='';
  try{
    saveWorkspace();await props.context.flushSave();
    if(props.studio!==scope||props.context.resource.path!==resource)throw new Error('保存期间项目已切换');
    workingLabel.value='工作稿已保存到当前项目';
  }catch(e){error.value='保存工作稿失败：'+e.message;}
  finally{saving.value=false;}
}
function cancelGenerate(){controller?.abort();}
function restoreVersion(i){
  const version=workspace.revisions[i];
  if(!version || busy.value)return;
  if(workspace.text!==version.text && !confirm(`恢复到 V${i+1}？当前未保存到历史版本的手动改动将被覆盖。`))return;
  workspace.text=version.text;saveWorkspace();
}
function resetDraft(){
  if(busy.value)return;
  if(workspace.text && !confirm('清空当前工作稿及历史修改记录？已经入库的剧本不会删除。'))return;
  Object.assign(workspace,defaults());saveWorkspace();error.value='';
}
async function confirmScript(){
  if(busy.value || saving.value)return;
  let draft;
  try{
    const chapters=checkedSource();
    if(!workspace.text.trim())throw new Error('尚未生成或编辑剧本');
    draft=makeEpisodeScript({chapters,episode:workspace.episode,targetSeconds:workspace.targetSeconds,
      requirements:workspace.revisions.at(-1)?.request||'',text:workspace.text,title:workspace.title,
      model:workspace.lastModel||null,revisions:workspace.revisions});
    draft.sourceEventIds=props.studio.events.filter(e=>draft.chapterIds.includes(e.chapterId)).map(e=>e.id);
  }catch(e){error.value='无法确认剧本：'+e.message;return;}
  if(!confirm(`确认将「${draft.title}」保存为正式第 ${draft.episode} 集？将写入项目剧本库与独立剧本文本文件。`))return;
  const scope=props.studio,resource=props.context.resource.path;
  saving.value=true;error.value='';
  try{
    draft.filePath=await writeEpisodeFile(props.context.files,resource,draft);
    if(props.studio!==scope || props.context.resource.path!==resource)throw new Error('项目已切换，拒绝写入其他项目');
    if(scope.scripts.some(s=>s.episode===draft.episode))throw new Error('此集数已经存在，请更换集数');
    scope.scripts.push(draft);
    delete scope.scriptWorkspace;
    emit('save');await props.context.flushSave();
    Object.assign(workspace,defaults());
    emit('scriptsChanged');
  }catch(e){error.value='正式保存失败：'+e.message+'。未确认写入成功时请检查项目及剧本列表。';}
  finally{saving.value=false;}
}
function inspectScript(s){error.value='';manageEditor.value={id:s.id,title:s.title,episode:s.episode,status:s.status,text:s.text};}
async function saveManagedScript(){
  if(saving.value || !manageEditor.value)return;
  const scope=props.studio,resource=props.context.resource.path;
  const original=props.studio.scripts.find(s=>s.id===manageEditor.value.id);
  if(!original){error.value='剧本已不存在';return;}
  let text;
  try{
    text=validateScriptText(manageEditor.value.text,original.episode);
    if(!manageEditor.value.title.trim())throw new Error('请填写剧本标题');
    if(props.studio.panels.some(p=>p.scriptId===original.id) && text!==original.text &&
      !confirm('此剧本已有分镜：修改正文不会自动覆盖旧分镜。保存后请到分镜面板手动重新生成对应分镜。继续吗？'))return;
  }catch(e){error.value=e.message;return;}
  saving.value=true;error.value='';
  try{
    // 编辑已有剧本仍更新原 TXT 文件，不重复新建一集。
    const filePath=await writeEpisodeFile(props.context.files,resource,{...original,text});
    if(props.studio!==scope || props.context.resource.path!==resource)throw new Error('项目已切换，拒绝将编辑结果写入其他项目');
    Object.assign(original,{title:manageEditor.value.title.trim(),status:manageEditor.value.status,
      text,filePath,scenes:parseScriptScenes(text,original.episode),updatedAt:new Date().toISOString()});
    emit('save');await props.context.flushSave();manageEditor.value=null;emit('scriptsChanged');
  }catch(e){error.value='保存修改失败：'+e.message;}
  finally{saving.value=false;}
}
function removeScript(s){
  if(saving.value)return;
  const linked=props.studio.panels.some(p=>p.scriptId===s.id);
  if(!confirm(`确定从剧本库删除「${s.title}」？${linked?'\n相关分镜也会从项目中移除，已生成的画布节点不会自动删除。':''}\n本地独立 TXT 文件作为历史备份保留。`))return;
  props.studio.scripts=props.studio.scripts.filter(x=>x.id!==s.id);
  props.studio.assetMentions=(props.studio.assetMentions||[]).filter(m=>m.scriptId!==s.id);
  props.studio.assets.forEach(a=>{if(Array.isArray(a.scriptIds))a.scriptIds=a.scriptIds.filter(id=>id!==s.id);});
  selectedScriptIds.value=selectedScriptIds.value.filter(id=>id!==s.id);
  props.studio.panels=props.studio.panels.filter(p=>p.scriptId!==s.id);
  emit('save');emit('scriptsChanged');
}
</script>

<style scoped>
.script-studio{display:flex;flex-direction:column;gap:16px;min-height:calc(100vh - 175px);color:var(--el-text-color-primary,#e6eaf0)}
.script-header,.card-top,.script-tabs,.chapters-tools,.duration-presets,.generate-actions,.revision-actions,.manage-top,.manage-actions,.full-editor header,.full-editor footer{display:flex;align-items:center;justify-content:space-between;gap:12px}
.script-header h2{font-size:21px;margin:0 0 5px}.script-header p,.script-muted{color:var(--el-text-color-secondary,#8c99aa);font-size:12px;line-height:1.6;margin:4px 0}
.script-tabs{background:var(--el-fill-color,#222a38);padding:4px;border-radius:9px;justify-content:start}.script-tabs button{border:0;border-radius:6px;padding:9px 18px;background:transparent}.script-tabs button.active{background:#326dd1;color:white}.script-tabs span{opacity:.7}
.generation-workspace{display:grid;grid-template-columns:minmax(320px,38%) minmax(360px,1fr);gap:17px;align-items:start}.settings-column,.draft-column{min-width:0;display:flex;flex-direction:column;gap:15px}
.script-card{border:1px solid var(--el-border-color,#3a4354);border-radius:12px;padding:17px;background:var(--el-fill-color-blank,#1b222d)}.card-top{padding-bottom:14px}.card-top strong{font-size:15px}.card-top span{font-size:11px;color:var(--el-text-color-secondary,#929eb0)}
.script-studio input:not([type=checkbox]),.script-studio select,.script-studio textarea{width:100%;box-sizing:border-box;min-width:0;padding:10px;border:1px solid var(--el-border-color,#3a4354);background:var(--el-fill-color,#141a22);color:inherit;border-radius:7px;font:inherit}
.script-studio textarea{resize:vertical;line-height:1.7}.script-studio label:not(.chapter-checkbox){display:flex;flex-direction:column;gap:6px;font-size:12px;margin:0 0 14px}.script-studio button{cursor:pointer;border:1px solid var(--el-border-color,#3a4354);background:var(--el-fill-color,#2a3340);color:inherit;padding:8px 12px;border-radius:7px;font-size:12px}.script-studio button:disabled{opacity:.45;cursor:not-allowed}.script-studio .action-primary{background:#2865cc;border-color:#2865cc;color:white}.script-studio .action-confirm{background:#16784f;color:white;border-color:#16784f}.script-studio button.active{border-color:#4384eb;color:#9bc1ff}.script-studio button.danger{color:#e18383}
.filter-chapters{margin-bottom:8px}.chapters-tools{justify-content:flex-start;flex-wrap:wrap;margin-bottom:10px}.chapters-tools button{padding:6px 8px}.chapters-tools span{font-size:11px;color:var(--el-text-color-secondary,#96a1b4)}.chapter-select-list{max-height:255px;overflow-y:auto;border:1px solid var(--el-border-color,#35404d);border-radius:6px}
.chapter-checkbox{display:flex;align-items:center!important;flex-direction:row!important;gap:10px;margin:0!important;padding:9px 12px;border-bottom:1px solid var(--el-border-color-light,#29323e);cursor:pointer;font-size:12px}.chapter-checkbox input{flex:0 0 auto}.chapter-checkbox span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chapter-checkbox small{color:var(--el-text-color-secondary,#939fb2);white-space:nowrap}.source-preview{margin-top:12px}.source-preview summary{cursor:pointer;font-size:12px;padding:8px;background:var(--el-fill-color,#202833);border-radius:6px}.source-preview summary span{float:right;opacity:.65}.source-preview pre{font:12px/1.8 'Microsoft YaHei',sans-serif;white-space:pre-wrap;overflow:auto;max-height:320px;margin:10px 0;padding:12px;background:var(--el-fill-color,#161c25);border-radius:7px}
.two-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.duration-presets{justify-content:flex-start;gap:6px;margin:-7px 0 16px}.duration-presets button{padding:4px 9px}.generate-actions,.revision-actions{justify-content:flex-start;flex-wrap:wrap}.generate-actions .action-primary{flex:1}.script-studio button.text-link{border:0;background:transparent;color:#76aaff;padding:0;margin:-10px 0 14px}
.draft-card{min-height:660px}.draft-text{height:480px;min-height:340px;width:100%;font:13px/1.8 'Microsoft YaHei',sans-serif!important;white-space:pre-wrap}.draft-summary{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.draft-summary span{font-size:12px;padding:5px 9px;border-radius:5px;background:var(--el-fill-color,#263243)}.revision-zone{margin-top:17px}.revisions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:16px 0 0;border-top:1px solid var(--el-border-color,#3e4755);padding-top:16px}.revisions>strong{font-size:12px;min-width:100%}.revisions button{max-width:225px;text-overflow:ellipsis;overflow:hidden}.script-working{font-size:12px;color:#93bcf6;margin-top:12px}.spinner{display:inline-block;width:12px;height:12px;border:2px solid #345783;border-top-color:#aaccf9;border-radius:50%;vertical-align:middle;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.script-error{border-radius:8px;padding:10px 12px;background:#592e2e;color:#ffd3d0;display:flex;gap:12px;align-items:center;justify-content:space-between;white-space:pre-wrap}.manage-section{min-height:500px}.manage-top h3{margin:0}.manage-top input{max-width:280px}.script-table-wrap{width:100%;overflow:auto}.script-table{width:100%;border-collapse:collapse;font-size:12px;min-width:790px}.script-table th,.script-table td{padding:14px 10px;text-align:left;border-bottom:1px solid var(--el-border-color-light,#37404d)}.script-table th{color:var(--el-text-color-secondary,#94a0b1);font-weight:400}.script-name{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sources-cell{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.manage-actions{justify-content:flex-start}.no-scripts{text-align:center;padding:70px 10px!important;color:var(--el-text-color-secondary,#96a1b3)}
.batch-toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:14px 0}.batch-toolbar span{color:var(--el-text-color-secondary,#939eaf);font-size:12px}.script-table input[type=checkbox]{accent-color:#347cdc}
.script-editor-overlay{position:fixed;inset:0;z-index:2100;background:var(--el-bg-color,#171c25);padding:24px;display:flex}.full-editor{display:flex;flex-direction:column;max-width:1400px;width:100%;height:100%;margin:auto;gap:16px}.full-editor header{border-bottom:1px solid var(--el-border-color,#3a4354);padding-bottom:12px}.full-editor header strong{font-size:20px}.full-editor header p{font-size:12px;color:var(--el-text-color-secondary,#94a2b7)}.editor-fields{display:flex;align-items:end;gap:15px}.editor-fields label:first-child{flex:1}.editor-fields label:nth-child(2){width:150px}.full-editor .full-text{flex:1;min-height:0;resize:none;font:14px/1.8 'Microsoft YaHei',sans-serif}.full-editor footer{padding-bottom:8px}.full-editor footer p{flex:1}
@media(max-width:1050px){.generation-workspace{grid-template-columns:1fr}.draft-card{min-height:500px}.draft-text{height:420px}}
/* Compact writing workspace: prioritize editable script text over chrome. */
.script-studio{gap:10px;min-height:0;font-size:12px}
.script-header,.card-top,.script-tabs,.chapters-tools,.duration-presets,.generate-actions,.revision-actions,.manage-top,.manage-actions{gap:8px}
.script-header h2{font-size:18px;margin-bottom:3px}
.script-header p,.script-muted{font-size:11px;line-height:1.5;margin:3px 0}
.script-tabs{padding:3px;border-radius:7px}
.script-tabs button{padding:6px 10px}
.generation-workspace{grid-template-columns:minmax(270px,34%) minmax(350px,1fr);gap:11px}
.settings-column,.draft-column{gap:10px}
.script-card{padding:12px 13px;border-radius:9px}
.card-top{padding-bottom:9px}
.card-top strong{font-size:13px}
.script-studio input:not([type=checkbox]),.script-studio select{padding:6px 8px;min-height:32px;font-size:12px}
.script-studio textarea{padding:7px 8px;font-size:12px;line-height:1.6}
.script-studio label:not(.chapter-checkbox){gap:4px;margin-bottom:9px}
.script-studio button{padding:5px 9px;min-height:30px;font-size:12px;border-radius:6px}
.chapter-select-list{max-height:205px}
.chapter-checkbox{padding:6px 9px;gap:7px;font-size:11px}
.chapters-tools{gap:6px;margin-bottom:7px}
.chapters-tools button{padding:4px 7px;min-height:26px}
.source-preview{margin-top:8px}
.source-preview summary{padding:6px}
.source-preview pre{max-height:235px;padding:9px;margin:7px 0}
.two-fields{gap:8px}
.duration-presets{margin:-3px 0 10px}
.duration-presets button{padding:3px 7px;min-height:25px}
.generate-actions,.revision-actions{gap:7px}
.draft-card{min-height:475px}
.draft-text{height:365px;min-height:285px;font:12px/1.7 'Microsoft YaHei',sans-serif!important}
.draft-summary{gap:5px;margin-bottom:8px}
.draft-summary span{font-size:11px;padding:3px 6px}
.revision-zone{margin-top:11px}
.revisions{gap:6px;margin-top:10px;padding-top:10px}
.script-working{margin-top:8px}
.manage-section{min-height:330px}
.manage-top input{max-width:230px}
.script-table th,.script-table td{padding:8px 8px}
.script-table{font-size:11px;min-width:760px}
.batch-toolbar{margin:9px 0;gap:7px}
.no-scripts{padding:35px 10px!important}
.script-editor-overlay{align-items:center;justify-content:center;background:rgba(17,27,43,.62);padding:12px}
.full-editor{height:min(84vh,820px);min-height:440px;width:min(1080px,100%);max-width:1080px;margin:auto;gap:10px;padding:14px 16px;background:var(--el-bg-color,#fff);border:1px solid var(--el-border-color,#3b434e);border-radius:11px;box-shadow:0 20px 70px #0005}
.full-editor header{padding-bottom:9px}
.full-editor header strong{font-size:17px}
.full-editor header p{font-size:11px;margin:3px 0}
.editor-fields{gap:9px}
.full-editor .full-text{min-height:0;font:13px/1.7 'Microsoft YaHei',sans-serif}
.full-editor footer{padding-bottom:0}
@media(max-width:1050px){
  .generation-workspace{grid-template-columns:1fr}
  .draft-card{min-height:390px}
  .draft-text{height:320px;min-height:260px}
}
@media(max-width:680px){
  .script-editor-overlay{padding:6px}
  .full-editor{height:calc(100vh - 12px);min-height:0;padding:10px}
  .script-header{flex-wrap:wrap}
}

/* One-screen adaptation workbench: compact config row, chapter directory,
   live source preview, editable script, short instruction composer. */
.script-studio{height:calc(100vh - 144px);max-height:calc(100vh - 144px);min-height:500px;min-width:0;gap:8px;overflow:hidden;display:flex;flex-direction:column}
.script-header{flex:none;gap:12px;min-height:42px}
.script-header h2{font-size:17px;margin:0}
.script-header p{margin:2px 0 0;font-size:11px}
.script-top-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.script-studio .script-config-bar{flex:none;display:grid;grid-template-columns:auto 84px 116px minmax(145px,1fr) minmax(175px,1.25fr) auto;align-items:end;gap:10px;padding:9px 12px;min-width:0}
.script-config-bar .config-caption{font-size:12px;align-self:center;white-space:nowrap;padding-bottom:0}
.script-studio .script-config-bar label{display:flex;flex-direction:column;gap:3px;margin:0;min-width:0;font-size:11px;white-space:nowrap}
.script-studio .script-config-bar input,.script-studio .script-config-bar select{min-width:0;width:100%;box-sizing:border-box;height:32px;min-height:32px;padding:5px 7px;font-size:12px}
.script-studio .script-config-bar .config-refresh{white-space:nowrap;height:32px}
.script-studio .generation-workspace{display:grid;grid-template-columns:minmax(200px,244px) minmax(0,1fr);flex:1;min-height:0;min-width:0;gap:10px;align-items:stretch;overflow:hidden}
.script-studio .chapter-pane,.script-studio .source-pane,.script-studio .draft-pane,.script-studio .instruction-pane{display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden;padding:10px 11px}
.chapter-pane .card-top,.source-pane .card-top,.draft-pane .card-top,.instruction-pane .card-top{flex:none;gap:8px;padding-bottom:6px}
.script-studio .card-top span{font-size:10px;white-space:nowrap}
.script-studio .filter-chapters{flex:none;margin-bottom:6px}
.script-studio .chapter-pane .chapters-tools{flex:none;margin:0 0 6px;gap:6px}
.script-studio .chapter-pane .chapter-select-list{flex:1;max-height:none;min-height:0;overflow:auto}
.chapter-checkbox.selected{background:var(--el-color-primary-light-9,#eaf3ff)}
.script-studio .chapter-checkbox{padding:7px 8px;min-height:30px;gap:6px}
.script-studio .chapter-checkbox small{font-size:10px}
.chapter-pane-footer{flex:none;margin-top:7px;color:var(--el-text-color-secondary,#93a0b0);font-size:10px}
.script-studio .workbench-right{display:grid;grid-template-rows:minmax(100px,.8fr) minmax(175px,1.85fr) minmax(130px,auto);gap:9px;min-width:0;min-height:0;overflow:hidden}
.script-studio .source-reading{flex:1;min-height:0;max-height:none;margin:0;overflow:auto;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--el-border-color-light,#e5eaf1);border-radius:6px;background:var(--el-fill-color-light,#f7f9fc);color:var(--el-text-color-primary,#303944);font:12px/1.75 'Microsoft YaHei',sans-serif}
.script-studio .draft-pane .draft-text{flex:1;display:block;min-height:0;height:auto;max-height:none;width:100%;resize:none;padding:9px 11px;font:12px/1.75 'Microsoft YaHei',sans-serif!important}
.draft-pane .card-top small{font-size:10px;font-weight:400;color:var(--el-text-color-secondary,#8c98a7);margin-left:4px}
.script-studio .draft-editor-footer{flex:none;display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:31px;padding-top:7px}
.script-studio .draft-editor-actions{display:flex;gap:6px;flex:none}
.script-studio .draft-editor-footer .script-muted{margin:0;font-size:10px}
.draft-version-menu{position:relative;min-width:0}
.draft-version-menu summary{font-size:11px;cursor:pointer;white-space:nowrap}
.draft-version-menu[open] .draft-version-list{position:absolute;bottom:26px;left:0;z-index:3;max-height:180px;overflow:auto;min-width:240px;width:300px;max-width:min(70vw,300px);padding:6px;border:1px solid var(--el-border-color,#d7e0ee);border-radius:7px;background:var(--el-bg-color,#fff);box-shadow:0 4px 18px #0004}
.script-studio .draft-version-list button{display:block;text-align:left;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:3px 0}
.script-studio .instruction-pane{gap:0;padding-top:8px;padding-bottom:8px}
.script-studio .instruction-pane .card-top{padding-bottom:5px}
.script-studio .instruction-pane .workbench-instruction-input{flex:none;min-height:54px;height:54px;max-height:54px;resize:none;padding:7px 9px;font:12px/1.55 'Microsoft YaHei',sans-serif}
.script-studio .instruction-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;margin-top:7px}
.instruction-actions .script-muted{margin:0;font-size:10px;line-height:1.4;flex:1}
.instruction-actions .action-primary{white-space:nowrap;flex:none}
.script-studio .script-error{flex:none;min-height:35px;margin:0;padding:7px 10px}
.script-studio .script-working{flex:none;margin:0;font-size:11px}
.script-library-overlay{position:fixed;inset:0;z-index:2147481000;padding:24px;display:flex;align-items:center;justify-content:center;background:rgba(13,24,40,.64);box-sizing:border-box}
.script-library-overlay .manage-section{max-height:calc(100vh - 48px);width:min(1240px,100%);min-height:0;margin:0;overflow:auto;background:var(--el-bg-color,#fff);box-shadow:0 18px 64px #0005}
.script-library-overlay .manage-top{gap:12px}
.script-library-overlay .manage-top>input{flex:1;max-width:290px}
.script-library-overlay .manage-top>button{white-space:nowrap}
.script-studio .script-editor-overlay{z-index:2147481100}
@media(max-width:1150px){
  .script-studio .script-config-bar{grid-template-columns:auto 78px 110px minmax(120px,1fr) minmax(145px,1.2fr) auto;gap:7px}
  .script-studio .generation-workspace{grid-template-columns:205px minmax(0,1fr)}
}
@media(max-width:830px){
  .script-studio{height:auto;max-height:none;min-height:0;overflow:visible}
  .script-studio .script-config-bar{grid-template-columns:repeat(2,minmax(0,1fr))}
  .script-studio .script-config-bar .config-caption{grid-column:1/-1}
  .script-studio .generation-workspace{display:flex;flex-direction:column;overflow:visible}
  .script-studio .chapter-pane .chapter-select-list{max-height:180px}
  .script-studio .workbench-right{display:flex;flex-direction:column;overflow:visible}
  .script-studio .source-reading{min-height:140px;max-height:220px}
  .script-studio .draft-pane .draft-text{min-height:290px;height:290px;flex:auto}
}
</style>
