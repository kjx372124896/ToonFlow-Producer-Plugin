<template>
<div class="asset-library">
  <header class="asset-header"><div><h2>{{ mode==='picker' ? '选择分镜板资产图片' : '项目资产库' }}</h2><p>{{ mode==='picker' ? '选择已有图片版本，或在资产详情中上传 / 生成新版本。' : '角色 / 场景 / 道具 / 音频 · 批量生成与版本管理' }}</p></div>
    <div class="asset-buttons"><button :disabled="operationsBusy" @click="newAsset">＋ 新增资产</button><button class="primary" :disabled="operationsBusy || !studio.scripts.length" @click="extractSelected">AI 提取资产</button><button v-if="extracting" @click="cancelExtraction">停止提取</button></div>
  </header>
  <p v-if="error" class="asset-error">{{error}} <button @click="error=''">关闭</button></p>
  <div class="asset-filter">
    <div class="categories"><button v-for="k in (mode==='picker'?['全部','角色','场景','道具']:['全部','角色','场景','道具','音频'])" :key="k" :class="{active:kind===k}" @click="kind=k">{{k}} <small>{{countFor(k)}}</small></button></div>
    <label>按集查看 <select v-model="episode"><option value="">整个项目</option><option v-for="s in studio.scripts" :key="s.id" :value="s.id">第{{s.episode}}集 · {{s.title}}</option></select></label>
    <input v-model="query" placeholder="搜索资产名称、别名…" />
  </div>
  <section v-if="mode!=='picker'" class="asset-batch-bar" aria-label="资产批量操作">
    <div class="batch-main-row">
    <div class="batch-select">
      <label class="batch-check"><input type="checkbox" :checked="allVisibleSelected" :disabled="operationsBusy || !filtered.length" @change="selectVisibleAssets($event.target.checked)" />全选当前筛选（{{ filtered.length }}）</label>
      <strong>已选 {{ selectedAssets.length }} 项</strong>
      <button :disabled="operationsBusy || !selectedIds.length" @click="clearSelection">清空选择</button>
    </div>
    <div class="batch-actions">
      <button class="danger batch-delete" :disabled="operationsBusy || !selectedAssets.length" @click="deleteSelectedAssets">删除选中（{{ selectedAssets.length }}）</button>
      <button class="primary" title="只处理勾选资产，逐项调用文本模型并保存生成提示词" :disabled="operationsBusy || !selectedAssets.length" @click="startBatch('prompt')">生成提示词（{{ selectedAssets.length }}）</button>
      <button class="primary" title="只处理勾选的角色、场景和道具，不包含音频资产" :disabled="operationsBusy || !selectedVisualAssets.length" @click="startBatch('image')">生成图片（{{ selectedVisualAssets.length }}）</button>
      <button type="button" class="batch-config-toggle" :aria-expanded="showBatchSettings" @click="showBatchSettings=!showBatchSettings">{{showBatchSettings?'收起配置':'⚙ 生成配置'}}</button>
      <button v-if="batchBusy" @click="cancelBatch">停止生成</button>
    </div>
    </div>
    <div v-if="showBatchSettings" class="batch-settings">
      <div class="batch-options">
        <label>提示词模型<select v-model="batchTextModel" :disabled="batchBusy"><option value="">项目默认文本模型</option><option v-for="m in models.text" :key="m.value" :value="m.value">{{m.providerLabel}} · {{m.label}}</option></select></label>
        <label>图片生成方式<select v-model="batchImageMode" :disabled="batchBusy"><option value="model">图片模型</option><option value="rh">RH 工作流</option></select></label>
        <label v-if="batchImageMode==='model'">图片模型<select v-model="batchImageModel" :disabled="batchBusy"><option value="">项目默认图片模型</option><option v-for="m in models.image" :key="m.value" :value="m.value">{{m.providerLabel}} · {{m.label}}</option></select></label>
        <label v-else>RH 图片应用<select v-model="batchImageRhUid" :disabled="batchBusy"><option value="">项目默认 RH 应用</option><option v-for="a in rhApps" :key="a.uid" :value="a.uid">{{a.name}}</option></select></label>
      </div>
    </div>
    <p v-if="removeNotice" class="batch-status" role="status">{{ removeNotice }}</p>
    <p v-if="batchStatus" class="batch-status" role="status">{{ batchStatus }}</p>
    <div v-if="batchErrors.length" class="batch-errors"><p v-for="item in batchErrors" :key="item.id">{{ item.name }}：{{ item.message }}</p></div>
  </section>
  <section v-if="review.length || extracting || extractErrors.length" class="extract-review">
    <div class="review-head"><div><strong>待确认的 AI 资产提取结果</strong><p>当前仅提取名称、类型、别名、身份线索和30–80字资产描述，不生成提示词；确认入库后，可在资产库勾选并批量生成提示词。请核对同名人物和跨集归属。</p></div>
      <div><span v-if="extracting">正在分析 {{processed}} / {{extractTotal}} 集</span> <button :disabled="extracting || !review.length" class="primary" @click="commitReview">确认并保存 {{review.length}} 条资产</button><button :disabled="extracting" @click="clearReview">清空待审核</button></div></div>
    <div v-for="candidate in review" :key="candidate.id" class="candidate">
      <div class="candidate-title"><strong>{{candidate.kind}} · {{candidate.name}}</strong><span>{{scriptTitle(candidate.scriptId)}}</span></div>
      <label class="candidate-description">资产描述（不含生成提示词）<textarea v-model="candidate.description" rows="2" @change="saveReview" placeholder="角色/场景/道具的可核实外观，或音频的声音特征；建议30–80字" /><small>{{candidate.description?.length||0}} 字 · 目标30–80字，原文信息不足时不用臆造</small></label>
      <p class="muted">{{candidate.identityHint || '未提供身份线索'}} <span v-if="candidate.aliases.length">· 其他称呼：{{candidate.aliases.join('、')}}</span></p>
      <label>实体归属 <select v-model="candidate.bindTo" @change="saveReview">
        <option value="">按正式名称去重，否则创建新资产</option>
        <option value="__new__">明确新建身份（即使同名）</option>
        <option v-for="a in studio.assets.filter(a=>a.kind===candidate.kind)" :key="a.id" :value="a.id">绑定到 {{a.name}} · {{a.identityHint||'未补充身份'}}</option>
      </select></label>
    </div>
    <p v-if="extractErrors.length" class="asset-error" v-for="item in extractErrors" :key="item.id">第{{item.episode}}集：{{item.message}}</p>
  </section>
  <div class="asset-grid">
    <div v-for="asset in filtered" :key="asset.id" class="asset-card" :class="{'asset-card-selected':selectedIds.includes(asset.id)}" @click="openDetail(asset)">
      <label v-if="mode!=='picker'" class="asset-select" @click.stop @pointerdown.stop><input type="checkbox" :checked="selectedIds.includes(asset.id)" :disabled="operationsBusy" :aria-label="'选择资产 '+asset.name" @change="toggleAssetSelection(asset.id,$event.target.checked)" /></label>
      <div class="asset-thumb"><img v-if="previews[asset.imagePath]" :src="previews[asset.imagePath]" :alt="asset.name" /><span v-else-if="asset.kind==='音频'" class="asset-audio-icon">♫<small>{{asset.audios?.length||0}} 个音频</small></span><span v-else>暂无预览图</span></div>
      <div class="asset-caption"><strong :title="asset.name">{{asset.name}}</strong><small>{{asset.kind}} · {{asset.images?.length||0}} 图{{asset.audios?.length?' · '+asset.audios.length+' 音频':''}}</small></div>
      <div v-if="asset.imagePrompt || asset.audioPrompt" class="asset-prompt-state">✓ 提示词已生成</div>
      <button v-if="mode!=='picker'" class="asset-card-delete danger" type="button" :disabled="operationsBusy" :aria-label="'删除资产 '+asset.name" @click.stop="deleteOneAsset(asset)" @pointerdown.stop>删除资产</button>
      <p v-if="asset.aliases?.length" class="muted">别名：{{asset.aliases.join('、')}}</p>
    </div>
    <p v-if="!filtered.length" class="empty">当前分类或集数下没有资产，可从已确认的剧本提取，也可手动新增。</p>
  </div>
  <div v-if="detail" class="asset-overlay" role="presentation" @click.self="closeDetail" @wheel.stop @pointerdown.stop>
    <div class="asset-detail" role="dialog" aria-modal="true" :aria-label="detail.name+'资产详情'" @click.stop>
      <header><div><h3>{{detail.name}} · {{detail.kind}}</h3><p>图片版本 / 衍生修改 / 生成配置 / 资产资料</p></div><button @click="closeDetail">关闭 ×</button></header>
      <p v-if="error" class="asset-error">{{error}} <button @click="error=''">关闭</button></p>
      <div class="detail-layout"><div class="media-area">
        <div v-if="detail.kind!=='音频'" class="large-preview"><img v-if="currentPreviewImage && previews[currentPreviewImage.path]" :src="previews[currentPreviewImage.path]" :alt="detail.name+' 当前预览'" /><span v-else>暂无图片，请上传或生成。</span><button v-if="currentPreviewImage && previews[currentPreviewImage.path]" class="preview-zoom-button" type="button" @click="openZoom">⤢ 放大查看</button><span v-if="currentPreviewImage" class="preview-indicator">当前预览 · {{ detail.images.findIndex(img=>img.id===currentPreviewImage.id)+1 }} / {{ detail.images.length }}</span></div>
        <div v-else class="audio-detail-preview"><strong>♫ 音频资产</strong><span>{{detail.audioPrompt || detail.description || '可编辑声音描述或上传已有音频文件。'}}</span></div>
        <div v-if="detail.kind!=='音频'" class="image-row" aria-label="图片版本列表"><div class="image-version" :class="{active:currentPreviewImage?.id===img.id}" v-for="(img,index) in detail.images" :key="img.id">
          <button class="image-version-preview" type="button" :aria-label="'预览图片 '+(index+1)" :aria-pressed="currentPreviewImage?.id===img.id" @click="selectPreview(img.id)">
            <img v-if="previews[img.path]" :src="previews[img.path]" :alt="detail.name+' 图片 '+(index+1)" />
            <span v-else>读取中…</span><span v-if="img.id===detail.defaultImageId" class="image-default-mark">默认</span>
          </button>
          <div class="image-version-actions"><button :disabled="img.id===detail.defaultImageId" @click="chooseDefault(img.id)">{{img.id===detail.defaultImageId?'✓ 默认':'设默认'}}</button><button v-if="mode==='picker'" class="primary" @click="selectImage(img.id)">用于分镜</button><button class="danger" @click="removeImage(img.id)">删除</button></div>
        </div></div>
        <div v-if="detail.kind!=='音频'" class="generation-box shared-image-settings">
          <strong>图片生成配置 <small>基础图片与衍生图片共用</small></strong>
          <label>生成方式<select v-model="imageMode"><option value="model">图片模型</option><option value="rh">RH 工作流</option></select></label>
          <label v-if="imageMode==='model'">图片模型<select v-model="imageModel"><option value="">项目默认图片模型</option><option v-for="m in models.image" :key="m.value" :value="m.value">{{m.providerLabel}} · {{m.label}}</option></select></label>
          <label v-else>RH 图片应用<select v-model="imageRhUid"><option value="">请选择应用</option><option v-for="a in rhApps" :key="a.uid" :value="a.uid">{{a.name}}</option></select></label>
          <label v-if="imageMode==='model'">画面比例<select v-model="imageRatio"><option v-for="r in ['16:9','1:1','2:3','3:2','9:16','3:4','4:3','4:5','5:4']" :key="r" :value="r">{{r}}</option></select></label>
          <button class="primary" :disabled="operationsBusy" @click="generateImage">{{mediaBusy?'生成中…':'生成基础图片'}}</button>
        </div>
        <section v-if="detail.kind!=='音频' && mode!=='picker'" class="derivative-section">
          <div class="derivative-heading"><strong>衍生资产 · {{(detail.derivatives||[]).length}}</strong><small>同一基础资产的换装、妆造或状态版本</small></div>
          <div class="derivative-create">
            <span class="derivative-reference">参考图：{{currentPreviewImage?'当前预览 #'+(detail.images.findIndex(i=>i.id===currentPreviewImage.id)+1):'尚未选择图片'}}</span>
            <input v-model="derivativeInstruction" placeholder="自由输入修改变化，例如：更换浅色职业西装，脸部不变" aria-label="衍生变化要求" />
            <button type="button" :disabled="operationsBusy || !derivativeInstruction.trim() || !currentPreviewImage" @click="createDerivative">＋ 新建衍生方案</button>
          </div>
          <p class="derivative-hint">默认引用当前预览图片，填修改要求即可直接生图；可选先生成衍生提示词。图片模型和比例与上方共用，RH 暂不支持参考图生图。</p>
          <article v-for="variant in detail.derivatives||[]" :key="variant.id" class="derivative-item">
            <div class="derivative-item-head"><strong>{{variant.type}}</strong><span>{{variant.images.length}} 张</span><button class="danger" :disabled="operationsBusy" @click="deleteDerivative(variant)">删除方案</button></div>
            <select v-model="variant.baseImageId" aria-label="衍生参考图片" @change="persist"><option value="">选择参考图</option><option v-for="(image,index) in detail.images" :key="image.id" :value="image.id">图片 {{index+1}}{{image.derivativeId?' · 衍生':''}}{{image.id===currentPreviewImage?.id?' · 当前预览':''}}</option></select>
            <textarea v-model="variant.instruction" rows="2" @change="persist" placeholder="只描述需要改变的服饰、造型或状态"></textarea>
            <textarea v-model="variant.prompt" rows="3" @change="persist" placeholder="点击生成衍生提示词，也可以手动编辑"></textarea>
            <div class="derivative-actions">
              <button type="button" :disabled="operationsBusy" @click="generateDerivativePrompt(variant)">生成衍生提示词</button>
              <button type="button" class="primary" :disabled="operationsBusy || imageMode==='rh' || !variant.instruction?.trim() || !detail.images.some(i=>i.id===variant.baseImageId)" @click="generateDerivativeImage(variant)">参考图生成衍生图片</button>
            </div>
          </article>
        </section>
        <div class="asset-audios" v-if="detail.audios.length"><strong>已有音频文件</strong><div v-for="audio in detail.audios" :key="audio.id"><audio v-if="previews[audio.path]" controls :src="previews[audio.path]"></audio><span>{{audio.path.split('/').at(-1)}}</span><button @click="removeAudio(audio.id)">移除</button></div></div>
      </div><div class="detail-controls">
        <label>正式名称 <input v-model="detail.name" @change="persist" /></label>
        <label>{{detail.kind==='音频'?'声音来源 / 使用场景':'身份线索'}} <input v-model="detail.identityHint" @change="persist" placeholder="身份背景、声音来源或使用场景…" /></label>
        <label>资产别名（顿号分隔） <input :value="detail.aliases.join('、')" @change="setAliases($event.target.value)" /></label>
        <label>资产原始描述 <textarea v-model="detail.description" rows="4" @change="persist" /></label>
        <label>{{detail.kind==='音频'?'音频生成提示词':'图片生成提示词'}} <textarea v-if="detail.kind==='音频'" v-model="detail.audioPrompt" rows="5" @change="persist" placeholder="可由批量生成提示词创建，也可以手动编辑" /><textarea v-else v-model="detail.imagePrompt" rows="5" @change="persist" placeholder="可由批量生成提示词创建，也可以手动编辑" /></label>
        <div class="asset-prompt-action"><select v-model="derivativeTextModel" aria-label="提示词文本模型" :disabled="operationsBusy"><option value="">项目默认文本模型</option><option v-for="m in models.text" :key="m.value" :value="m.value">{{m.providerLabel}} · {{m.label}}</option></select><button :disabled="operationsBusy" @click="generateSinglePrompt">生成基础提示词</button></div>
        <p v-if="detail.kind!=='音频'" class="manual-applied" :class="{missing:!manualApplied}">{{manualApplied?'✓ 已引用项目视觉手册：全局基础美学＋'+detail.kind+'基础规范':'⚠ 未配置项目视觉手册，生成时将使用资产自身描述'}}</p>
        <p class="muted">出现场次：{{(detail.scriptIds||[]).map(scriptTitle).join('、')||'暂未关联'}}</p>
        <label>身份合并 <select v-model="mergeTarget"><option value="">选择要绑定到的其他现有资产</option><option v-for="a in studio.assets.filter(a=>a.id!==detail.id && a.kind===detail.kind)" :key="a.id" :value="a.id">将 {{detail.name}} 合并到 {{a.name}}</option></select></label>
        <button :disabled="!mergeTarget" @click="mergeCurrent">确认资产合并（保留媒体版本）</button>
        <label v-if="detail.kind!=='音频'" class="upload-btn">＋ 上传图片版本<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple @change="uploadImages" /></label>
        <label v-else class="upload-btn">＋ 上传音频文件<input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,audio/webm,audio/flac,audio/x-flac" multiple @change="uploadAudios" /></label>

        <button v-if="mode!=='picker'" class="danger" :disabled="operationsBusy" @click="deleteAsset">删除此资产（保留媒体文件）</button>
      </div></div>
    </div>
    <div v-if="zoomOpen && currentPreviewImage" class="asset-zoom-overlay" role="dialog" aria-modal="true" :aria-label="detail.name+'图片放大预览'" @click.self="zoomOpen=false" @wheel.stop>
      <button class="asset-zoom-close" type="button" @click="zoomOpen=false">关闭 ×</button>
      <img v-if="previews[currentPreviewImage.path]" :src="previews[currentPreviewImage.path]" :alt="detail.name+'放大预览'" />
    </div>
  </div>
</div>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue';
import {uid} from './studio.mjs';
import {ensureFolders} from './projectStorage.mjs';
import {parseModelValue,loadAvailableModels,loadRhApps,normalizeGeneration} from './generation.mjs';
import {loadTextModels} from './eventAnalysis.mjs';
import {normalizeAssetLibrary,assetsForScript,commitAssetCandidates,bindAssetIdentity,normalizeAsset,
  setDefaultImage,removeAssetImage,removeAssetsFromStudio,suggestions,extractScriptAssets} from './assetEngine.mjs';
import {generateAssetImage,generateAssetRh} from './assetMedia.mjs';
import {generateAssetPrompt,promptFieldForAsset,assetImageRatio,validateImageAsset} from './assetBatch.mjs';
import {composeAssetImagePrompt,visualManualParts} from './visualAssetRules.mjs';
import {addAssetDerivative,addDerivativeImage} from './assetDerivatives.mjs';
import {runTaskQueue,normalizeQueueSettings} from './taskQueue.mjs';
const props=defineProps({studio:{type:Object,required:true},context:{type:Object,required:true},request:{type:Object,default:null},mode:{type:String,default:'library'}});
const emit=defineEmits(['save','imageSelected']);
normalizeAssetLibrary(props.studio);
const kind=ref('全部'),episode=ref(''),query=ref(''),error=ref(''),detail=ref(null),mergeTarget=ref('');
const extracting=ref(false),processed=ref(0),extractTotal=ref(0),mediaBusy=ref(false);
const review=ref(props.studio.assetExtractionDrafts||[]),extractErrors=ref([]);
const models=reactive({text:[],image:[],audio:[]}),rhApps=ref([]);
const imageMode=ref('model'),imageModel=ref(''),imageRhUid=ref(''),imageRatio=ref('16:9');
const derivativeInstruction=ref(''),derivativeBaseImageId=ref('');
const derivativeTextModel=ref('');
const selectedPreviewId=ref(''),zoomOpen=ref(false);
const currentPreviewImage=computed(()=>detail.value?.images?.find(img=>img.id===selectedPreviewId.value)||detail.value?.images?.find(img=>img.id===detail.value.defaultImageId)||detail.value?.images?.[0]||null);
const manualApplied=computed(()=>detail.value?.kind!=='音频'&&!!visualManualParts(props.studio.project,detail.value?.kind).length);
const previews=ref({});const urls=new Map();let extractController=null;let mediaController=null;let lastRequest='';
const selectedIds=ref([]),batchTextModel=ref(''),batchImageModel=ref(''),batchImageMode=ref('model'),batchImageRhUid=ref('');
const showBatchSettings=ref(false);
const batchBusy=ref(false),batchStatus=ref(''),batchErrors=ref([]);let batchController=null;
const removeBusy=ref(false),removeNotice=ref('');
const operationsBusy=computed(()=>removeBusy.value||batchBusy.value||extracting.value||mediaBusy.value);
const selectedAssets=computed(()=>props.studio.assets.filter(a=>selectedIds.value.includes(a.id)));
const selectedVisualAssets=computed(()=>selectedAssets.value.filter(a=>a.kind!=='音频'));
const allVisibleSelected=computed(()=>filtered.value.length>0 && filtered.value.every(a=>selectedIds.value.includes(a.id)));
function toggleAssetSelection(id,checked){if(operationsBusy.value)return;selectedIds.value=checked?[...new Set([...selectedIds.value,id])]:selectedIds.value.filter(x=>x!==id);}
function selectVisibleAssets(checked){if(operationsBusy.value)return;const visible=new Set(filtered.value.map(a=>a.id));selectedIds.value=checked?[...new Set([...selectedIds.value,...visible])]:selectedIds.value.filter(id=>!visible.has(id));}
function clearSelection(){if(!operationsBusy.value)selectedIds.value=[];}
watch(()=>props.studio.assets.map(a=>a.id).join('|'),()=>{selectedIds.value=selectedIds.value.filter(id=>props.studio.assets.some(a=>a.id===id));});
const filtered=computed(()=>{const ids=episode.value?new Set(assetsForScript(props.studio,episode.value).map(a=>a.id)):null;return props.studio.assets.filter(a=>(props.mode!=='picker'||a.kind!=='音频')&&(kind.value==='全部'||a.kind===kind.value)&&(!ids||ids.has(a.id))&&[a.name,...(a.aliases||[])].join(' ').toLowerCase().includes(query.value.toLowerCase()));});
function countFor(k){return k==='全部'?props.studio.assets.length:props.studio.assets.filter(a=>a.kind===k).length;}
function scriptTitle(id){const s=props.studio.scripts.find(x=>x.id===id);return s?'第'+s.episode+'集':'未知集';}
function persist(){emit('save');}
function saveReview(){props.studio.assetExtractionDrafts=JSON.parse(JSON.stringify(review.value));persist();}
async function loadPreview(path,mimeType){
  if(!path||urls.has(path))return;
  try{
    const shared=props.context.files.acquireUrl?.(path,mimeType||'image/png');
    const url=shared?await shared.url:URL.createObjectURL(new Blob([await props.context.files.read(path)],{type:mimeType||'image/png'}));
    urls.set(path,{url,release:()=>shared?shared.release():URL.revokeObjectURL(url)});
    previews.value={...previews.value,[path]:url};
  }catch(e){error.value='读取资产媒体失败：'+e.message;}
}
watch(()=>props.studio.assets.flatMap(a=>[...(a.images||[]),...(a.audios||[]),...(a.derivatives||[]).flatMap(d=>d.images||[])]).map(x=>x.path).join('|'),()=>{
  for(const a of props.studio.assets)for(const f of [...(a.images||[]),...(a.audios||[]),...(a.derivatives||[]).flatMap(d=>d.images||[])])void loadPreview(f.path,f.mimeType);
},{immediate:true});
onBeforeUnmount(()=>{extractController?.abort();mediaController?.abort();batchController?.abort();for(const ref of urls.values())ref.release();urls.clear();});
onMounted(()=>{void refreshModels();});
async function refreshModels(){try{
  const [m,apps]=await Promise.all([loadAvailableModels(),loadRhApps()]);
  Object.assign(models,m);rhApps.value=apps;
  const cfg=normalizeGeneration(props.studio.project?.generation);
  batchImageMode.value=cfg.image.mode;batchImageRhUid.value=cfg.image.rhAppUid;
}catch(e){error.value='媒体模型或 RH 应用读取失败：'+e.message;}}
async function startExtraction(scriptIds){
  if(extracting.value)return;
  const scripts=props.studio.scripts.filter(s=>scriptIds.includes(s.id));
  if(!scripts.length){error.value='请选择至少一集已保存剧本';return;}
  let textModels;
  try{textModels=await loadTextModels();if(!textModels.length)throw new Error('尚无可用文本模型');}
  catch(e){error.value='无法开始资产提取：'+e.message;return;}
  const defaultModel=props.studio.project?.generation?.text?.model||textModels[0]?.value;
  if(!textModels.some(m=>m.value===defaultModel)){error.value='项目默认文本模型不可用，请在项目设置中修改';return;}
  const model=parseModelValue(defaultModel);
  const jobs=scripts.map(s=>({id:s.id,status:'queued',attempts:0,episode:s.episode}));
  const scope=props.studio,path=props.context.resource.path;extractController=new AbortController();const token=extractController;
  let batchSave=null;
  function persistBatch(){
    if(!batchSave)batchSave=new Promise((resolve,reject)=>setTimeout(async()=>{
      try{if(props.studio===scope && props.context.resource.path===path){emit('save');await props.context.flushSave();}resolve();}
      catch(e){reject(e);}finally{batchSave=null;}
    },50));
    return batchSave;
  }
  extracting.value=true;processed.value=0;extractTotal.value=scripts.length;extractErrors.value=[];error.value='';
  try{
    await runTaskQueue({jobs,concurrency:normalizeQueueSettings(scope.project?.queueSettings).text.concurrency,
      retries:normalizeQueueSettings(scope.project?.queueSettings).text.retries,signal:token.signal,
      async execute(job,signal){return extractScriptAssets(scripts.find(s=>s.id===job.id),model,{signal});},
      onSuccess(job,candidates){if(props.studio!==scope||props.context.resource.path!==path)return;
        review.value=[...review.value.filter(c=>c.scriptId!==job.id),...candidates];
        props.studio.assetExtractionDrafts=JSON.parse(JSON.stringify(review.value));processed.value++;
      },
      onFailure(job,e){extractErrors.value.push({id:job.id,episode:job.episode,message:e.message});processed.value++;},
      persist:persistBatch
    });
  }catch(e){error.value='资产提取队列中断：'+e.message;}
  finally{
    try{await batchSave;if(props.studio===scope&&props.context.resource.path===path){emit('save');await props.context.flushSave();}}
    catch(e){error.value='资产提取结果保存失败：'+e.message;}
    extracting.value=false;extractController=null;
  }
}
function cancelExtraction(){extractController?.abort();}
function extractSelected(){
  const ids=episode.value?[episode.value]:props.studio.scripts.map(s=>s.id);
  if(ids.length>1&&!confirm('将调用文本模型提取 '+ids.length+' 集剧本资产，可能产生模型费用。确定开始吗？'))return;
  void startExtraction(ids);
}
watch(()=>props.request,request=>{if(!request?.id||request.id===lastRequest)return;lastRequest=request.id;if(request.openAssetId){const asset=props.studio.assets.find(x=>x.id===request.openAssetId);if(asset)openDetail(asset);return;}if(request.scriptIds?.length)void startExtraction(request.scriptIds);},{immediate:true});
function commitReview(){
  if(!review.value.length||extracting.value)return;
  try{
    const copy=JSON.parse(JSON.stringify({assets:props.studio.assets,assetMentions:props.studio.assetMentions||[],
      scripts:props.studio.scripts,panels:props.studio.panels,assetExtractionDrafts:[]}));
    commitAssetCandidates(copy,review.value);
    props.studio.assets=copy.assets;props.studio.assetMentions=copy.assetMentions;
    review.value=[];saveReview();error.value='';persist();
  }catch(e){error.value='审核入库失败：'+e.message+'。请明确绑定有歧义的同名人物。';}
}
function clearReview(){if(review.value.length&&!confirm('清空未入库的提取结果？'))return;review.value=[];extractErrors.value=[];saveReview();}
function newAsset(){const asset=normalizeAsset({id:uid('asset'),kind:kind.value==='全部'?'角色':kind.value,name:'新资产',description:'',scriptIds:[],images:[],status:'待完善'});
 props.studio.assets.push(asset);persist();openDetail(asset);}
function closeDetail(){if(!mediaBusy.value){zoomOpen.value=false;detail.value=null;}}
function openDetail(asset){error.value='';detail.value=asset;mergeTarget.value='';zoomOpen.value=false;const cfg=normalizeGeneration(props.studio.project?.generation);
 imageMode.value=cfg.image.mode;imageRhUid.value=cfg.image.rhAppUid;
 imageRatio.value=assetImageRatio(asset);
 selectedPreviewId.value=asset.images?.find(i=>i.id===asset.defaultImageId)?.id||asset.images?.[0]?.id||'';
 derivativeInstruction.value='';derivativeBaseImageId.value=selectedPreviewId.value;}
function selectPreview(id){if(!detail.value?.images?.some(img=>img.id===id))return;selectedPreviewId.value=id;derivativeBaseImageId.value=id;}
function openZoom(){if(currentPreviewImage.value&&previews.value[currentPreviewImage.value.path])zoomOpen.value=true;}
function setAliases(value){detail.value.aliases=[...new Set(value.split(/[、,，]/).map(x=>x.trim()).filter(Boolean))];persist();}
function mergeCurrent(){if(!detail.value||!mergeTarget.value)return;
 const other=props.studio.assets.find(x=>x.id===mergeTarget.value);
 if(!confirm('将「'+detail.value.name+'」的所有集数引用、图片、别名绑定到「'+other?.name+'」？这会删除前者的独立身份索引。'))return;
 try{bindAssetIdentity(props.studio,detail.value.id,mergeTarget.value);detail.value=props.studio.assets.find(x=>x.id===mergeTarget.value);mergeTarget.value='';persist();}
 catch(e){error.value=e.message;}}
function chooseDefault(id){try{setDefaultImage(detail.value,id);selectPreview(id);persist();}catch(e){error.value=e.message;}}
function selectImage(id){if(props.mode!=='picker'||!detail.value)return;const image=detail.value.images?.find(x=>x.id===id);if(!image)return;emit('imageSelected',{assetId:detail.value.id,imageId:id,path:image.path});detail.value=null;}
async function removeImage(id){const a=detail.value,img=a.images.find(x=>x.id===id);if(!img||!confirm('确定删除此图片版本？'))return;
 try{const elsewhere=props.studio.assets.some(x=>x.id!==a.id&&x.images?.some(v=>v.path===img.path));
    if(!elsewhere)await props.context.files.remove(img.path);
    removeAssetImage(a,id);
    if(selectedPreviewId.value===id)selectedPreviewId.value=a.images?.find(image=>image.id===a.defaultImageId)?.id||a.images?.[0]?.id||'';
    if(derivativeBaseImageId.value===id)derivativeBaseImageId.value=selectedPreviewId.value;
    for(const variant of a.derivatives||[]){
      variant.images=(variant.images||[]).filter(image=>image.id!==id);
      if(variant.defaultImageId===id)variant.defaultImageId=variant.images[0]?.id||'';
      if(variant.baseImageId===id)variant.baseImageId='';
    }
    persist();
    const old=urls.get(img.path);if(old&&!elsewhere){old.release();urls.delete(img.path);delete previews.value[img.path];}
 }catch(e){error.value='删除图片失败：'+e.message;}}
async function removeAudio(id){const a=detail.value,item=a.audios.find(x=>x.id===id);if(!item||!confirm('删除本条配音？'))return;
 try{const elsewhere=props.studio.assets.some(x=>x.id!==a.id&&x.audios?.some(v=>v.path===item.path));
   if(!elsewhere)await props.context.files.remove(item.path);
   a.audios=a.audios.filter(x=>x.id!==id);persist();
 }catch(e){error.value=e.message;}}
async function uploadImages(ev){const input=ev.target,files=[...(input.files||[])];input.value='';if(!detail.value)return;
 const asset=detail.value;
 try{const folder=props.context.resource.path.replace(/\/[^/]+$/,'')+'/assets/'+asset.id;
 await ensureFolders(props.context.files,folder);
 for(const f of files){if(!/^image\/(png|jpeg|webp|avif)$/.test(f.type)||f.size>25e6)throw new Error('仅支持 PNG/JPEG/WebP/AVIF，单图不超过25MB');
 const ext=f.name.split('.').at(-1).replace(/[^a-z0-9]/gi,'').slice(0,5);
 const path=folder+'/'+uid('file')+'.'+ext;
 await props.context.files.write(path,await f.arrayBuffer(),true);
 const item={id:uid('image'),path,mimeType:f.type,source:'upload',createdAt:new Date().toISOString()};
 asset.images.push(item);if(!asset.defaultImageId)setDefaultImage(asset,item.id);selectedPreviewId.value=item.id;derivativeBaseImageId.value=item.id;void loadPreview(path,f.type);
 }persist();
 }catch(e){error.value='上传图片失败：'+e.message;}}
function cancelBatch(){batchController?.abort();}
async function startBatch(type){
  if(batchBusy.value||mediaBusy.value||extracting.value)return;
  const assets=type==='image'?selectedVisualAssets.value.slice():selectedAssets.value.slice();
  if(!assets.length){error.value=type==='image'?'请勾选至少一个角色、场景或道具资产':'请先勾选资产';return;}
  const cfg=normalizeGeneration(props.studio.project?.generation);
  let model=null,mode=batchImageMode.value,appUid='';
  try{
    if(type==='prompt'){
      model=parseModelValue(batchTextModel.value||cfg.text.model);
      if(!model)throw new Error('请在项目设置中选择默认文本模型，或在批量栏选择文本模型');
    }else{
      if(mode==='model'){
        const selected=batchImageModel.value||cfg.image.model;
        model=parseModelValue(selected);
        if(!model)throw new Error('请在项目设置中选择默认图片模型，或在批量栏选择图片模型');
      }else{
        appUid=batchImageRhUid.value||cfg.image.rhAppUid;
        if(!appUid)throw new Error('请在项目设置中选择默认 RH 图片应用，或在批量栏选择 RH 图片应用');
      }
    }
  }catch(e){error.value=e.message;return;}
  if(assets.length>1 && !confirm('将对已选中的 '+assets.length+' 个资产逐项调用'+(type==='prompt'?'文本':'图片')+'模型，会产生模型费用。确定开始吗？'))return;
  const scope=props.studio,startingPath=props.context.resource.path;
  batchBusy.value=true;batchErrors.value=[];error.value='';
  const controller=new AbortController();batchController=controller;
  let success=0,finished=0,cancelled=false;
  try{
    for(const picked of assets){
      if(controller.signal.aborted){cancelled=true;break;}
      if(props.studio!==scope||props.context.resource.path!==startingPath)throw new Error('项目已切换，批量操作已停止以保护资产数据');
      const asset=scope.assets.find(a=>a.id===picked.id);
      if(!asset){finished++;batchErrors.value.push({id:picked.id,name:picked.name,message:'资产已被删除'});continue;}
      batchStatus.value='正在'+(type==='prompt'?'生成提示词':'生成图片')+'：'+asset.name+'（'+(finished+1)+' / '+assets.length+'）';
      try{
        if(type==='prompt'){
          const generated=await generateAssetPrompt(asset,model,{signal:controller.signal,project:scope.project});
          if(controller.signal.aborted)throw new Error('操作已取消');
          asset[promptFieldForAsset(asset)]=generated;
        }else{
          validateImageAsset(asset);
          const images=mode==='rh'
            ?[await generateAssetRh(asset,'image',scope.project,props.context,{
              uid:appUid,signal:controller.signal,prompt:composeAssetImagePrompt(asset,scope.project),
              onBound:async()=>{persist();await props.context.flushSave();}
            })]
            :await generateAssetImage(asset,scope.project,props.context.files,{
              modelValue:batchImageModel.value||cfg.image.model,ratio:assetImageRatio(asset),signal:controller.signal
            });
          if(controller.signal.aborted)throw new Error('操作已取消');
          if(props.studio!==scope||props.context.resource.path!==startingPath)throw new Error('项目已切换');
          for(const item of images)attachImage(asset,item);
        }
        if(props.studio!==scope||props.context.resource.path!==startingPath)throw new Error('项目已切换');
        persist();await props.context.flushSave();
        success++;
      }catch(e){
        if(controller.signal.aborted){cancelled=true;break;}
        batchErrors.value.push({id:asset.id,name:asset.name,message:e.message||String(e)});
      }
      finished++;
    }
  }catch(e){error.value='批量任务中断：'+(e.message||String(e));}
  finally{
    batchBusy.value=false;batchController=null;
    batchStatus.value=(cancelled?'批量操作已停止；':'批量操作结束；')+'成功 '+success+' / '+assets.length+' 项'+
      (batchErrors.value.length?'，失败 '+batchErrors.value.length+' 项；可根据以下错误调整后重新生成。':'。');
  }
}
async function generateSinglePrompt(){
  const asset=detail.value;if(!asset||operationsBusy.value)return;
  let model;
  try{
    const cfg=normalizeGeneration(props.studio.project?.generation);
    model=parseModelValue(derivativeTextModel.value||cfg.text.model);
    if(!model)throw new Error('请先在此处或项目设置中选择文本模型');
  }catch(e){error.value=e.message;return;}
  const scope=props.studio,path=props.context.resource.path;
  mediaBusy.value=true;mediaController=new AbortController();error.value='';
  try{
    const prompt=await generateAssetPrompt(asset,model,{project:scope.project,signal:mediaController.signal});
    if(props.studio!==scope||props.context.resource.path!==path)throw new Error('项目已切换');
    asset[promptFieldForAsset(asset)]=prompt;
    persist();await props.context.flushSave();
  }catch(e){error.value='基础提示词生成失败：'+e.message;}
  finally{mediaBusy.value=false;mediaController=null;}
}
function createDerivative(){
  if(!detail.value||operationsBusy.value)return;
  try{
    addAssetDerivative(detail.value,{type:derivativeInstruction.value.trim().slice(0,24),instruction:derivativeInstruction.value,baseImageId:derivativeBaseImageId.value||selectedPreviewId.value});
    derivativeInstruction.value='';
    persist();
  }catch(e){error.value='新增衍生方案失败：'+e.message;}
}
function deleteDerivative(variant){
  if(!detail.value||operationsBusy.value||!confirm('删除「'+variant.type+'」衍生方案及关联图片索引？本地图片文件保留。'))return;
  const asset=detail.value;
  asset.derivatives=(asset.derivatives||[]).filter(d=>d.id!==variant.id);
  const removedIds=new Set((variant.images||[]).map(img=>img.id));
  asset.images=(asset.images||[]).filter(img=>!removedIds.has(img.id));
  for(const other of asset.derivatives||[])if(removedIds.has(other.baseImageId))other.baseImageId='';
  if(removedIds.has(selectedPreviewId.value))selectedPreviewId.value=asset.images.find(img=>img.id===asset.defaultImageId)?.id||asset.images[0]?.id||'';
  if(removedIds.has(derivativeBaseImageId.value))derivativeBaseImageId.value=selectedPreviewId.value;
  if(removedIds.has(asset.defaultImageId)){
    asset.defaultImageId=asset.images[0]?.id||'';
    asset.imagePath=asset.images[0]?.path||'';
    asset.mimeType=asset.images[0]?.mimeType||'';
  }
  persist();
}
async function generateDerivativePrompt(variant){
  const asset=detail.value;if(!asset||operationsBusy.value)return;
  let model;
  try{
    const cfg=normalizeGeneration(props.studio.project?.generation);
    model=parseModelValue(derivativeTextModel.value||cfg.text.model);
    if(!model)throw new Error('请先在衍生资产区或项目设置中选择文本模型');
  }catch(e){error.value=e.message;return;}
  const scope=props.studio,path=props.context.resource.path;
  mediaBusy.value=true;mediaController=new AbortController();error.value='';
  try{
    const prompt=await generateAssetPrompt(asset,model,{project:scope.project,derivative:variant,signal:mediaController.signal});
    if(props.studio!==scope||props.context.resource.path!==path)throw new Error('项目已切换');
    variant.prompt=prompt;
    persist();await props.context.flushSave();
  }catch(e){error.value='衍生提示词生成失败：'+e.message;}
  finally{mediaBusy.value=false;mediaController=null;}
}
async function generateDerivativeImage(variant){
  const asset=detail.value;if(!asset||operationsBusy.value)return;
  const scope=props.studio,path=props.context.resource.path;
  mediaBusy.value=true;mediaController=new AbortController();error.value='';
  try{
    if(imageMode.value==='rh')throw new Error('衍生图必须携带参考图片，RH 模式暂不支持；请在上方图片生成设置切换为图片模型');
    // 衍生生图与基础生图共用同一个图片模型和比例选择。
    const results=await generateAssetImage(asset,scope.project,props.context.files,{
      modelValue:imageModel.value,ratio:imageRatio.value,
      derivative:variant,signal:mediaController.signal
    });
    if(props.studio!==scope||props.context.resource.path!==path)throw new Error('项目已切换');
    for(const media of results){
      const image=addDerivativeImage(variant,media);
      asset.images.push({...image,derivativeId:variant.id});
      selectedPreviewId.value=image.id;derivativeBaseImageId.value=image.id;
      void loadPreview(image.path,image.mimeType);
    }
    persist();await props.context.flushSave();
  }catch(e){error.value='衍生图片生成失败：'+e.message;}
  finally{mediaBusy.value=false;mediaController=null;}
}
function attachImage(asset,media){const item={id:uid('image'),...media,createdAt:new Date().toISOString()};asset.images.push(item);if(!asset.defaultImageId)setDefaultImage(asset,item.id);selectedPreviewId.value=item.id;derivativeBaseImageId.value=item.id;void loadPreview(item.path,item.mimeType);}
async function generateImage(){if(!detail.value||mediaBusy.value||batchBusy.value)return;const asset=detail.value;
 mediaBusy.value=true;mediaController=new AbortController();error.value='';
 const startingPath=props.context.resource.path,scope=props.studio;
 try{let items;
   if(imageMode.value==='rh'){items=[await generateAssetRh(asset,'image',props.studio.project,props.context,{uid:imageRhUid.value,signal:mediaController.signal,prompt:composeAssetImagePrompt(asset,props.studio.project),onBound:persist})];}
   else items=await generateAssetImage(asset,props.studio.project,props.context.files,{modelValue:imageModel.value,signal:mediaController.signal,ratio:imageRatio.value});
   if(props.studio!==scope||props.context.resource.path!==startingPath)throw new Error('项目已切换，不写回旧资产');
   for(const item of items)attachImage(asset,item);
   persist();await props.context.flushSave();
 }catch(e){error.value='图片生成失败：'+e.message;}
 finally{mediaBusy.value=false;mediaController=null;}}
async function uploadAudios(ev){
 const input=ev.target,files=[...(input.files||[])];input.value='';if(!detail.value||detail.value.kind!=='音频')return;
 const asset=detail.value;
 try{
   const folder=props.context.resource.path.replace(/\/[^/]+$/,'')+'/assets/'+asset.id;
   await ensureFolders(props.context.files,folder);
   for(const f of files){
     const types={'audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/mp4':'m4a','audio/ogg':'ogg','audio/webm':'webm','audio/flac':'flac','audio/x-flac':'flac'};
     const ext=types[f.type];if(!ext||f.size>50e6)throw new Error('仅支持 MP3/WAV/M4A/OGG/WebM/FLAC，单文件不超过 50MB');
     const path=folder+'/'+uid('audio')+'.'+ext;
     await props.context.files.write(path,await f.arrayBuffer(),true);
     asset.audios.push({id:uid('audio'),path,mimeType:f.type,source:'upload',createdAt:new Date().toISOString()});
     void loadPreview(path,f.type);
   }
   persist();await props.context.flushSave();
 }catch(e){error.value='上传音频失败：'+e.message;}
}
// 点击卡片删除、详情删除和批量删除使用同一事务与持久化校验。
function deleteOneAsset(asset){void removeChosenAssets([asset?.id]);}
function deleteAsset(){if(detail.value)void removeChosenAssets([detail.value.id]);}
function deleteSelectedAssets(){void removeChosenAssets(selectedAssets.value.map(asset=>asset.id));}
async function removeChosenAssets(assetIds){
  if(props.mode==='picker'||operationsBusy.value)return;
  const idSet=new Set(assetIds.filter(Boolean));
  const targets=props.studio.assets.filter(asset=>idSet.has(asset.id));
  if(!targets.length)return;
  const names=targets.slice(0,6).map(asset=>asset.name).join('、');
  const additional=targets.length>6?' 等 '+targets.length+' 项':'';
  const headline=targets.length===1?'确定删除资产「'+targets[0].name+'」？'
    :'确定批量删除选中的 '+targets.length+' 项资产？\n'+names+additional;
  if(!confirm(headline+'\n将同时清理跨集引用和分镜/分镜板资产关联。\n本地图片、音频文件及已创建的画布节点不会删除。'))return;
  const scope=props.studio,startingPath=props.context.resource.path;
  const keys=['assets','assetMentions','panels','storyboards','storyboardBoards','assetExtractionDrafts'];
  const snapshot=Object.fromEntries(keys.map(key=>[key,JSON.parse(JSON.stringify(scope[key]??[]))]));
  const previousSelection=[...selectedIds.value];
  const detailId=detail.value?.id;
  removeBusy.value=true;removeNotice.value='';error.value='';
  try{
    if(scope!==props.studio||startingPath!==props.context.resource.path)
      throw new Error('项目已经切换，取消删除以避免修改错误的项目');
    const result=removeAssetsFromStudio(scope,[...idSet]);
    persist();
    await props.context.flushSave();
    if(scope!==props.studio||startingPath!==props.context.resource.path)
      throw new Error('保存期间项目发生切换，请核实当前资产库');
    selectedIds.value=selectedIds.value.filter(id=>!idSet.has(id));
    if(detailId&&idSet.has(detailId))detail.value=null;
    removeNotice.value='已删除 '+result.count+' 项资产及其分镜关联；本地图片和音频文件已保留。';
  }catch(e){
    // 文件保存失败时，恢复原索引和关联，避免界面显示删除成功但项目未落盘。
    for(const key of keys)scope[key]=snapshot[key];
    selectedIds.value=previousSelection;
    if(detailId)detail.value=scope.assets.find(asset=>asset.id===detailId)||null;
    let rollbackError='';
    if(scope===props.studio&&startingPath===props.context.resource.path){
      try{persist();await props.context.flushSave();}
      catch(recovery){rollbackError='；恢复保存失败：'+(recovery?.message||String(recovery));}
    }
    error.value='删除未完成：'+(e?.message||String(e))+rollbackError;
  }finally{removeBusy.value=false;}
}
</script>
<style scoped>
.asset-library{min-height:100%;font-size:13px}.asset-header,.asset-filter,.asset-buttons,.review-head,.candidate-title,.asset-detail header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.asset-header h2{margin:0;font-size:22px}.asset-header p,.muted{font-size:12px;color:var(--el-text-color-secondary,#95a1b4)}.asset-buttons{justify-content:flex-end}.asset-library button{cursor:pointer;font:inherit;background:var(--el-fill-color,#ffffff);color:inherit;border:1px solid var(--el-border-color,#424b58);border-radius:6px;padding:8px 12px}.asset-library button.primary{background:#306fe3;color:#fff;border-color:#306fe3}.asset-library button:disabled{opacity:.45;cursor:not-allowed}.asset-library button.danger{color:#e78780}.asset-library input,.asset-library textarea,.asset-library select{font:inherit;color:inherit;background:var(--el-fill-color,#ffffff);border:1px solid var(--el-border-color,#3c4654);border-radius:6px;padding:8px;width:100%;box-sizing:border-box}.asset-library label{display:flex;flex-direction:column;gap:6px;font-size:12px}.asset-library label input[type=file]{display:none}.asset-library input[type=checkbox]{width:16px;height:16px;margin:0;accent-color:var(--el-color-primary,#306fe3);flex:none;cursor:pointer}.asset-filter{margin:22px 0;justify-content:flex-start}.asset-filter label{display:flex;align-items:center;flex-direction:row}.asset-filter select{min-width:240px}.asset-filter>input{width:210px}.categories{display:flex;gap:5px}.categories button.active{background:#2568d1;border-color:#2568d1;color:#fff}.asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,1fr));gap:15px}.asset-card{position:relative;border:1px solid var(--el-border-color,#434b57);background:var(--el-fill-color-blank,#ffffff);border-radius:10px;overflow:hidden;cursor:pointer;transition:border-color .15s,box-shadow .15s}.asset-card-selected{border-color:var(--el-color-primary,#306fe3);box-shadow:0 0 0 2px color-mix(in srgb,var(--el-color-primary,#306fe3) 22%,transparent)}.asset-select{position:absolute;z-index:1;top:8px;left:8px;display:grid!important;place-items:center;width:30px;height:30px;background:var(--el-bg-color,#fff);border:1px solid var(--el-border-color,#ddd);border-radius:8px;cursor:pointer}.asset-select input{width:16px!important;height:16px!important}.asset-audio-icon{display:flex;flex-direction:column;align-items:center;gap:10px;font-size:56px;color:var(--el-color-primary,#306fe3)}.asset-audio-icon small{font-size:12px;color:var(--el-text-color-secondary,#8794a4)}.asset-thumb{aspect-ratio:4/5;display:grid;place-items:center;background:var(--el-fill-color,#edf3f8);color:#91a0b3}.asset-thumb img{width:100%;height:100%;object-fit:contain}.asset-caption{padding:12px;display:flex;align-items:start;justify-content:space-between;gap:10px}.asset-caption strong{font-size:14px}.asset-caption small{color:#93a1b3}.asset-card .muted{padding:0 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.asset-prompt-state{padding:0 12px 10px;color:var(--el-color-success,#329869);font-size:11px}.asset-error{padding:10px;background:#653131;color:#ffcece;border-radius:5px;display:flex;justify-content:space-between}.empty{padding:40px;color:#96a1af}.extract-review{border:1px solid #416d9c;border-radius:10px;padding:16px;margin-bottom:24px}.review-head{margin-bottom:14px}.review-head strong{font-size:16px}.review-head p{color:#99a7b6;font-size:12px}.candidate{border-top:1px solid var(--el-border-color,#414a59);padding:12px 0;display:grid;grid-template-columns:190px minmax(250px,1fr) minmax(210px,1fr);gap:12px;align-items:center}.candidate-title{justify-content:flex-start;flex-direction:column;align-items:start}.candidate-title span{color:#92a3b7;font-size:11px}.candidate textarea{min-height:75px}.candidate label{grid-column:3}.candidate .candidate-description{grid-column:2;min-width:0}.candidate .candidate-description small{color:var(--el-text-color-secondary,#95a1b4);font-size:11px}.candidate .muted{grid-column:2 / 3}.asset-overlay{position:fixed;inset:0;background:rgba(10,18,29,.58);z-index:2200;padding:28px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;backdrop-filter:blur(3px)}.asset-detail{width:min(1140px,100%);max-height:calc(100vh - 56px);overflow-y:auto;overscroll-behavior:contain;margin:0;padding:20px 24px;background:var(--el-bg-color,#fff);border:1px solid var(--el-border-color,#414a59);border-radius:14px;box-shadow:0 22px 80px #0007;box-sizing:border-box}.asset-detail header{position:sticky;top:-20px;z-index:2;background:var(--el-bg-color,#fff);border-bottom:1px solid var(--el-border-color,#3e4756);padding:8px 0 14px;margin-bottom:20px}.asset-detail header h3{font-size:22px;margin:0}.detail-layout{display:grid;grid-template-columns:minmax(320px,1fr) minmax(300px,410px);gap:24px}.large-preview{min-height:360px;max-height:540px;background:#edf3f8;display:grid;place-items:center;color:#95a2b0;border-radius:10px}.large-preview img{max-width:100%;max-height:540px;object-fit:contain}.image-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:12px;margin-top:15px}.image-version{border:1px solid #3d4859;padding:8px;border-radius:9px;min-height:130px}.image-version img{height:125px;width:100%;object-fit:contain}.image-version>div{display:flex;gap:4px;justify-content:space-between}.image-version button{padding:4px;font-size:11px}.asset-audios{margin-top:18px}.asset-audios>div{display:flex;align-items:center;gap:10px;margin:10px 0}.asset-audios audio{max-width:270px}.detail-controls{display:flex;flex-direction:column;gap:13px}.detail-controls label{width:100%}.detail-controls textarea{min-height:80px}.generation-box{border:1px solid #384655;border-radius:9px;padding:14px;display:grid;gap:12px}.generation-box strong{font-size:15px}.upload-btn{display:flex!important;align-items:center;justify-content:center;padding:12px;border:1px dashed #6886a9!important;cursor:pointer}.asset-audios span{font-size:11px;color:#a1acbc}
.asset-batch-bar{margin:0 0 22px;padding:14px;border:1px solid var(--el-border-color,#434b57);border-radius:10px;background:var(--el-fill-color-light,#f6f8fb);display:flex;flex-direction:column;gap:12px}
.batch-select,.batch-actions,.batch-options{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.batch-check{display:flex!important;flex-direction:row!important;align-items:center!important;gap:8px!important;cursor:pointer}
.batch-select strong{font-size:12px;color:var(--el-color-primary,#306fe3)}
.batch-options label{flex:1 1 180px;min-width:160px}
.batch-options select{min-width:0;width:100%}
.batch-actions button{min-width:142px}
.batch-info{margin:0}
.batch-status{margin:0;padding:9px 12px;border-radius:7px;background:var(--el-color-primary-light-9,#eaf2fe);color:var(--el-text-color-primary,#283548)}
.batch-errors{max-height:140px;overflow:auto;color:var(--el-color-danger,#d25a55);font-size:12px}
.batch-errors p{margin:5px 0}
.audio-detail-preview{min-height:160px;padding:22px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;border-radius:10px;background:var(--el-fill-color-light,#f4f7fb);color:var(--el-text-color-secondary,#768196);text-align:center}
.audio-detail-preview strong{font-size:26px;color:var(--el-color-primary,#306fe3)}
@media(max-width:1050px){.detail-layout{grid-template-columns:1fr}.candidate{grid-template-columns:1fr}.candidate label,.candidate .muted{grid-column:auto}}@media(max-width:650px){.asset-overlay{padding:8px}.asset-detail{max-height:calc(100vh - 16px);padding:12px;border-radius:10px}.asset-detail header{top:-12px}.batch-actions button{min-width:0;flex:1}.asset-filter{gap:8px}.asset-filter label,.asset-filter>input{width:100%}}
.asset-card-delete{display:block;margin:0 10px 10px auto;padding:4px 9px!important;font-size:11px!important;border-radius:6px!important;line-height:16px!important;background:var(--el-color-danger-light-9,#fff1f0)!important;border-color:var(--el-color-danger-light-7,#f9c5c0)!important;color:var(--el-color-danger,#bc4440)!important}
.asset-card-delete:hover:not(:disabled){background:var(--el-color-danger-light-8,#ffe3e1)!important}
.batch-actions .batch-delete{margin-right:auto;background:var(--el-color-danger-light-9,#fff1f0)!important;color:var(--el-color-danger,#bc4440)!important;border-color:var(--el-color-danger-light-7,#f9c5c0)!important}
/* Compact asset management: common actions remain visible; rarely changed model settings fold away. */
.asset-library{font-size:12px;line-height:1.45}
.asset-header,.asset-filter,.asset-buttons,.review-head,.candidate-title{gap:8px}
.asset-header h2{font-size:18px}
.asset-header p{font-size:11px;margin:3px 0}
.asset-library button{padding:5px 9px;min-height:30px;font-size:12px}
.asset-library input:not([type=checkbox]):not([type=file]),.asset-library select{padding:6px 8px;min-height:32px;font-size:12px}
.asset-library textarea{padding:7px 8px;font-size:12px;line-height:1.55}
.asset-library label{gap:4px;font-size:11px}
.asset-filter{margin:11px 0;gap:8px}
.asset-filter select{min-width:180px}
.asset-filter>input{width:180px;max-width:100%}
.categories{gap:4px;flex-wrap:wrap}
.categories button{padding:5px 9px}
.asset-batch-bar{display:grid;grid-template-columns:minmax(210px,1fr) auto;gap:8px 10px;padding:10px 12px;margin-bottom:13px;border-radius:8px}
.batch-select,.batch-actions,.batch-options{gap:7px}
.batch-select{align-self:center}
.batch-check{gap:6px!important}
.batch-actions{justify-content:flex-end}
.batch-actions button{min-width:0}
.batch-settings,.batch-info,.batch-status,.batch-errors{grid-column:1/-1}
.batch-settings{border-top:1px solid var(--el-border-color-light,#e1e6ef);padding-top:7px}
.batch-settings summary{cursor:pointer;list-style:revert;font-size:12px;font-weight:600;color:var(--el-color-primary,#306fe3);padding:3px 0}
.batch-settings summary span{font-size:11px;font-weight:400;color:var(--el-text-color-secondary,#8290a2)}
.batch-settings[open] summary{margin-bottom:8px}
.batch-options{align-items:end}
.batch-options label{flex:1 1 175px;min-width:155px}
.batch-info{font-size:10px;line-height:1.45}
.batch-status{padding:7px 9px}
.asset-grid{grid-template-columns:repeat(auto-fill,minmax(144px,1fr));gap:10px}
.asset-card{border-radius:8px}
.asset-thumb{aspect-ratio:1/1}
.asset-caption{padding:8px 9px 5px;gap:6px;flex-direction:column}
.asset-caption strong{font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.asset-caption small{font-size:10px;line-height:1.35}
.asset-card .muted{padding:0 9px;font-size:10px;margin:3px 0 7px}
.asset-prompt-state{padding:1px 9px 6px;font-size:10px}
.asset-card-delete{padding:3px 7px!important;min-height:26px;margin:4px 8px 8px auto;font-size:10px!important}
.asset-select{top:6px;left:6px;width:28px;height:28px;border-radius:6px}
.asset-audio-icon{font-size:40px;gap:5px}
.asset-audio-icon small{font-size:10px}
.asset-error{padding:7px 9px}
.empty{padding:28px}
.extract-review{padding:11px 12px;margin-bottom:15px}
.review-head{margin-bottom:8px}
.review-head strong{font-size:14px}
.review-head p{font-size:11px}
.candidate{grid-template-columns:145px minmax(205px,1fr) minmax(180px,.8fr);gap:8px;padding:9px 0}
.candidate textarea{min-height:58px}
.asset-overlay{padding:16px}
.asset-detail{width:min(960px,100%);max-height:calc(100vh - 32px);padding:13px 16px;border-radius:11px}
.asset-detail header{top:-13px;padding:7px 0 10px;margin-bottom:12px}
.asset-detail header h3{font-size:17px}
.detail-layout{grid-template-columns:minmax(275px,1fr) minmax(270px,360px);gap:15px}
.large-preview{min-height:248px;max-height:360px}
.large-preview img{max-height:360px}
.image-row{grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px;margin-top:9px}
.image-version{padding:6px;min-height:100px;border-radius:7px}
.image-version img{height:90px}
.image-version>div{gap:3px;flex-wrap:wrap}
.image-version button{padding:3px 5px;min-height:26px;font-size:10px}
.asset-audios{margin-top:12px}
.asset-audios audio{max-width:220px}
.detail-controls{gap:8px}
.detail-controls textarea{min-height:60px}
.generation-box{padding:10px;gap:8px;border-radius:7px}
.generation-box strong{font-size:13px}
.upload-btn{padding:8px}
.audio-detail-preview{min-height:130px;padding:15px}
.audio-detail-preview strong{font-size:20px}
@media(max-width:1100px){
  .asset-batch-bar{grid-template-columns:1fr}
  .batch-select,.batch-actions{justify-content:flex-start}
  .batch-settings,.batch-info,.batch-status,.batch-errors{grid-column:1}
}
@media(max-width:1050px){
  .detail-layout{grid-template-columns:1fr}
  .candidate{grid-template-columns:1fr}
  .candidate label,.candidate .candidate-description,.candidate .muted{grid-column:1}
}
@media(max-width:650px){
  .asset-overlay{padding:7px}
  .asset-detail{max-height:calc(100vh - 14px);padding:10px}
  .asset-detail header{top:-10px}
  .asset-grid{grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:7px}
  .batch-actions button{flex:0 1 auto}
  .batch-settings summary span{display:block;margin-left:0}
  .asset-filter select{min-width:145px}
}
/* Single-row asset actions; only show the optional model row when requested. */
.asset-batch-bar{display:block;width:100%;max-width:1080px;padding:8px 10px;margin:0 0 12px}
.batch-main-row{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap}
.batch-main-row .batch-select{display:flex;align-items:center;flex:0 0 auto;gap:7px;min-width:0}
.batch-main-row .batch-actions{display:flex;align-items:center;flex:1 1 auto;justify-content:flex-start;gap:6px;min-width:0}
.batch-actions .batch-delete{margin-right:0}
.batch-main-row button{white-space:nowrap;min-height:30px}
.batch-check{white-space:nowrap}
.batch-settings{display:block;max-width:850px;margin-top:8px;padding:9px 0 2px;border-top:1px solid var(--el-border-color-light,#e1e6ef)}
.batch-options{display:grid;grid-template-columns:minmax(240px,1.1fr) minmax(180px,.9fr) minmax(235px,1.1fr);gap:8px;align-items:center}
.asset-library .batch-options label{display:grid!important;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:6px!important;min-width:0;margin:0!important;font-size:11px;white-space:nowrap}
.batch-options label select{width:100%;min-width:0;max-width:100%;min-height:30px}
.batch-status,.batch-errors{margin:8px 0 0}
.batch-config-toggle{color:var(--el-color-primary,#306fe3)!important}
@media(max-width:950px){
 .batch-main-row{gap:7px}
 .batch-main-row .batch-actions{flex-wrap:wrap}
 .batch-options{grid-template-columns:repeat(2,minmax(0,1fr))}
 .batch-options label:last-child{grid-column:1/-1;max-width:420px}
}
@media(max-width:650px){
 .batch-options{grid-template-columns:1fr}
 .batch-options label:last-child{grid-column:auto;max-width:none}
 .batch-main-row .batch-select{flex-wrap:wrap}
}
/* Asset derivative versions: compact controls and separate galleries under the parent asset. */
.derivative-section{margin-top:12px;padding:11px;border:1px solid var(--el-border-color,#d8e0ea);border-radius:9px;background:var(--el-fill-color-light,#f6f8fb)}
.derivative-heading,.derivative-item-head,.derivative-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.derivative-heading{justify-content:space-between;margin-bottom:9px}
.derivative-heading strong{font-size:13px}
.derivative-heading small,.derivative-hint,.derivative-item-head span{font-size:10px;color:var(--el-text-color-secondary,#7e8b9f)}
.derivative-create{display:grid;grid-template-columns:116px minmax(130px,1fr);gap:6px}
.derivative-create input{grid-column:1/-1;min-width:0}
.derivative-create button{grid-column:1/-1;justify-self:start}
.derivative-models{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}
.derivative-models label{min-width:0;margin:0!important}
.derivative-models select{min-width:0}
.derivative-hint{margin:7px 0 0;line-height:1.5}
.derivative-item{padding:9px;margin-top:9px;border:1px solid var(--el-border-color-light,#dae2ec);border-radius:7px;background:var(--el-bg-color,#fff)}
.derivative-item-head{margin-bottom:6px}
.derivative-item-head span{flex:1;min-width:0}
.derivative-item textarea{width:100%;min-height:50px!important;resize:vertical;margin:3px 0;box-sizing:border-box}
.derivative-actions{gap:6px;margin-top:5px}
@media(max-width:660px){.derivative-models{grid-template-columns:1fr}}
.asset-prompt-action{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center}
.asset-prompt-action select{min-width:0}
.manual-applied{margin:0;padding:6px 8px;border-radius:6px;background:var(--el-color-success-light-9,#edf8f0);font-size:11px;color:var(--el-color-success,#258555)}
.manual-applied.missing{background:var(--el-color-warning-light-9,#fff7e7);color:var(--el-color-warning,#bd8624)}
/* Asset dialog redesign: wider, shorter viewport with independently scrolling columns. */
.asset-grid .asset-thumb{aspect-ratio:4 / 3!important}
.asset-overlay{padding:12px}
.asset-detail{display:flex;flex-direction:column;width:min(1480px,calc(100vw - 32px));max-width:none;height:min(780px,76vh);max-height:calc(100vh - 24px);padding:11px 16px 13px;overflow:hidden;margin:auto}
.asset-detail>header{flex:none;position:relative;top:auto;padding:4px 0 8px;margin-bottom:10px}
.asset-detail>header h3{font-size:17px}
.asset-detail>header p{font-size:10px;margin:3px 0 0}
.asset-detail>.asset-error{flex:none}
.detail-layout{flex:1;min-height:0;overflow:hidden;display:grid;grid-template-columns:minmax(480px,1.42fr) minmax(360px,1fr);gap:15px}
.media-area,.detail-controls{min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:2px 5px 8px 0;scrollbar-width:thin}
.media-area{display:grid;grid-template-columns:minmax(230px,1.15fr) minmax(195px,.85fr);gap:9px;align-content:start}
.media-area .large-preview{position:relative;grid-column:1;width:100%;aspect-ratio:4 / 3;min-height:0;max-height:none;overflow:hidden;border:1px solid var(--el-border-color-light,#d7e1ee);border-radius:8px;background:var(--el-fill-color-light,#eff3f7)}
.large-preview img{display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain}
.large-preview .preview-zoom-button{position:absolute;right:8px;top:8px;min-height:29px;background:rgba(23,37,54,.8);border:1px solid #ffffff55;color:white;border-radius:6px;padding:4px 9px;font-size:11px}
.large-preview .preview-zoom-button:hover{background:rgba(23,37,54,.97)}
.preview-indicator{position:absolute;left:8px;bottom:8px;border-radius:5px;padding:3px 7px;font-size:10px;color:white;background:rgba(23,37,54,.77)}
.media-area .image-row{grid-column:2;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:7px;max-height:none;height:100%;overflow-y:auto;margin:0;padding:2px 2px 2px 0;min-width:0;scrollbar-width:thin}
.media-area .image-version{min-height:0;padding:4px;border:1px solid var(--el-border-color,#d4dce8);border-radius:7px}
.media-area .image-version.active{border-color:var(--el-color-primary,#3275da);box-shadow:inset 0 0 0 1px var(--el-color-primary,#3275da)}
.media-area .image-version-preview{display:block;position:relative;min-height:0!important;padding:0!important;width:100%;aspect-ratio:4 / 3;overflow:hidden;background:var(--el-fill-color-light,#eff3f7);border:0!important}
.media-area .image-version-preview img{display:block;width:100%;height:100%;object-fit:contain}
.media-area .image-default-mark{position:absolute;bottom:3px;left:3px;border-radius:4px;padding:2px 4px;font-size:9px;background:rgba(20,30,45,.7);color:white}
.media-area .image-version-actions{display:flex;justify-content:center;align-items:center;gap:3px;flex-wrap:wrap;margin-top:3px}
.media-area .image-version-actions button{padding:2px 5px!important;min-height:22px!important;font-size:10px!important}
.media-area>.shared-image-settings,.media-area>.derivative-section,.media-area>.asset-audios,.media-area>.audio-detail-preview{grid-column:1/-1}
.media-area .shared-image-settings{display:grid;grid-template-columns:auto minmax(105px,.65fr) minmax(145px,1fr) minmax(90px,.55fr) auto;align-items:end;gap:7px;padding:9px;margin:0}
.media-area .shared-image-settings strong{font-size:12px;align-self:center;white-space:nowrap}
.media-area .shared-image-settings strong small{display:block;font-weight:normal;font-size:10px;color:var(--el-text-color-secondary,#8793a4)}
.media-area .shared-image-settings label{min-width:0;margin:0;gap:4px;font-size:10px}
.media-area .shared-image-settings select{min-width:0;width:100%;padding:5px;font-size:11px}
.media-area .shared-image-settings button{white-space:nowrap}
.media-area .derivative-section{margin:0;padding:9px}
.media-area .derivative-heading{margin-bottom:6px}
.media-area .derivative-create{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:6px}
.media-area .derivative-create .derivative-reference{white-space:nowrap;font-size:10px;color:var(--el-text-color-secondary,#6c7e92)}
.media-area .derivative-create input{grid-column:auto;min-width:0}
.media-area .derivative-create button{grid-column:auto;justify-self:end;white-space:nowrap}
.media-area .derivative-hint{margin-top:5px}
.media-area .derivative-item{margin-top:7px;padding:7px}
.media-area .derivative-item textarea{min-height:44px!important;resize:vertical}
.media-area .derivative-item select{margin:4px 0}
.media-area .derivative-image-list button{padding:3px;min-height:0}
.detail-controls{display:flex;flex-direction:column;gap:7px}
.detail-controls label{margin:0;gap:3px;font-size:11px}
.detail-controls input,.detail-controls select{min-height:30px;padding:5px 8px}
.detail-controls textarea{min-height:47px;padding:6px 8px}
.detail-controls>label:has(textarea) textarea{min-height:56px}
.detail-controls .asset-prompt-action{gap:6px}
.detail-controls .asset-prompt-action button{white-space:nowrap}
.detail-controls .muted{margin:4px 0;font-size:10px}
.detail-controls>.upload-btn{padding:6px}
.detail-controls>.danger{align-self:flex-start}
.asset-zoom-overlay{position:fixed;inset:0;z-index:2600;display:flex;align-items:center;justify-content:center;padding:54px 30px 30px;background:rgba(5,12,23,.93);box-sizing:border-box}
.asset-zoom-overlay img{max-width:96%;max-height:96%;width:auto;height:auto;object-fit:contain;box-shadow:0 10px 55px #0009}
.asset-zoom-close{position:absolute;top:16px;right:22px;background:#253449!important;color:#fff!important;border-color:#627289!important}
@media(max-width:1050px){
 .detail-layout{grid-template-columns:minmax(0,1fr)}
 .asset-detail{height:min(830px,88vh)}
 .detail-layout{overflow:auto}
 .media-area,.detail-controls{overflow:visible}
 .media-area .image-row{overflow:auto;max-height:295px}
}
@media(max-width:730px){
 .asset-overlay{padding:6px}
 .asset-detail{width:100%;max-height:calc(100vh - 12px);height:calc(100vh - 12px);padding:8px}
 .media-area{grid-template-columns:1fr}
 .media-area .large-preview,.media-area .image-row{grid-column:1}
 .media-area .image-row{display:flex;height:auto;max-height:none;overflow-x:auto}
 .media-area .image-version{flex:0 0 110px}
 .media-area .shared-image-settings{grid-template-columns:repeat(2,minmax(0,1fr))}
 .media-area .shared-image-settings strong{grid-column:1/-1}
 .media-area .derivative-create{grid-template-columns:1fr}
 .media-area .derivative-create button{justify-self:start}
}
/* Detail v2: full-height modal and a deterministic first media row.
   The old auto-height grid allowed the 4:3 preview to overlap settings below. */
.asset-overlay{padding:8px}
.asset-detail{height:min(940px,94vh);max-height:calc(100vh - 16px);width:min(1540px,calc(100vw - 16px));padding:11px 16px 12px}
.detail-layout{grid-template-columns:minmax(0,1.38fr) minmax(340px,1fr);gap:16px}
.media-area{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);grid-template-rows:clamp(275px,42vh,380px) auto auto;gap:10px;align-content:start}
.media-area .large-preview{grid-column:1;grid-row:1;width:100%;height:auto;max-height:100%;aspect-ratio:4 / 3;align-self:start;min-width:0;min-height:0;overflow:hidden}
.media-area .large-preview img{width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain}
.media-area .image-row{grid-column:2;grid-row:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(77px,1fr));grid-auto-rows:max-content;align-content:start;gap:6px;height:100%;max-height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;margin:0;padding:2px 4px 3px 2px}
.media-area .image-version{position:relative;display:block;min-width:0;min-height:0;padding:3px;border-radius:6px;overflow:hidden;background:var(--el-bg-color,#fff)}
.media-area .image-version-preview{width:100%;height:auto;aspect-ratio:4/3;min-height:0!important;max-height:none!important;padding:0!important;border:0!important;overflow:hidden;position:relative}
.media-area .image-version-preview img{display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain}
.media-area .image-version-actions{position:absolute;z-index:2;bottom:3px;left:3px;right:3px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px;opacity:0;pointer-events:none;transition:opacity .12s;background:rgba(247,249,253,.95);border-radius:4px;padding:2px}
.media-area .image-version:hover .image-version-actions,.media-area .image-version:focus-within .image-version-actions{opacity:1;pointer-events:auto}
.media-area .image-version-actions button{font-size:9px!important;line-height:1.1;min-height:22px!important;padding:2px 4px!important;flex:0 0 auto}
.media-area .image-version-actions button:disabled{display:none}
.media-area .image-default-mark{font-size:9px}
.media-area>.shared-image-settings,.media-area>.derivative-section,.media-area>.asset-audios,.media-area>.audio-detail-preview{grid-column:1/-1;grid-row:auto}
@media(hover:none){
  .media-area .image-version-actions{opacity:1;pointer-events:auto}
}
@media(max-width:1050px){
 .asset-detail{height:min(940px,94vh);max-height:calc(100vh - 16px)}
 .detail-layout{grid-template-columns:minmax(0,1fr);overflow:auto}
 .media-area{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);grid-template-rows:clamp(250px,40vh,355px) auto auto}
 .media-area .image-row{height:100%;max-height:100%;overflow-y:auto;overflow-x:hidden}
}
@media(max-width:730px){
 .asset-detail{width:100%;height:calc(100vh - 12px);max-height:calc(100vh - 12px)}
 .media-area{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto auto}
 .media-area .large-preview{grid-column:1;grid-row:auto;max-height:350px;width:100%;height:auto;aspect-ratio:4/3}
 .media-area .image-row{grid-column:1;grid-row:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(75px,1fr));max-height:180px;height:auto;overflow-y:auto;overflow-x:hidden}
}
</style>
