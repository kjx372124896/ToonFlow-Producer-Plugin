<template>
  <div class="settings-root">
    <div class="project-header">
      <div><h2>项目设置</h2><p>每个项目独立存储在当前无限画布工作区的本地文件夹中</p></div>
      <div class="toolbar project-header-actions">
        <button v-if="project && !creating" @click="startCreating">＋ 新建项目</button>
        <button v-if="project && !creating" class="primary" :disabled="working" @click="save">保存项目设置</button>
        <button @click="refreshProjects">刷新项目列表</button>
      </div>
    </div>
    <div v-if="failure" class="warn">{{ failure }}</div>
    <div v-if="notice" class="tip">{{ notice }}</div>

    <div class="project-settings-layout">
    <div class="project-configuration">
    <div class="panel">
      <div class="panel-titlebar">
        <h3>本地项目</h3>
        <details class="panel-help"><summary>存储说明</summary><p>项目保存在画布工作区的独立文件夹中，包含项目文件、assets 和 novel，不与其他项目混存。</p></details>
      </div>
      <div class="project-location-row">
        <label>已有项目
          <select v-model="switchPath">
            <option value="">请选择独立项目</option>
            <option v-for="entry in foundProjects" :key="entry.path" :value="entry.path">{{ entry.name }}（{{ entry.path }}）</option>
          </select>
        </label>
        <button :disabled="!switchPath||working" @click="switchToProject">打开项目</button>
        <label>保存位置
          <input v-model="saveRoot" placeholder=". = 当前画布目录" :disabled="!creating && !!project"/>
        </label>
        <button v-if="project && !creating && isLegacy" @click="migrate">迁移旧项目</button>
      </div>
      <p v-if="project && !creating" class="path">项目文件：{{ context.resource.path }}</p>
    </div>

    <div v-if="creating || !project" class="panel">
      <h3>创建独立项目</h3>
      <div class="fields project-basics">
        <label>项目名称<input v-model="draft.name" placeholder="输入新项目名称"/></label>
        <label>画面比例<select v-model="draft.aspectRatio"><option v-for="r in ratios" :key="r">{{ r }}</option></select></label>
      </div>
    </div>
    <div v-else class="panel">
      <h3>基本信息</h3>
      <div class="fields project-basics">
        <label>项目名称<input :value="project.name" disabled title="为避免项目名与文件夹名不一致，当前版本创建后不支持重命名"/></label>
        <label>画面比例<select v-model="project.aspectRatio" @change="save"><option v-for="r in ratios" :key="r">{{ r }}</option></select></label>
      </div>
    </div>

    <div class="panel generation-panel">
      <div class="panel-titlebar">
        <h3>默认生成方式</h3>
        <div class="toolbar">
          <button :disabled="modelLoading" @click="refreshModels">{{ modelLoading?'读取中…':'刷新模型' }}</button>
          <button @click="refreshApps">刷新 RH 应用</button>
        </div>
      </div>
      <div class="generation-rows">
        <div class="generation-head" aria-hidden="true">
          <span>生成类型</span><span>生成方式</span><span>模型 / RH 应用</span><span>最大并发</span><span>失败重试</span>
        </div>
        <div class="generation-row">
          <strong>文本生成</strong>
          <span class="mode-fixed" title="文本只支持 ToonFlow 模型节点，不支持 RH">模型节点（固定）</span>
          <select aria-label="默认文本模型" v-model="generation.text.model" @change="saveGeneration">
            <option value="">使用文本节点自身默认模型</option>
            <option v-for="item in availableModels.text" :key="item.value" :value="item.value">{{ item.providerLabel }} · {{ item.label }}</option>
            <option v-if="generation.text.model && !hasModel('text',generation.text.model)" :value="generation.text.model">⚠ 原模型不可用，请重新选择</option>
          </select>
          <input type="number" aria-label="文本最大并发" min="1" max="100" step="1" v-model.number="queueSettings.text.concurrency" @change="saveQueueSettings" />
          <input type="number" aria-label="文本失败重试次数" min="0" max="5" step="1" v-model.number="queueSettings.text.retries" @change="saveQueueSettings" />
        </div>
        <div class="generation-row">
          <strong>图片生成</strong>
          <select aria-label="图片生成方式" v-model="generation.image.mode" @change="saveGeneration">
            <option value="model">模型节点</option><option value="rh">RH 工作流节点</option>
          </select>
          <select v-if="generation.image.mode==='model'" aria-label="默认图片模型" v-model="generation.image.model" @change="saveGeneration">
            <option value="">使用图片节点自身默认模型</option>
            <option v-for="item in availableModels.image" :key="item.value" :value="item.value">{{ item.providerLabel }} · {{ item.label }}</option>
            <option v-if="generation.image.model && !hasModel('image',generation.image.model)" :value="generation.image.model">⚠ 原模型不可用，请重新选择</option>
          </select>
          <select v-else aria-label="默认 RH 图片应用" v-model="generation.image.rhAppUid" @change="saveGeneration">
            <option value="">请选择 RH 图片应用</option>
            <option v-for="app in rhApps" :key="app.uid" :value="app.uid">{{ app.name }} · {{ app.webappId }}</option>
          </select>
          <input type="number" aria-label="图片最大并发" min="1" max="100" step="1" v-model.number="queueSettings.image.concurrency" @change="saveQueueSettings" />
          <input type="number" aria-label="图片失败重试次数" min="0" max="5" step="1" v-model.number="queueSettings.image.retries" @change="saveQueueSettings" />
        </div>
        <div class="generation-row">
          <strong>视频生成</strong>
          <select aria-label="视频生成方式" v-model="generation.video.mode" @change="saveGeneration">
            <option value="model">模型节点</option><option value="rh">RH 工作流节点</option>
          </select>
          <select v-if="generation.video.mode==='model'" aria-label="默认视频模型" v-model="generation.video.model" @change="saveGeneration">
            <option value="">使用视频节点自身默认模型</option>
            <option v-for="item in availableModels.video" :key="item.value" :value="item.value">{{ item.providerLabel }} · {{ item.label }}</option>
            <option v-if="generation.video.model && !hasModel('video',generation.video.model)" :value="generation.video.model">⚠ 原模型不可用，请重新选择</option>
          </select>
          <select v-else aria-label="默认 RH 视频应用" v-model="generation.video.rhAppUid" @change="saveGeneration">
            <option value="">请选择 RH 视频应用</option>
            <option v-for="app in rhApps" :key="app.uid" :value="app.uid">{{ app.name }} · {{ app.webappId }}</option>
          </select>
          <input type="number" aria-label="视频最大并发" min="1" max="100" step="1" v-model.number="queueSettings.video.concurrency" @change="saveQueueSettings" />
          <input type="number" aria-label="视频失败重试次数" min="0" max="5" step="1" v-model.number="queueSettings.video.retries" @change="saveQueueSettings" />
        </div>
        <div class="generation-row">
          <strong>音频生成</strong>
          <select aria-label="音频生成方式" v-model="generation.audio.mode" @change="saveGeneration">
            <option value="off">关闭音频</option>
            <option value="rh">RH 工作流节点</option>
            <option value="model">模型节点（需插件）</option>
          </select>
          <select v-if="generation.audio.mode==='model'" aria-label="默认音频模型" v-model="generation.audio.model" @change="saveGeneration" title="需要安装 audioGenerationNode，否则画布装配会拒绝执行">
            <option value="">沿用音频生成节点默认模型</option>
            <option v-for="item in availableModels.audio" :key="item.value" :value="item.value">{{ item.providerLabel }} · {{ item.label }}</option>
            <option v-if="generation.audio.model && !hasModel('audio',generation.audio.model)" :value="generation.audio.model">⚠ 原模型不可用，请重新选择</option>
          </select>
          <select v-else-if="generation.audio.mode==='rh'" aria-label="默认 RH 音频应用" v-model="generation.audio.rhAppUid" @change="saveGeneration" title="RH 应用需实际输出音频，添加节点后不会自动执行">
            <option value="">请选择 RH 音频应用</option>
            <option v-for="app in rhApps" :key="app.uid" :value="app.uid">{{ app.name }} · {{ app.webappId }}</option>
          </select>
          <span v-else class="mode-empty">不装配音频节点</span>
          <input type="number" aria-label="音频最大并发" min="1" max="100" step="1" v-model.number="queueSettings.audio.concurrency" @change="saveQueueSettings" />
          <input type="number" aria-label="音频失败重试次数" min="0" max="5" step="1" v-model.number="queueSettings.audio.retries" @change="saveQueueSettings" />
        </div>
      </div>
      <p class="generation-footnote">并发范围 1–100，失败重试 0–5 次，修改自动保存。留空沿用节点默认模型；RH 应用需先保存，音频模型需另装 audioGenerationNode。</p>
      <span v-if="modelError" class="warn-inline">{{ modelError }}</span>
      <span v-if="rhError" class="warn-inline">{{ rhError }}</span>
    </div>
    </div>

    <aside class="manual-selection">
      <section v-for="kind in ['visual','director']" :key="kind" class="panel manual-browser">
        <div class="manual-browser-head">
          <div><h3>{{kind==='visual'?'视觉手册':'导演手册'}}</h3>
            <p class="subtle">{{kind==='visual'?'选择项目统一美术风格与资产生成规范':'选择本项目的导演与镜头叙事规范'}}</p>
          </div>
          <div class="toolbar manual-browser-actions">
            <button @click="startNew(kind)">＋ 新建{{kind==='visual'?'视觉':'导演'}}手册</button>
            <button type="button" class="manual-scroll-button" :aria-label="'向左查看'+(kind==='visual'?'视觉':'导演')+'手册'" @click="scrollManualGallery(kind,-1)">‹</button>
            <button type="button" class="manual-scroll-button" :aria-label="'向右查看'+(kind==='visual'?'视觉':'导演')+'手册'" @click="scrollManualGallery(kind,1)">›</button>
          </div>
        </div>
        <div class="manual-cover-grid" :ref="el=>setManualGallery(kind,el)" role="group" :aria-label="kind==='visual'?'选择视觉手册':'选择导演手册'">
          <div v-for="manual in manuals(kind)" :key="manual.id"
            class="manual-cover-tile" :class="{active:selected[kind]===manual.id}"
            :title="manual.name+' · '+(manual.source==='builtin'?'旧版原始手册':'自定义手册')">
            <button type="button" class="manual-cover-pick"
              :aria-label="'选择手册：'+manual.name" :aria-pressed="selected[kind]===manual.id"
              @click="choose(kind,manual.id)">
              <img v-if="coverSrc(manual)" :src="coverSrc(manual)" :alt="manual.name+'封面'"/>
              <span v-else class="manual-cover-placeholder">{{kind==='visual'?'◈':'▣'}}</span>
              <span class="manual-cover-label">{{manual.name}}</span>
            </button>
            <button type="button" class="manual-cover-action manual-cover-edit"
              :title="manual.source==='builtin'?'复制后编辑':'编辑手册'"
              :aria-label="'编辑 '+manual.name" @click.stop="startEdit(kind,manual.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8.5 17.5 4 19l1.5-4.5Z"/></svg></button>
            <div class="manual-cover-right">
              <button type="button" class="manual-cover-action" :title="'复制 '+manual.name"
                :aria-label="'复制 '+manual.name" @click.stop="startCopy(kind,manual.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>
              <button v-if="manual.source==='custom'" type="button" class="manual-cover-action manual-cover-delete"
                :title="'删除自定义手册 '+manual.name" :aria-label="'删除自定义手册 '+manual.name"
                :disabled="working" @click.stop="deleteManualById(kind,manual.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v6m4-6v6"/></svg></button>
            </div>
            <button type="button" class="manual-cover-view" :aria-label="'查看编辑 '+manual.name"
              @click.stop="startEdit(kind,manual.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg> 查看 / 编辑</button>
            <span v-if="selected[kind]===manual.id" class="manual-cover-selected" aria-hidden="true">✓</span>
          </div>
        </div>
        <p v-if="selectedManual(kind)" class="manual-selection-tip">
          当前选择：{{selectedManual(kind).name}} · {{selectedManual(kind).sections.length}} 个章节
          <button class="manual-inline-action" @click="startEdit(kind)">查看 / {{selectedManual(kind).source==='builtin'?'复制修改':'编辑'}}</button>
        </p>
      </section>
    </aside>
    </div>

    <Teleport to="body">
      <div v-if="editor" class="manual-modal-mask" @click.self="closeManualEditor()" @wheel.stop @pointerdown.stop @keydown.esc.stop.prevent="closeManualEditor()">
        <div class="manual-modal" role="dialog" aria-modal="true" :aria-label="'编辑'+(editor.kind==='visual'?'视觉手册':'导演手册')" tabindex="-1">
          <header class="manual-modal-header">
            <div><h3>{{editor.source==='builtin'?'复制旧版手册':'编辑'+(editor.kind==='visual'?'视觉':'导演')+'手册'}}</h3>
              <p>封面、章节和 Markdown 正文单独编辑，保存后立即应用于当前项目</p></div>
            <button type="button" class="manual-close" title="关闭编辑器" @click="closeManualEditor()">×</button>
          </header>
          <p v-if="manualError" class="manual-modal-error">{{manualError}}</p>
          <div class="manual-modal-fields">
            <label>手册名称 <input v-model="editor.name" placeholder="请输入手册名称"/></label>
            <label>手册标识 <input :value="editor.slug||editor.coverSourceSlug||'自定义手册'" disabled/></label>
            <div class="manual-cover-uploader">
              <strong>手册封面</strong>
              <div class="manual-cover-upload-row">
                <img v-if="editorCoverPreview||coverSrc(editor)" :src="editorCoverPreview||coverSrc(editor)" alt="当前手册封面"/>
                <span v-else class="manual-empty-cover">无封面</span>
                <label class="manual-upload-button">＋ 上传封面
                  <input type="file" accept="image/png,image/jpeg,image/webp" @change="onManualCoverUpload" />
                </label>
                <button v-if="editorCoverPreview||editor.coverPath||editor.coverSourceSlug" type="button" @click="clearEditorCover">移除封面</button>
              </div>
            </div>
          </div>
          <section class="manual-markdown-area">
            <h4>手册提示词</h4>
            <div class="manual-section-tabs" role="tablist" aria-label="手册章节">
              <button v-for="(section,i) in editor.sections" :key="section.key||i" type="button" role="tab"
                :aria-selected="sectionIndex===i" :class="{active:sectionIndex===i}" @click="sectionIndex=i">{{sectionTabLabel(section)}}</button>
              <button type="button" class="manual-add-tab" @click="addSection">＋ 新增章节</button>
            </div>
            <div v-if="editor.sections[sectionIndex]" class="manual-section-editor">
              <div class="manual-edit-toolbar">
                <button title="加粗" @click="wrapMarkdown('**','**')"><strong>B</strong></button>
                <button title="斜体" @click="wrapMarkdown('*','*')"><i>I</i></button>
                <button title="删除线" @click="wrapMarkdown('~~','~~')"><s>S</s></button>
                <button title="二级标题" @click="wrapMarkdown('## ','')">H2</button>
                <button title="无序列表" @click="wrapMarkdown('- ','')">• 列表</button>
                <button title="有序列表" @click="wrapMarkdown('1. ','')">1. 列表</button>
                <span class="manual-edit-spacer"></span>
                <input class="manual-section-title-input" v-model="editor.sections[sectionIndex].title" aria-label="当前章节标题" placeholder="章节名称"/>
                <button type="button" :disabled="editor.sections.length<=1" @click="removeSection">删除章节</button>
              </div>
              <div class="manual-editor-columns">
                <textarea ref="markdownTextarea" v-model="editor.sections[sectionIndex].content" spellcheck="false" placeholder="在此编辑 Markdown 正文；右侧实时显示预览"></textarea>
                <div class="manual-markdown-preview" v-html="renderManualMarkdown(editor.sections[sectionIndex].content)" aria-label="Markdown 实时预览"></div>
              </div>
            </div>
          </section>
          <footer class="manual-modal-footer">
            <p>内置手册始终保留原版；修改内置手册时会另存为自定义副本。</p>
            <button v-if="editorIsExistingCustom" class="manual-danger" :disabled="working" @click="deleteManual">删除该手册</button>
            <span class="manual-footer-spacer"></span>
            <button :disabled="working" @click="closeManualEditor()">取消</button>
            <button class="primary" :disabled="working" @click="commitManual">{{working?'保存中…':'保存并应用'}}</button>
          </footer>
        </div>
      </div>
    </Teleport>

    <div v-if="creating||!project" class="toolbar footer"><button class="primary" :disabled="working||!draft.name.trim()" @click="create">创建项目并打开</button>
      <button v-if="project" @click="creating=false">取消</button></div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { createProject, emptyStudio } from "./studio.mjs";
import { defaultGeneration, normalizeGeneration, loadRhApps, loadAvailableModels } from "./generation.mjs";
import { normalizeQueueSettings } from "./taskQueue.mjs";
import { builtinList, allManuals, loadCustomManuals, saveCustomManuals, makeCustomManual, manualText } from "./manuals.mjs";
import manualCoverImages from "./manualCoverImages.mjs";
import { renderManualMarkdown } from "./manualMarkdown.mjs";

const props=defineProps({studio:{type:Object,required:true},context:{type:Object,required:true}});
const emit=defineEmits(["save"]);
const project=computed(()=>props.studio.project);
const draft=reactive({name:"",aspectRatio:"9:16"});
const ratios=["9:16","16:9","1:1","4:3","3:4","2:3","3:2","21:9"];
const creating=ref(!project.value);
const saveRoot=ref(".");
const foundProjects=ref([]), switchPath=ref("");
const selected=reactive({visual:"",director:""});
const custom=ref([]), editor=ref(null), sectionIndex=ref(0);
const manualGalleries={visual:null,director:null};
function setManualGallery(kind,element){manualGalleries[kind]=element;}
function scrollManualGallery(kind,direction){
  const element=manualGalleries[kind];
  if(!element)return;
  element.scrollBy({left:Math.max(168,Math.round(element.clientWidth*.72))*direction,behavior:"smooth"});
}
const manualError=ref(""),editorSnapshot=ref(""),editorCoverFile=ref(null),editorCoverPreview=ref("");
const markdownTextarea=ref(null),coverUrls=reactive({}),ownedCoverUrls=new Set();
const editorIsExistingCustom=computed(()=>!!editor.value && custom.value.some(m=>m.id===editor.value.id));
const sectionLabels={
 "README.md":"README","prefix.md":"前缀",
 "art_prompt/art_character.md":"角色","art_prompt/art_character_derivative.md":"角色衍生",
 "art_prompt/art_prop.md":"道具","art_prompt/art_prop_derivative.md":"道具衍生",
 "art_prompt/art_scene.md":"场景","art_prompt/art_scene_derivative.md":"场景衍生",
 "art_prompt/art_storyboard_video.md":"分镜视频",
 "driector_skills/director_planning_style.md":"技法-导演规划",
 "driector_skills/director_storyboard_table_style.md":"技法-分镜表",
 "driector_skills/director_storyboard.md":"分镜"
};
const sectionTabLabel=section=>sectionLabels[section.key]||section.title||section.key||"新章节";
function coverSrc(manual){
 if(!manual)return "";
 if(manual.coverPath && coverUrls[manual.coverPath])return coverUrls[manual.coverPath];
 return manualCoverImages[manual.kind]?.[manual.coverSourceSlug||manual.slug]||"";
}
async function loadManualCover(path){
 if(!path || coverUrls[path])return;
 try{
   const data=await props.context.files.read(path);
   const ext=path.split('.').pop()?.toLowerCase();
   const mime=ext==='webp'?'image/webp':ext==='jpg'||ext==='jpeg'?'image/jpeg':'image/png';
   const url=URL.createObjectURL(new Blob([data],{type:mime}));
   ownedCoverUrls.add(url);
   coverUrls[path]=url;
 }catch{ /* Missing cover must not hide or damage the rest of the manual. */ }
}
onBeforeUnmount(()=>{
 for(const url of ownedCoverUrls)URL.revokeObjectURL(url);
 if(editorCoverPreview.value && !ownedCoverUrls.has(editorCoverPreview.value))URL.revokeObjectURL(editorCoverPreview.value);
 ownedCoverUrls.clear();
});
const generation=reactive(defaultGeneration());
const queueSettings=reactive(normalizeQueueSettings());
const rhApps=ref([]),rhError=ref(""),failure=ref(""),notice=ref(""),working=ref(false);
const availableModels=ref({text:[],image:[],video:[],audio:[]}),modelError=ref(""),modelLoading=ref(false);
const hasModel=(kind,value)=>availableModels.value[kind].some(x=>x.value===value);
const isLegacy=computed(()=>props.context.resource.path?.startsWith("producer-studio/"));
const manuals=kind=>allManuals(kind,custom.value);
const selectedManual=kind=>manuals(kind).find(m=>m.id===selected[kind]);
watch(project,(value)=>{
  if(value){
    creating.value=false;
    for(const k of ["visual","director"]) {
      const legacyValue=value[k==="visual"?"visualPreset":"directorPreset"];
      selected[k]=value[k+"ManualId"]||manuals(k).find(x=>x.name===legacyValue)?.id||"";
    }
    Object.assign(generation,normalizeGeneration(value.generation));
    Object.assign(queueSettings,normalizeQueueSettings(value.queueSettings));
  } else {creating.value=true;}
},{immediate:true});
onMounted(async()=>{
  // 新项目默认采用旧版现代都市视觉与都市职场导演手册；可任意切换。
  if(!project.value){
    selected.visual=builtinList("visual").find(x=>x.slug==="realpeople_modern_city")?.id||"";
    selected.director=builtinList("director").find(x=>x.slug==="Urban_workplace_drama")?.id||"";
  }
  try{custom.value=await loadCustomManuals(props.context.files);
    await Promise.all(custom.value.map(m=>loadManualCover(m.coverPath)));
  }
  catch(e){failure.value="自定义手册读取失败："+e.message;}
  if(project.value) for(const k of ["visual","director"]){
    if(!selected[k]){
      const legacyName=project.value[k==="visual"?"visualPreset":"directorPreset"];
      selected[k]=manuals(k).find(m=>m.name===legacyName)?.id||"";
    }
  }
  await Promise.allSettled([refreshProjects(),refreshApps(),refreshModels()]);
});
async function refreshProjects() {
  try {foundProjects.value=await props.context.listProjects(saveRoot.value);}
  catch(e){failure.value="读取项目列表失败："+e.message;}
}
async function switchToProject() {
  if(!switchPath.value)return;
  try{failure.value="";working.value=true;await props.context.openFile(switchPath.value);notice.value="已打开项目";}
  catch(e){failure.value=e.message;}finally{working.value=false;}
}
function save(){if(project.value&&!creating.value) emit("save");}
function startCreating(){
  creating.value=true;
  draft.name="";
  draft.aspectRatio="9:16";
  Object.assign(generation,defaultGeneration());
  Object.assign(queueSettings,normalizeQueueSettings());
  selected.visual=builtinList("visual").find(m=>m.slug==="realpeople_modern_city")?.id||"";
  selected.director=builtinList("director").find(m=>m.slug==="Urban_workplace_drama")?.id||"";
}
function saveGeneration(){
  if(project.value && !creating.value){project.value.generation=normalizeGeneration(generation);save();}
}
function saveQueueSettings(){
  const next=normalizeQueueSettings(queueSettings);
  Object.assign(queueSettings,next);
  if(project.value&&!creating.value){project.value.queueSettings=next;save();}
}
async function refreshModels(){
  modelLoading.value=true;
  try {
    availableModels.value=await loadAvailableModels();
    modelError.value="";
  } catch(e) {
    modelError.value="模型列表读取失败："+e.message;
  } finally {
    modelLoading.value=false;
  }
}
async function refreshApps(){
  try{rhApps.value=await loadRhApps();rhError.value="";}
  catch(e){rhError.value="未能读取 RH 应用："+e.message;}
}
function choose(kind,id){
  selected[kind]=id;
  const manual=selectedManual(kind);
  if(project.value && !creating.value && manual){
    project.value[kind+"ManualId"]=id;
    project.value[kind+"Preset"]=manual.name;
    project.value[kind+"Manual"]=manualText(manual);
    save();
  }
}
async function create(){
  failure.value="";working.value=true;
  try {
    if(generation.image.mode==="rh"&&!generation.image.rhAppUid)throw new Error("图片选择 RH 后需要指定 RH 应用");
    if(generation.video.mode==="rh"&&!generation.video.rhAppUid)throw new Error("视频选择 RH 后需要指定 RH 应用");
    if(generation.audio.mode==="rh"&&!generation.audio.rhAppUid)throw new Error("音频选择 RH 后需要指定 RH 应用");
    const projectData=createProject({name:draft.name,aspectRatio:draft.aspectRatio});
    projectData.generation=normalizeGeneration(generation);
    projectData.queueSettings=normalizeQueueSettings(queueSettings);
    for(const kind of ["visual","director"]) {
      const manual=selectedManual(kind);
      if(manual){
        projectData[kind+"ManualId"]=manual.id;
        projectData[kind+"Preset"]=manual.name;
        projectData[kind+"Manual"]=manualText(manual);
      }
    }
    const data=emptyStudio();data.project=projectData;
    // 新项目 exclusive 写入，绝不会覆盖正在编辑的旧项目。
    const path=await props.context.createProjectFile(data,saveRoot.value);
    await props.context.openFile(path);
    await refreshProjects();
    notice.value="已创建独立项目目录："+path;
    creating.value=false;
  }catch(e){failure.value=e.message;}finally{working.value=false;}
}
async function migrate(){
  if(!project.value)return;
  if(!confirm("复制旧版项目数据和参考图到新的独立文件夹，并保留原文件作为备份？"))return;
  try{failure.value="";working.value=true;const path=await props.context.migrateCurrentProject(props.studio);await refreshProjects();notice.value="迁移成功，原旧项目文件保留："+path;}
  catch(e){failure.value="迁移失败："+e.message;}finally{working.value=false;}
}
function openManualEditor(manual){
  manualError.value="";
  if(editorCoverPreview.value && !ownedCoverUrls.has(editorCoverPreview.value))URL.revokeObjectURL(editorCoverPreview.value);
  editorCoverPreview.value="";editorCoverFile.value=null;
  editor.value=manual;sectionIndex.value=0;
  editorSnapshot.value=JSON.stringify(manual);
}
function startNew(kind){openManualEditor(makeCustomManual(null,kind,kind==="visual"?"新视觉手册":"新导演手册"));}
function startEdit(kind,manualId=selected[kind]){
  const manual=manuals(kind).find(m=>m.id===manualId);
  if(!manual){startNew(kind);return;}
  const copy=makeCustomManual(manual,kind,manual.name+(manual.source==="builtin"?" · 自定义":""));
  if(manual.source==="custom"){copy.id=manual.id;copy.name=manual.name;}
  openManualEditor(copy);
}
function startCopy(kind,manualId){
  const manual=manuals(kind).find(m=>m.id===manualId);
  if(!manual)return;
  // 无论是内置还是自定义，复制操作都必须生成全新 ID，不能覆盖原手册。
  const copy=makeCustomManual(manual,kind,manual.name+" · 副本");
  openManualEditor(copy);
}
function closeManualEditor(force=false){
  if(working.value)return;
  if(!force && editor.value && (JSON.stringify(editor.value)!==editorSnapshot.value||editorCoverFile.value)
     && !confirm("当前手册有未保存的修改，确定放弃吗？"))return;
  if(editorCoverPreview.value && !ownedCoverUrls.has(editorCoverPreview.value))URL.revokeObjectURL(editorCoverPreview.value);
  editorCoverPreview.value="";editorCoverFile.value=null;
  editor.value=null;manualError.value="";
}
async function onManualCoverUpload(event){
  const file=event.target.files?.[0];
  event.target.value="";
  if(!file)return;
  if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>5_000_000){
    manualError.value="封面仅支持 PNG、JPG、WebP，文件不能超过 5MB";return;
  }
  if(editorCoverPreview.value && !ownedCoverUrls.has(editorCoverPreview.value))URL.revokeObjectURL(editorCoverPreview.value);
  editorCoverPreview.value=URL.createObjectURL(file);
  editorCoverFile.value=file;manualError.value="";
}
function clearEditorCover(){
  if(!editor.value)return;
  if(editorCoverPreview.value && !ownedCoverUrls.has(editorCoverPreview.value))URL.revokeObjectURL(editorCoverPreview.value);
  editorCoverPreview.value="";editorCoverFile.value=null;
  editor.value.coverPath="";editor.value.coverSourceSlug="";
}
async function saveEditorCover(manual){
  if(!editorCoverFile.value)return;
  const file=editorCoverFile.value;
  for(const dir of ["producer-manuals","producer-manuals/covers"]){
    try{await props.context.files.mkdir(dir)}
    catch(e){await props.context.files.list(dir)}
  }
  const ext=file.type==="image/jpeg"?"jpg":file.type==="image/webp"?"webp":"png";
  const name=manual.id.replace(/[^a-zA-Z0-9_-]/g,"")+"-"+Date.now()+"."+ext;
  const filePath="producer-manuals/covers/"+name;
  await props.context.files.write(filePath,await file.arrayBuffer(),true);
  manual.coverPath=filePath;
  return filePath;
}
function wrapMarkdown(before,after){
  const section=editor.value?.sections?.[sectionIndex.value],textarea=markdownTextarea.value;
  if(!section||!textarea)return;
  const start=textarea.selectionStart??section.content.length;
  const end=textarea.selectionEnd??start;
  const selected=section.content.slice(start,end);
  section.content=section.content.slice(0,start)+before+selected+after+section.content.slice(end);
  nextTick(()=>{textarea.focus();textarea.setSelectionRange(start+before.length,start+before.length+selected.length);});
}
function addSection(){if(!editor.value)return;editor.value.sections.push({key:"custom/"+Date.now()+".md",title:"新章节",content:""});sectionIndex.value=editor.value.sections.length-1;}
function removeSection(){if(editor.value?.sections.length>1){editor.value.sections.splice(sectionIndex.value,1);sectionIndex.value=Math.max(0,sectionIndex.value-1);}}
async function commitManual(){
  if(!editor.value?.name?.trim()){manualError.value="请填写手册名称";return;}
  if(!editor.value.sections.some(x=>x.content.trim())){manualError.value="至少需要一个非空手册章节";return;}
  const manual=JSON.parse(JSON.stringify(editor.value));
  manual.name=manual.name.trim();manual.source="custom";
  try {
    working.value=true;manualError.value="";failure.value="";
    const savedCover=await saveEditorCover(manual);
    const next=custom.value.filter(x=>x.id!==manual.id).concat([manual]);
    await saveCustomManuals(props.context.files,next);
    if(savedCover && editorCoverPreview.value){
      coverUrls[savedCover]=editorCoverPreview.value;
      ownedCoverUrls.add(editorCoverPreview.value);
    }
    custom.value=next;
    choose(manual.kind,manual.id);
    editor.value=null;editorCoverPreview.value="";editorCoverFile.value=null;
    notice.value="手册已保存并应用到当前项目，旧版内置预设未被修改";
  }catch(e){manualError.value="保存手册失败："+e.message;}finally{working.value=false;}
}
async function deleteManualById(kind,id){
  if(working.value)return;
  const manual=custom.value.find(m=>m.kind===kind&&m.id===id);
  if(!manual){failure.value="只能删除自定义手册，内置手册不可删除";return;}
  if(!confirm('确定删除自定义手册「'+manual.name+'」？\n已存在项目中的手册正文保留；当前项目如在使用此手册将切回内置预设。'))return;
  try {
    working.value=true;failure.value="";manualError.value="";
    const next=custom.value.filter(m=>m.id!==id);
    await saveCustomManuals(props.context.files,next);
    custom.value=next;
    if(selected[kind]===id){
      const fallback=builtinList(kind)[0];
      if(fallback)choose(kind,fallback.id);
    }
    if(editor.value?.id===id){
      editor.value=null;editorCoverFile.value=null;
      if(editorCoverPreview.value&&!ownedCoverUrls.has(editorCoverPreview.value))
        URL.revokeObjectURL(editorCoverPreview.value);
      editorCoverPreview.value="";
    }
    notice.value="自定义手册已删除，原版内置手册与已有媒体文件不受影响";
  }catch(e){failure.value="删除手册失败："+e.message;manualError.value=failure.value;}
  finally{working.value=false;}
}
async function deleteManual(){
  if(!editor.value)return;
  await deleteManualById(editor.value.kind,editor.value.id);
}
</script>

<style scoped>
.settings-root{display:flex;flex-direction:column;gap:14px;min-width:0}.project-header,.preset-title{display:flex;align-items:center;justify-content:space-between;gap:18px}.project-header h2{margin:0;font-size:22px}.project-header p,.subtle{font-size:12px;color:var(--el-text-color-secondary,#8892a3);line-height:1.6;margin:5px 0 12px}.panel{background:var(--el-fill-color-blank,#181d25);border:1px solid var(--el-border-color,#3b434e);border-radius:12px;padding:18px}.panel h3{font-size:16px;margin:0 0 12px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.settings-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.settings-root label{display:flex;flex-direction:column;gap:7px;font-size:12px;margin:6px 0 12px}.settings-root input,.settings-root select,.settings-root textarea{width:100%;box-sizing:border-box;padding:10px;border-radius:7px;border:1px solid var(--el-border-color,#3e4755);background:var(--el-fill-color,#141820);color:inherit;font:inherit}.settings-root textarea{font:13px/1.65 monospace;resize:vertical}.settings-root button{background:var(--el-fill-color,#28303e);color:inherit;border:1px solid var(--el-border-color,#475063);border-radius:7px;cursor:pointer;padding:8px 13px}.settings-root button:disabled{opacity:.5;cursor:not-allowed}.settings-root button.primary{background:#347cdc;color:#fff;border-color:#347cdc}.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.toolbar.footer{padding:12px 0}.path{font-size:12px;color:#70a6fa}.warn,.tip{border-radius:7px;padding:12px;font-size:12px}.warn,.warn-inline{color:#ec9898}.warn{background:#512828}.tip{color:#93c3a2;background:#21422c}.editor-content{display:grid;grid-template-columns:210px minmax(0,1fr);gap:14px}.sections{display:flex;flex-direction:column;gap:5px;max-height:460px;overflow-y:auto}.sections button{white-space:normal;text-align:left}.sections button.sel{border-color:#347cdc;color:#91bdff}.section-content{min-width:0}.section-content textarea{min-height:350px}@media(max-width:900px){.fields,.settings-grid{grid-template-columns:1fr}.editor-content{grid-template-columns:1fr}}
.queue-settings{display:grid;grid-template-columns:minmax(100px,1fr) minmax(90px,1fr) minmax(90px,1fr);gap:9px 18px;align-items:center;font-size:13px;margin:16px 0}.queue-settings .queue-heading{font-size:12px;color:var(--el-text-color-secondary,#99a2b4)}.queue-settings input{max-width:180px;padding:7px 9px}.queue-settings strong{font-weight:500}
/* Compact project settings */
.settings-root{gap:9px;font-size:12px}
.project-header,.preset-title{gap:10px}
.project-header h2{font-size:18px}
.project-header p,.subtle{font-size:11px;line-height:1.5;margin:4px 0 8px}
.panel{padding:12px 14px;border-radius:9px}
.panel h3{font-size:14px;margin-bottom:9px}
.fields{gap:9px}
.settings-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.settings-root label{gap:4px;font-size:12px;margin:4px 0 8px}
.settings-root input,.settings-root select{min-height:32px;padding:6px 8px;font-size:12px;border-radius:6px}
.settings-root textarea{padding:7px 8px;font:12px/1.6 monospace;border-radius:6px}
.settings-root button{padding:5px 9px;min-height:30px;border-radius:6px;font-size:12px}
.toolbar{gap:6px}
.toolbar.footer{padding:8px 0}
.warn,.tip{padding:8px 10px;font-size:11px}
.editor-content{grid-template-columns:175px minmax(0,1fr);gap:10px}
.sections{gap:4px;max-height:380px}
.section-content textarea{min-height:270px}
.queue-settings{gap:7px 10px;margin:10px 0;font-size:12px}
.queue-settings input{max-width:145px;padding:6px 8px}
@media(max-width:900px){
  .fields,.settings-grid{grid-template-columns:1fr}
  .editor-content{grid-template-columns:1fr}
}
/* Information architecture: short, aligned controls rather than full-width stacked forms. */
.settings-root{width:100%;max-width:1080px;margin:0 auto;align-items:stretch;gap:10px}
.settings-root .panel{min-width:0}
.panel-titlebar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px}
.panel-titlebar h3{margin:0}
.panel-titlebar .toolbar{gap:6px}
.panel-help{position:relative}
.panel-help summary{cursor:pointer;color:var(--el-color-primary,#3374d4);font-size:11px}
.panel-help p{margin:6px 0 0;max-width:570px;font-size:11px;line-height:1.5;color:var(--el-text-color-secondary,#8995a7)}
.project-location-row{display:grid;grid-template-columns:minmax(200px,420px) auto minmax(140px,200px) auto;align-items:end;justify-content:start;gap:8px}
.project-location-row label{margin:0}
.project-location-row>button{align-self:end;white-space:nowrap}
.project-location-row input,.project-location-row select{min-width:0}
.project-basics{grid-template-columns:minmax(200px,360px) minmax(125px,165px);justify-content:start;gap:12px}
.project-basics label{margin:0}
.path{font-size:11px;line-height:1.4;overflow-wrap:anywhere;margin:9px 0 0}
.generation-panel{padding-top:10px}
.generation-rows{display:flex;flex-direction:column;gap:0;max-width:950px;overflow-x:auto}
.generation-head,.generation-row{display:grid;grid-template-columns:90px 166px minmax(190px,420px) 108px 108px;align-items:center;gap:9px;min-width:845px}
.generation-head{padding:0 0 5px;border-bottom:1px solid var(--el-border-color,#d7e0eb);font-size:11px;font-weight:600;color:var(--el-text-color-secondary,#708096)}
.generation-row{border-bottom:1px solid var(--el-border-color-lighter,#e8edf3);min-height:41px;padding:4px 0}
.generation-row>input[type=number]{width:100%;min-width:0;max-width:108px;min-height:32px;text-align:center;box-sizing:border-box}
.generation-row:last-child{border-bottom:0}
.generation-row>strong{font-size:12px;font-weight:600;white-space:nowrap}
.generation-row>select{width:100%;min-width:0;max-width:100%;min-height:32px;margin:0}
.generation-row .mode-fixed,.generation-row .mode-empty{display:flex;align-items:center;min-height:32px;padding:0 9px;border-radius:6px;background:var(--el-fill-color-light,#f0f3f7);color:var(--el-text-color-secondary,#68768a);font-size:12px;white-space:nowrap}
.generation-row .mode-empty{grid-column:3}
.generation-footnote{margin:7px 0 0;color:var(--el-text-color-secondary,#8994a4);font-size:11px;line-height:1.4}
.queue-panel summary{cursor:pointer;font-size:13px;font-weight:600}
.queue-panel summary span{font-size:11px;font-weight:400;color:var(--el-text-color-secondary,#8592a6);margin-left:8px}
.queue-panel .queue-settings{grid-template-columns:110px 115px 115px;justify-content:start;gap:8px 14px;margin:12px 0}
.queue-panel .queue-settings input{max-width:115px}
.manual-panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.manual-panels>.panel{min-width:0}
.manual-panels .preset-title{align-items:center;gap:8px;flex-wrap:wrap}
.manual-panels .preset-title h3{margin:0}
.manual-panels .preset-title .subtle{margin:3px 0}
.manual-panels .panel>select{max-width:100%}
@media(max-width:900px){
  .project-location-row{grid-template-columns:minmax(170px,1fr) auto minmax(130px,.7fr)}
  .project-location-row>button:last-child{grid-column:1/-1;justify-self:start}
  .manual-panels{grid-template-columns:1fr}
}
@media(max-width:730px){
  .project-location-row{grid-template-columns:minmax(0,1fr) auto}
  .project-location-row label:nth-of-type(2){grid-column:1/-1}
  .project-basics{grid-template-columns:minmax(0,1fr) 110px}
  .generation-rows{max-width:100%}
  .generation-head,.generation-row{grid-template-columns:90px 166px minmax(190px,420px) 108px 108px;gap:9px;min-width:845px}
  .panel-titlebar{flex-wrap:wrap}
}

/* Classic project editor: project information at left, original cover gallery at right. */
.settings-root{width:100%;max-width:1480px;margin:0 auto;gap:12px}
.project-settings-layout{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.05fr);grid-template-rows:auto auto;gap:12px;align-items:start}
.project-configuration{grid-column:1;grid-row:1;display:flex;flex-direction:column;gap:11px;min-width:0}
.project-settings-layout>.generation-panel{grid-column:1/-1;grid-row:2;min-width:0}
.project-configuration .project-location-row{grid-template-columns:minmax(0,1fr) auto}
.project-configuration .project-location-row label:nth-of-type(2){grid-column:1/-1}
.project-configuration .project-basics{grid-template-columns:minmax(0,1fr) 142px}
.manual-selection{grid-column:2;grid-row:1;display:flex;flex-direction:column;gap:12px;min-width:0}
.manual-browser{padding:13px 15px!important}
.manual-browser-head{display:flex;justify-content:space-between;align-items:start;gap:12px;margin-bottom:10px}
.manual-browser-head h3{font-size:15px;margin:0 0 4px}
.manual-browser-head p{margin:0;font-size:11px}
.manual-browser-head .toolbar{justify-content:flex-end;flex-shrink:0}
.manual-browser-head button{padding:5px 7px;font-size:11px;white-space:nowrap}
.manual-cover-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;max-height:335px;overflow-y:auto;overflow-x:hidden;padding:2px 4px 5px 2px}
.settings-root .manual-cover-tile{display:block;position:relative;min-width:0;padding:0!important;min-height:0!important;aspect-ratio:1 / 1.12;overflow:hidden;background:var(--el-fill-color-light,#f0f3f7);border:2px solid transparent;border-radius:8px;outline:0;transition:border-color .15s,box-shadow .15s}
.settings-root .manual-cover-tile:hover{border-color:var(--el-color-primary-light-5,#95bbf4)}
.settings-root .manual-cover-tile.active{border-color:var(--el-color-primary,#337ddc);box-shadow:0 0 0 1px var(--el-color-primary,#337ddc)}
.manual-cover-tile img{display:block;width:100%;height:100%;object-fit:cover}
.manual-cover-placeholder{height:100%;display:grid;place-items:center;font-size:36px;background:linear-gradient(135deg,#41536d,#9eacbf);color:#fff}
.manual-cover-label{position:absolute;bottom:0;left:0;right:0;padding:13px 5px 6px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.85));font-size:10px;font-weight:600;line-height:1.3;text-align:center;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.manual-cover-selected{position:absolute;top:4px;right:4px;border-radius:50%;background:var(--el-color-primary,#337ddc);color:white;width:20px;height:20px;display:grid;place-items:center;font-size:12px;box-shadow:0 1px 6px #0006}
.manual-selection-tip{margin:8px 0 0;font-size:11px;color:var(--el-text-color-secondary,#8090a5);line-height:1.5}
.settings-root .manual-inline-action{padding:0 4px;min-height:0;border:0;background:transparent;color:var(--el-color-primary,#337ddc);font-size:11px}
@media(max-width:1150px){
 .manual-browser-head{flex-wrap:wrap}
 .manual-cover-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media(max-width:840px){
 .project-settings-layout{grid-template-columns:1fr}
 .project-configuration,.manual-selection,.project-settings-layout>.generation-panel{grid-column:1;grid-row:auto}
 .manual-cover-grid{grid-template-columns:repeat(4,minmax(0,1fr));max-height:315px}
 .manual-browser-head{flex-wrap:nowrap}
}
@media(max-width:520px){
 .manual-cover-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
 .manual-browser-head{flex-wrap:wrap}
 .project-configuration .project-basics{grid-template-columns:1fr}
}
/* Teleported manual editor: actual modal with fixed footer and split Markdown preview. */
.manual-modal-mask{position:fixed;inset:0;z-index:2147481000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(14,19,30,.7);backdrop-filter:blur(4px);box-sizing:border-box}
.manual-modal{display:flex;flex-direction:column;width:min(1360px,96vw);height:min(860px,91vh);max-height:calc(100vh - 36px);min-width:0;overflow:hidden;border:1px solid var(--el-border-color,#d7dde7);border-radius:13px;background:var(--el-bg-color,#fff);color:var(--el-text-color-primary,#172133);box-shadow:0 25px 110px #0008;font:12px/1.5 'Microsoft YaHei',sans-serif;box-sizing:border-box}
.manual-modal button{cursor:pointer;min-height:29px;padding:5px 10px;border:1px solid var(--el-border-color,#d5deeb);border-radius:6px;background:var(--el-fill-color-light,#f4f6fa);color:inherit;font:inherit}
.manual-modal button.primary{background:var(--el-color-primary,#337ddc);border-color:var(--el-color-primary,#337ddc);color:white}
.manual-modal button:disabled{opacity:.5;cursor:not-allowed}
.manual-modal-header{display:flex;justify-content:space-between;align-items:center;padding:13px 20px 11px;border-bottom:1px solid var(--el-border-color-lighter,#e8edf3)}
.manual-modal-header h3{margin:0;font-size:17px}
.manual-modal-header p{margin:3px 0 0;color:var(--el-text-color-secondary,#8793a4);font-size:11px}
.manual-modal .manual-close{border:0;background:transparent;font-size:22px;line-height:25px;padding:0 8px}
.manual-modal-error{margin:8px 20px 0;padding:8px;background:#fff0ee;color:#b82b2b;border-radius:5px}
.manual-modal-fields{padding:11px 20px 8px;display:grid;grid-template-columns:1fr 1fr;gap:7px 14px}
.manual-modal-fields>label{display:flex;flex-direction:column;gap:4px;font-size:12px}
.manual-modal-fields input:not([type=file]),.manual-modal-fields select{width:100%;min-height:33px;border:1px solid var(--el-border-color,#dce1eb);border-radius:6px;padding:6px 9px;box-sizing:border-box;background:var(--el-fill-color-blank,#fff);color:inherit;font:inherit}
.manual-modal-fields input:disabled{background:var(--el-fill-color-light,#f4f5f7);color:var(--el-text-color-secondary,#8b98a6)}
.manual-cover-uploader{grid-column:1/-1;padding-top:3px}
.manual-cover-uploader>strong{display:block;font-size:12px;margin-bottom:5px}
.manual-cover-upload-row{display:flex;align-items:center;gap:9px}
.manual-cover-upload-row img,.manual-empty-cover{width:73px;height:55px;border-radius:6px;object-fit:cover;border:1px solid var(--el-border-color,#d8e0eb);background:var(--el-fill-color-light,#f3f6f9)}
.manual-empty-cover{display:grid;place-items:center;color:#8792a2;font-size:11px}
.manual-upload-button{display:inline-flex;align-items:center;position:relative;cursor:pointer;padding:5px 11px;border:1px dashed var(--el-border-color,#b8c8d9);border-radius:6px;min-height:30px;box-sizing:border-box;color:var(--el-color-primary,#337ddc)}
.manual-upload-button input{display:none}
.manual-markdown-area{display:flex;flex-direction:column;flex:1;min-height:0;padding:0 20px 12px}
.manual-markdown-area h4{font-size:12px;margin:4px 0 7px}
.manual-section-tabs{display:flex;flex:0 0 auto;align-items:center;gap:2px;min-height:37px;overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--el-border-color,#d8e0eb);scrollbar-width:thin}
.manual-modal .manual-section-tabs button{position:relative;white-space:nowrap;background:transparent;border:0;border-radius:0;padding:6px 12px;min-height:36px;color:var(--el-text-color-secondary,#7d8999);font-weight:500}
.manual-modal .manual-section-tabs button.active{color:var(--el-color-primary,#337ddc);font-weight:650}
.manual-section-tabs button.active:after{content:"";position:absolute;bottom:0;left:6px;right:6px;background:var(--el-color-primary,#337ddc);height:2px}
.manual-modal .manual-section-tabs .manual-add-tab{color:var(--el-color-primary,#337ddc)}
.manual-section-editor{display:flex;flex-direction:column;flex:1;min-height:0}
.manual-edit-toolbar{display:flex;align-items:center;gap:3px;flex:0 0 auto;padding:7px 0}
.manual-modal .manual-edit-toolbar button{min-width:28px;padding:3px 7px;min-height:29px;border:0;background:transparent}
.manual-modal .manual-edit-toolbar button:hover{background:var(--el-fill-color-light,#edf2fa)}
.manual-edit-spacer{flex:1;min-width:3px}
.manual-edit-toolbar .manual-section-title-input{border:1px solid var(--el-border-color,#d7e0ea);border-radius:5px;background:var(--el-fill-color-blank,#fff);color:inherit;padding:4px 6px;width:160px;min-width:80px;font:inherit}
.manual-editor-columns{display:grid;grid-template-columns:1fr 1fr;flex:1;min-height:0;border:1px solid var(--el-border-color,#d8e0e9);border-radius:7px;overflow:hidden}
.manual-editor-columns textarea{display:block;width:100%;height:100%;min-height:0;resize:none;outline:0;box-sizing:border-box;border:0;border-right:1px solid var(--el-border-color,#d8e0ea);background:var(--el-fill-color-blank,#fff);color:var(--el-text-color-primary,#1f2937);padding:16px;font:12px/1.7 Consolas,'Microsoft YaHei',monospace;white-space:pre-wrap}
.manual-markdown-preview{height:100%;box-sizing:border-box;overflow:auto;padding:14px 18px;color:var(--el-text-color-primary,#1f2937);background:var(--el-bg-color,#fff);font-size:12px;line-height:1.75;overflow-wrap:anywhere}
.manual-markdown-preview :deep(h1){font-size:22px;line-height:1.35;margin:0 0 12px}
.manual-markdown-preview :deep(h2){font-size:18px;margin:18px 0 8px}
.manual-markdown-preview :deep(h3){font-size:15px;margin:12px 0 5px}
.manual-markdown-preview :deep(p){margin:8px 0}
.manual-markdown-preview :deep(ul),.manual-markdown-preview :deep(ol){padding-left:24px;margin:8px 0}
.manual-markdown-preview :deep(li){margin:3px 0}
.manual-markdown-preview :deep(blockquote){margin:8px 0;padding:6px 10px;border-left:3px solid #95b5e2;background:var(--el-fill-color-light,#f1f5fa)}
.manual-markdown-preview :deep(table){border-collapse:collapse;width:100%;font-size:11px;margin:10px 0}
.manual-markdown-preview :deep(td),.manual-markdown-preview :deep(th){border:1px solid var(--el-border-color,#dce3ed);padding:5px 7px;vertical-align:top}
.manual-markdown-preview :deep(pre){overflow:auto;background:var(--el-fill-color-light,#f1f4f8);padding:10px}
.manual-markdown-preview :deep(code){background:var(--el-fill-color-light,#f3f5f8);padding:2px 4px;border-radius:3px}
.manual-modal-footer{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:11px 20px;border-top:1px solid var(--el-border-color,#e0e6ee)}
.manual-modal-footer p{font-size:10px;color:var(--el-text-color-secondary,#7e8b9d);margin:0}
.manual-footer-spacer{flex:1}
.manual-modal .manual-danger{color:var(--el-color-danger,#cb4545);border-color:var(--el-color-danger-light-7,#e9c2c2)}
@media(max-width:760px){
 .manual-modal-mask{padding:6px}
 .manual-modal{width:100%;height:calc(100vh - 12px);max-height:calc(100vh - 12px)}
 .manual-modal-fields{grid-template-columns:1fr;padding:10px}
 .manual-modal-fields .manual-cover-uploader{grid-column:1}
 .manual-markdown-area{padding:0 10px 8px}
 .manual-modal-header,.manual-modal-footer{padding:9px 10px}
 .manual-editor-columns{grid-template-columns:1fr;grid-template-rows:1fr 1fr}
 .manual-editor-columns textarea{border-right:0;border-bottom:1px solid var(--el-border-color,#dce3eb)}
 .manual-edit-toolbar .manual-section-title-input{width:95px}
}
/* Full-width project settings: generation controls now stay in the left column. */
.settings-root{width:100%;max-width:none;margin:0;box-sizing:border-box;min-width:0}
.project-settings-layout{grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);grid-template-rows:auto;gap:12px}
.project-configuration{grid-column:1;grid-row:1;gap:10px}
.project-settings-layout .generation-panel{grid-column:auto;grid-row:auto;min-width:0}
.manual-selection{grid-column:2;grid-row:1;min-width:0}
.project-configuration .generation-rows{max-width:100%;width:100%;overflow-x:auto}
.project-configuration .generation-head,.project-configuration .generation-row{
  grid-template-columns:68px 105px minmax(128px,1fr) 62px 62px;gap:6px;min-width:0
}
.project-configuration .generation-row{min-height:40px}
.project-configuration .generation-head{font-size:10px}
.project-configuration .generation-row>strong{font-size:11px}
.project-configuration .generation-row .mode-fixed,.project-configuration .generation-row .mode-empty{
  padding:0 6px;white-space:normal;font-size:10px;line-height:1.35
}
.project-configuration .generation-row select{min-width:0;width:100%;font-size:11px;padding:5px 5px}
.project-configuration .generation-row>input[type=number]{width:100%;min-width:0;max-width:none;text-align:center;padding:5px 2px;font-size:11px}
.project-configuration .generation-head>span:nth-child(n+4){text-align:center}
.project-configuration .generation-panel .panel-titlebar{align-items:center}
.project-configuration .generation-panel .toolbar{flex-wrap:nowrap}
.project-configuration .generation-panel .toolbar button{white-space:nowrap;font-size:10px;padding:4px 7px}
.generation-footnote{font-size:10px}
.manual-browser-head .toolbar{align-self:center}
.manual-cover-tile{isolation:isolate}
.manual-cover-pick{position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%;min-height:0!important;padding:0!important;background:transparent!important;border:0!important;border-radius:0!important;overflow:hidden;cursor:pointer}
.manual-cover-pick img{height:100%;width:100%;object-fit:cover}
.manual-cover-pick .manual-cover-label{pointer-events:none}
.manual-cover-action,.manual-cover-view{position:absolute;z-index:3;opacity:0;pointer-events:none;transition:opacity .15s,background .15s}
.settings-root .manual-cover-tile:hover .manual-cover-action,
.settings-root .manual-cover-tile:hover .manual-cover-view,
.settings-root .manual-cover-tile:focus-within .manual-cover-action,
.settings-root .manual-cover-tile:focus-within .manual-cover-view{opacity:1;pointer-events:auto}
.manual-cover-tile:hover:before,.manual-cover-tile:focus-within:before{
  content:"";position:absolute;z-index:2;inset:0;pointer-events:none;background:rgba(5,15,30,.25)
}
.settings-root .manual-cover-action{display:grid;place-items:center;width:26px;height:26px;min-height:26px!important;
  padding:0!important;border:0!important;border-radius:6px!important;background:rgba(26,107,217,.95)!important;
  color:#fff!important;font-size:16px!important;line-height:1;box-shadow:0 2px 7px #0006}
.settings-root .manual-cover-action:hover{background:#1055bd!important}
.settings-root .manual-cover-edit{top:6px;left:6px}
.manual-cover-right{position:absolute;z-index:3;top:6px;right:6px;display:flex;align-items:center;gap:4px}
.manual-cover-right .manual-cover-action{position:static}
.settings-root .manual-cover-delete{background:rgba(211,49,49,.96)!important}
.settings-root .manual-cover-delete:hover{background:#b62525!important}
.settings-root .manual-cover-view{left:50%;top:50%;transform:translate(-50%,-50%);width:max-content;max-width:calc(100% - 20px);
  min-height:30px;padding:6px 11px;border:0;border-radius:7px;background:rgba(19,93,207,.96);color:#fff;
  box-shadow:0 3px 12px #0005;font-size:11px;font-weight:600;white-space:nowrap}
.manual-cover-selected{z-index:2;top:auto;right:auto;left:6px;bottom:6px;width:19px;height:19px}
.manual-cover-tile:hover .manual-cover-selected{opacity:.15}
.settings-root .manual-cover-tile{cursor:default}
@media(hover:none){
 .settings-root .manual-cover-tile .manual-cover-action,.settings-root .manual-cover-tile .manual-cover-view{opacity:1;pointer-events:auto}
 .manual-cover-tile:before{content:"";position:absolute;z-index:2;inset:0;pointer-events:none;background:rgba(5,15,30,.12)}
}
@media(max-width:1180px){
 .project-settings-layout{grid-template-columns:minmax(0,1fr)}
 .project-configuration,.manual-selection{grid-column:1;grid-row:auto}
 .project-configuration .generation-head,.project-configuration .generation-row{
   grid-template-columns:90px 150px minmax(190px,1fr) 90px 90px;gap:7px
 }
 .manual-cover-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
}
@media(max-width:750px){
 .project-configuration .generation-head,.project-configuration .generation-row{
  grid-template-columns:68px 105px minmax(128px,1fr) 62px 62px;gap:6px;min-width:490px
 }
 .manual-cover-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media(max-width:520px){.manual-cover-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.manual-cover-action svg{display:block;width:15px;height:15px;stroke-linecap:round;stroke-linejoin:round}
.settings-root .manual-cover-view{display:flex;align-items:center;justify-content:center;gap:5px}
.manual-cover-view svg{width:15px;height:15px;flex:none;stroke-linecap:round;stroke-linejoin:round}

/* Visual manuals occupy the first row; director manuals the second. Each category scrolls horizontally in one cover strip. */
.manual-selection{display:grid!important;grid-template-columns:minmax(0,1fr);align-items:start;gap:10px;min-width:0}
.manual-selection>.manual-browser{min-width:0;padding:10px 12px!important}
.manual-selection .manual-browser-head{display:flex;align-items:center;justify-content:space-between;gap:7px;min-height:32px;margin-bottom:7px;flex-wrap:nowrap}
.manual-selection .manual-browser-head h3{margin:0;font-size:13px;white-space:nowrap}
.manual-selection .manual-browser-head p{display:none}
.manual-selection .manual-browser-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:nowrap;gap:4px;min-width:0;flex-shrink:0}
.manual-selection .manual-browser-actions button{min-height:27px;padding:4px 7px;font-size:10px;white-space:nowrap}
.manual-selection .manual-browser-actions .manual-scroll-button{display:grid;place-items:center;width:26px;min-width:26px;padding:0;font-size:22px;line-height:1}
.manual-selection .manual-cover-grid{display:flex!important;flex-direction:row;flex-wrap:nowrap;align-items:stretch;gap:7px;max-height:none;overflow-x:auto;overflow-y:hidden;padding:2px 2px 7px;scroll-snap-type:x proximity;scrollbar-width:thin;overscroll-behavior-x:contain}
.settings-root .manual-selection .manual-cover-tile{display:block;flex:0 0 102px;width:102px;height:113px;min-width:102px;min-height:113px;aspect-ratio:auto;scroll-snap-align:start}
.manual-selection .manual-cover-label{font-size:10px}
.manual-selection .manual-selection-tip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;margin:5px 0 0;line-height:1.3}
.manual-selection .manual-inline-action{white-space:nowrap;font-size:10px}
.project-header-actions{gap:7px;justify-content:flex-end}
.project-header-actions button{white-space:nowrap}
@media(max-width:620px){
  .manual-selection{grid-template-columns:1fr}
  .project-header{flex-wrap:wrap}
  .project-header-actions{width:100%;justify-content:flex-start}
}
</style>
