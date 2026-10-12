<template>
  <div class="shot-workbench">
    <header class="shot-top">
      <div><h2>专业分镜制作</h2><p>分集剧本 → 视频脚本 → 专业分镜表 → 分镜面板</p></div>
      <div class="shot-step-tabs" role="tablist" aria-label="分镜制作阶段">
        <button type="button" :class="{active:stage==='script'}" @click="stage='script'">① 视频脚本</button>
        <button type="button" :class="{active:stage==='table'}" @click="stage='table'">② 专业分镜表</button>
      </div>
    </header>
    <div class="shot-config">
      <label>当前剧本
        <select :value="selectedScript" :disabled="busy" @change="emit('update:selectedScript',$event.target.value)">
          <option value="">请选择一集剧本</option>
          <option v-for="s in scripts" :key="s.id" :value="s.id">第{{s.episode}}集 · {{s.title||'未命名'}}</option>
        </select>
      </label>
      <label>文本模型
        <select v-model="modelChoice" :disabled="busy">
          <option value="">使用项目默认文本模型</option>
          <option v-for="m in models" :key="m.value" :value="m.value">{{m.providerLabel}} · {{m.label}}</option>
        </select>
      </label>
      <button type="button" :disabled="busy" @click="refreshModels">{{modelsLoading?'读取中…':'刷新模型'}}</button>
      <span v-if="busy" class="shot-progress">{{progress}}</span><button v-if="localBusy" type="button" @click="stopGeneration">停止生成</button>
    </div>
    <p v-if="notice" class="shot-notice" role="status">{{notice}} <button type="button" @click="notice=''">×</button></p>

    <div v-if="stage==='script'" class="video-script-stage">
      <aside class="shot-card shot-episode-sidebar">
        <div class="shot-pane-head"><strong>已入库剧本 · {{scripts.length}} 集</strong><small>勾选多集批量生成</small></div>
        <div class="shot-batch-actions">
          <button type="button" :disabled="busy" @click="checkedIds=scripts.map(s=>s.id)">全选</button>
          <button type="button" :disabled="busy" @click="checkedIds=[]">清空</button>
          <button type="button" class="shot-action-primary" :disabled="busy||!checkedIds.length" @click="batchGenerate">批量生成（{{checkedIds.length}}）</button>
        </div>
        <div class="shot-episode-list">
          <div v-for="s in scripts" :key="s.id" class="shot-episode-item" :class="{active:selectedScript===s.id}">
            <label class="shot-check"><input type="checkbox" :checked="checkedIds.includes(s.id)" :disabled="busy" @change="toggleChecked(s.id,$event.target.checked)" aria-label="加入批量生成"/></label>
            <button type="button" :disabled="busy" class="shot-episode-link" @click="emit('update:selectedScript',s.id)">
              <strong>第{{s.episode}}集 · {{s.title||'未命名'}}</strong>
              <small>{{videoScriptFor(s.id)?.text?.trim()?'✓ 视频脚本已保存':'待制作'}} · {{s.text?.length||0}} 字</small>
            </button>
          </div>
          <div v-if="!scripts.length" class="shot-empty">请先在剧本工作台保存分集剧本</div>
        </div>
      </aside>
      <div class="shot-script-editor">
        <section class="shot-card shot-script-source">
          <div class="shot-pane-head"><strong>分集剧本原文</strong><small>{{currentScript?.text?.length||0}} 字 · 只读</small></div>
          <pre>{{currentScript?.text||'请选择左侧一集剧本'}}</pre>
        </section>
        <section class="shot-card shot-video-editor">
          <div class="shot-pane-head"><strong>视频脚本 <small>可直接编辑</small></strong>
            <div class="shot-pane-buttons">
              <button type="button" :disabled="busy||!currentScript" @click="generateOne">{{busy?'生成中…':(currentVideo?.text?.trim()?'重新生成':'AI 生成视频脚本')}}</button>
              <button type="button" :disabled="busy||!currentScript" @click="saveVideoScript">保存视频脚本</button>
              <button class="shot-action-next" :disabled="!currentVideo?.text?.trim()||busy" @click="stage='table'">进入分镜表 →</button>
            </div>
          </div>
          <textarea :value="currentVideo?.text||''" :disabled="busy||!currentScript" @input="updateVideoText($event.target.value)"
            @change="saveVideoScript" placeholder="先选剧本并生成视频脚本；生成后可直接修改场次、动作、台词、镜头设计与转场，再保存。"></textarea>
          <div class="shot-editor-footer">视频脚本与原剧本独立保存；重新生成会覆盖当前视频脚本，建议先保存修改。</div>
        </section>
      </div>
    </div>

    <div v-else class="shot-table-stage">
      <section class="shot-card shot-table-video">
        <div class="shot-pane-head">
          <strong>当前视频脚本 · 第{{currentScript?.episode||'—'}}集</strong>
          <div class="shot-pane-buttons">
            <span>{{currentVideo?.text?.length||0}} 字</span>
            <button type="button" :disabled="busy||!currentVideo?.text?.trim()" @click="saveVideoScript">保存视频脚本</button>
            <button type="button" @click="stage='script'">返回视频脚本</button>
          </div>
        </div>
        <textarea :value="currentVideo?.text||''" :disabled="busy||!currentScript" @input="updateVideoText($event.target.value)"
          @change="saveVideoScript" placeholder="尚未制作视频脚本，请先进入第一页制作。"></textarea>
      </section>
      <section class="shot-card shot-table-panel">
        <div class="shot-pane-head">
          <strong>专业分镜表 <small>{{currentRows.length}} 镜头 · 已选 {{selectedRows.length}} 镜头 · {{totalSeconds}} 秒</small></strong>
          <div class="shot-pane-buttons">
            <button type="button" :disabled="busy||!currentVideo?.text?.trim()" @click="generateTable">
              {{busy?'生成中…':(currentRows.length?'重新生成分镜表':'从视频脚本生成分镜表')}}
            </button>
            <button type="button" :disabled="busy||!currentScript" @click="addShot">＋ 镜头</button>
            <button type="button" :disabled="busy||!currentRows.length" @click="emit('save')">保存分镜表</button>
            <button class="shot-action-primary" :disabled="busy||!selectedRows.length" @click="emit('makeBoards')">制作分镜板（{{totalSeconds}}秒）</button>
          </div>
        </div>
        <div v-if="currentRows.length" class="shot-table-container">
          <table class="shot-professional-table">
            <colgroup><col style="width:3%"/><col style="width:7%"/><col style="width:6%"/><col style="width:15%"/><col style="width:23%"/><col style="width:23%"/><col style="width:14%"/><col style="width:9%"/></colgroup>
            <thead><tr><th><input type="checkbox" :checked="currentRows.every(r=>r.selected)" @change="setAllChecked($event.target.checked)" aria-label="全选镜头"/></th><th>镜号</th><th>时长</th><th>景别 / 机位 / 运镜</th><th>动作 / 台词</th><th>构图 / 光线 / 声音 / 转场</th><th>视频 / 参考设置</th><th>资产 / 操作</th></tr></thead>
            <tbody>
              <tr v-for="(row,i) in currentRows" :key="row.id" :class="{chosen:row.selected}">
                <td><input type="checkbox" v-model="row.selected" @change="emit('save')"/></td>
                <td><textarea v-model="row.shotNo" class="shot-field" rows="2" @change="emit('save')" aria-label="镜号"/><small>{{row.status||'待制作'}}</small></td>
                <td><input type="number" min="1" max="12" class="shot-seconds" v-model.number="row.duration" @change="emit('save')"/><small>秒</small></td>
                <td><textarea v-model="row.shotSize" rows="2" class="shot-field" @change="emit('save')" placeholder="景别"/><textarea v-model="row.camera" rows="2" class="shot-field" @change="emit('save')" placeholder="机位"/><textarea v-model="row.movement" rows="2" class="shot-field" @change="emit('save')" placeholder="运镜"/></td>
                <td><textarea v-model="row.action" rows="4" class="shot-field shot-long" @change="emit('save')" placeholder="动作与表演"/><textarea v-model="row.dialogue" rows="3" class="shot-field shot-long" @change="emit('save')" placeholder="关键台词"/></td>
                <td><textarea v-model="row.composition" rows="2" class="shot-field" @change="emit('save')" placeholder="构图"/><textarea v-model="row.lighting" rows="2" class="shot-field" @change="emit('save')" placeholder="光线"/><textarea v-model="row.sound" rows="2" class="shot-field" @change="emit('save')" placeholder="声音"/><textarea v-model="row.transition" rows="2" class="shot-field" @change="emit('save')" placeholder="转场"/></td>
                <td><select v-model="row.videoMode" @change="emit('save')"><option value="minimaxH3">minimaxH3</option><option value="seedance2.0">Seedance 2.0</option></select><select v-model="row.referenceMode" @change="emit('save')"><option>首尾帧模式</option><option>全能参考模式</option></select><select v-model="row.imageMode" @change="emit('save')"><option>不生成</option><option>模型生成</option></select><textarea v-if="row.imageMode==='模型生成'" v-model="row.imageModel" class="shot-field" rows="2" @change="emit('save')" placeholder="默认图片模型"/><button v-if="row.imageMode==='模型生成'" :disabled="busy" @click="emit('shotImage',row)">生成分镜图</button></td>
                <td><div class="shot-asset-tags"><span v-for="id in row.assetIds||[]" :key="id">{{assetName(id)}}</span><small v-if="!row.assetIds?.length">暂无匹配资产</small></div>
                  <details class="shot-assets-editor"><summary>编辑参考资产</summary>
                    <div class="shot-assets-choices"><label v-for="asset in studio.assets||[]" :key="asset.id">
                      <input type="checkbox" :checked="(row.assetIds||[]).includes(asset.id)" :disabled="busy"
                        @change="toggleRowAsset(row,asset.id,$event.target.checked)" />{{asset.kind}} · {{asset.name}}
                    </label></div>
                  </details>
                  <button class="shot-danger" type="button" :disabled="busy" @click="removeShot(row)">删除镜头</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="shot-empty">请先在第一页完成并保存视频脚本，再点击“从视频脚本生成分镜表”。</div>
      </section>
    </div>
  </div>
</template>

<script setup>
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue';
import {parseModelValue} from './generation.mjs';
import {loadTextModels} from './eventAnalysis.mjs';
import {generateStoryboard,uid} from './studio.mjs';
import {createVideoScriptRecord,generateVideoScript,replaceEpisodeStoryboard} from './videoScript.mjs';

const props=defineProps({studio:{type:Object,required:true},rows:{type:Array,required:true},
  selectedScript:{type:String,default:''},modelValue:{type:String,default:''},busy:{type:Boolean,default:false}});
const emit=defineEmits(['update:selectedScript','update:modelValue','rowsChanged','save','makeBoards','shotImage']);
const stage=ref('script'),models=ref([]),modelsLoading=ref(false),notice=ref(''),
  localBusy=ref(false),checkedIds=ref([]),progress=ref('');
let controller=null;
const busy=computed(()=>props.busy||localBusy.value);
const modelChoice=computed({get:()=>props.modelValue||'',set:value=>emit('update:modelValue',value)});
const scripts=computed(()=>props.studio.scripts||[]);
const currentScript=computed(()=>scripts.value.find(s=>s.id===props.selectedScript)||null);
const currentVideo=computed(()=>videoScriptFor(props.selectedScript));
const currentRows=computed(()=>props.rows.filter(row=>row.scriptId===props.selectedScript));
const selectedRows=computed(()=>currentRows.value.filter(row=>row.selected));
const totalSeconds=computed(()=>selectedRows.value.reduce((n,row)=>n+Math.max(0,Number(row.duration)||0),0));
function videoScriptFor(scriptId){return (props.studio.videoScripts||[]).find(r=>r.scriptId===scriptId);}
function assetName(id){return props.studio.assets?.find(asset=>asset.id===id)?.name||'未知';}
function getOrCreateVideo(){
  if(!currentScript.value)throw new Error('请先选择剧本');
  props.studio.videoScripts ||= [];
  let record=videoScriptFor(currentScript.value.id);
  if(!record){record=createVideoScriptRecord(currentScript.value);props.studio.videoScripts.push(record);}
  return record;
}
function updateVideoText(text){const record=getOrCreateVideo();record.text=text;record.updatedAt=new Date().toISOString();}
function saveVideoScript(){if(!currentScript.value)return;getOrCreateVideo();emit('save');notice.value='视频脚本已保存，可继续生成分镜表';}
function toggleChecked(id,on){checkedIds.value=on?[...new Set([...checkedIds.value,id])]:checkedIds.value.filter(x=>x!==id);}
function stopGeneration(){controller?.abort();notice.value='已发送停止请求，已经保存的视频脚本和分镜表保持不变';}
watch(()=>props.studio.scripts?.map(s=>s.id).join('|'),()=>{checkedIds.value=checkedIds.value.filter(id=>scripts.value.some(s=>s.id===id));},{immediate:true});
async function refreshModels(){
  modelsLoading.value=true;
  try{models.value=await loadTextModels();}catch(e){notice.value='获取模型失败：'+e.message;}
  finally{modelsLoading.value=false;}
}
onMounted(()=>void refreshModels());
onBeforeUnmount(()=>controller?.abort());
function chosenModel(){
  const val=modelChoice.value||props.studio.project?.generation?.text?.model;
  const model=parseModelValue(val);
  if(!model)throw new Error('请在项目设置选择文本模型，或在顶部选择一个文本模型');
  return model;
}
async function runVideoBatch(targets){
  if(busy.value||!targets.length)return;
  let model;try{model=chosenModel();}catch(e){notice.value=e.message;return;}
  localBusy.value=true;controller=new AbortController();notice.value='';
  const scoped=props.studio,signal=controller.signal;
  let completed=0;
  try{
    for(const script of targets){
      if(signal.aborted||props.studio!==scoped)throw new Error('项目已切换或任务已取消');
      if(!script.text?.trim()){notice.value+='第'+script.episode+'集剧本为空；';continue;}
      progress.value='生成第'+script.episode+'集（'+(completed+1)+'/'+targets.length+'）';
      const text=await generateVideoScript({script,assets:scoped.assets||[],project:scoped.project||{},model,signal});
      if(signal.aborted||props.studio!==scoped)throw new Error('项目已切换或任务已取消');
      scoped.videoScripts||=[];
      const item=scoped.videoScripts.find(v=>v.scriptId===script.id)||createVideoScriptRecord(script);
      if(!scoped.videoScripts.some(v=>v.scriptId===script.id))scoped.videoScripts.push(item);
      item.text=text;item.updatedAt=new Date().toISOString();item.modelValue=JSON.stringify([model.providerId,model.modelId]);
      completed++;emit('save');
    }
    notice.value+='已保存 '+completed+' 集视频脚本；可逐集编辑后制作专业分镜表。';
  }catch(e){notice.value+='生成中止，已保存 '+completed+' 集。'+e.message;}
  finally{localBusy.value=false;controller=null;progress.value='';}
}
function generateOne(){
  if(!currentScript.value)return;
  if(currentVideo.value?.text?.trim()&&!confirm('重新生成会覆盖当前视频脚本，确定继续吗？'))return;
  void runVideoBatch([currentScript.value]);
}
function batchGenerate(){
  const targets=scripts.value.filter(s=>checkedIds.value.includes(s.id));
  const already=targets.filter(s=>videoScriptFor(s.id)?.text?.trim()).length;
  if(already&&!confirm('所选集数中有 '+already+' 集已有视频脚本，继续会覆盖，确定吗？'))return;
  void runVideoBatch(targets);
}
async function generateTable(){
  if(busy.value||!currentScript.value)return;
  const script=currentScript.value,videoText=currentVideo.value?.text?.trim();
  if(!videoText){notice.value='请先在第一页生成或填写视频脚本';return;}
  if(currentRows.value.length&&!confirm('重新生成将覆盖当前集分镜表的镜头编辑，其他集不受影响。继续吗？'))return;
  let model;try{model=chosenModel();}catch(e){notice.value=e.message;return;}
  localBusy.value=true;controller=new AbortController();notice.value='正在根据已保存的视频脚本生成专业分镜表…';
  try{
    emit('save');
    const generated=await generateStoryboard({script,videoScript:videoText,assets:props.studio.assets||[],
      project:props.studio.project||{},model,signal:controller.signal});
    if(controller.signal.aborted||!scripts.value.some(s=>s.id===script.id))throw new Error('项目已切换，放弃回写');
    generated.forEach(r=>r.selected=true);
    emit('rowsChanged',replaceEpisodeStoryboard(props.rows,generated,script.id));
    notice.value='第'+script.episode+'集已生成 '+generated.length+' 个专业镜头，可以逐字段编辑保存并制作分镜板。';
  }catch(e){notice.value='生成分镜表失败：'+e.message;}
  finally{localBusy.value=false;controller=null;}
}
function setAllChecked(flag){currentRows.value.forEach(row=>row.selected=flag);emit('save');}
function toggleRowAsset(row,assetId,enabled){
  const ids=new Set(row.assetIds||[]);
  if(enabled)ids.add(assetId);else ids.delete(assetId);
  row.assetIds=[...ids];emit('save');
}
function addShot(){
  if(!currentScript.value)return;
  const n=currentRows.value.length+1,script=currentScript.value;
  const row={id:uid('storyboard'),scriptId:script.id,episode:script.episode,index:n,
    shotNo:script.episode+'-'+String(n).padStart(2,'0'),duration:3,shotSize:'中景',
    camera:'固定镜头',movement:'静止',composition:'自然构图',action:'',dialogue:'',
    lighting:'按场景自然光',sound:'现场环境声',transition:'硬切',assetIds:[],selected:true,
    imageMode:'不生成',imageModel:'',videoMode:'minimaxH3',referenceMode:'全能参考模式',status:'待制作'};
  emit('rowsChanged',[...props.rows,row]);
}
function removeShot(row){
  if(!confirm('删除镜头 '+row.shotNo+'？已制作的下游分镜板不会同步删除，请确认引用。'))return;
  emit('rowsChanged',props.rows.filter(r=>r.id!==row.id));
}
</script>
<style scoped>
.shot-workbench{width:100%;max-width:none;min-width:0;height:100%;min-height:600px;display:flex;flex-direction:column;gap:10px;font-size:12px;line-height:1.45;color:var(--el-text-color-primary,#25334a)}
.shot-workbench *{box-sizing:border-box}
.shot-workbench button{min-height:30px!important;padding:5px 9px!important;font-size:12px!important;font-weight:400;line-height:1.4;white-space:normal;border:1px solid var(--el-border-color,#d8e0ea)!important;border-radius:6px!important;background:var(--el-fill-color,#fff)!important;color:var(--el-text-color-primary,#30445b)!important;box-shadow:none!important;transition:background-color .15s,border-color .15s}
.shot-workbench button.shot-action-primary{background:#306fe3!important;border-color:#306fe3!important;color:#fff!important}
.shot-workbench button.shot-action-next{background:var(--el-color-primary-light-9,#eff6ff)!important;border-color:var(--el-color-primary-light-5,#b4cff2)!important;color:#2c66b0!important;font-weight:500}
.shot-workbench input,.shot-workbench select,.shot-workbench textarea{min-width:0;width:100%;max-width:100%;border:1px solid var(--el-border-color,#d8e0ea);border-radius:6px;background:var(--el-fill-color,#fff);color:inherit;outline:0;font-size:12px;line-height:1.55;font-family:inherit}
.shot-workbench textarea{padding:7px 8px;line-height:1.6;resize:vertical;overflow-wrap:anywhere;white-space:pre-wrap}
.shot-workbench select{padding:6px 8px;min-height:32px}
.shot-workbench input{padding:6px 8px;min-height:32px}
.shot-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;flex:none;min-height:42px}
.shot-top h2{font-size:18px;line-height:1.4;margin:0}
.shot-top p{font-size:11px;margin:2px 0 0;color:var(--el-text-color-secondary,#71829b)}
.shot-step-tabs{display:flex;align-items:center;gap:5px;padding:0;border:0;border-radius:0;background:transparent}
.shot-workbench .shot-step-tabs button{padding:5px 11px!important;min-height:30px!important;border:1px solid var(--el-border-color,#d8e0ea)!important;background:var(--el-fill-color,#fff)!important;color:var(--el-text-color-primary,#30445b)!important;border-radius:6px!important;white-space:nowrap}
.shot-workbench .shot-step-tabs button.active{background:var(--el-color-primary-light-9,#eaf3ff)!important;color:#2868bd!important;border-color:var(--el-color-primary-light-5,#9fc5ed)!important;font-weight:600;box-shadow:none!important}
.shot-config{display:flex;align-items:end;flex-wrap:wrap;gap:8px;padding:1px 0 3px;border:0;border-radius:0;background:transparent;flex:none}
.shot-config label{display:flex;flex-direction:column;gap:4px;min-width:210px;max-width:460px;flex:1;margin:0!important;font-size:11px}
.shot-config label select{height:32px}
.shot-progress{margin-left:auto;color:var(--el-color-primary,#2472cd);font-size:11px}
.shot-notice{padding:8px 12px;margin:0;border-radius:7px;background:#eaf3ff;color:#20466e;flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px}
.shot-card{min-width:0;min-height:0;background:var(--el-bg-color,#fff);border:1px solid var(--el-border-color,#d9e3ee);border-radius:8px;padding:11px 12px;overflow:hidden}
.shot-pane-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px}
.shot-pane-head strong{font-size:13px;font-weight:600}
.shot-pane-head strong small,.shot-pane-head>small,.shot-pane-buttons span{font-size:10px;color:var(--el-text-color-secondary,#8191a6);font-weight:normal}
.shot-pane-buttons{display:flex;align-items:center;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.shot-pane-buttons button{white-space:nowrap}
.video-script-stage{min-height:0;min-width:0;display:grid;grid-template-columns:minmax(215px,260px) minmax(0,1fr);gap:10px;flex:1}
.shot-episode-sidebar{display:flex;flex-direction:column}
.shot-batch-actions{display:flex;gap:6px;flex:none;margin-bottom:8px;flex-wrap:wrap}
.shot-episode-list{flex:1;min-height:0;overflow:auto;scrollbar-width:thin}
.shot-episode-item{display:flex;align-items:center;gap:6px;padding:4px 5px;border:1px solid transparent;border-radius:7px;margin-bottom:3px}
.shot-episode-item.active{background:var(--el-color-primary-light-9,#eaf3ff);border-color:var(--el-color-primary-light-5,#b9d1f0);outline:none}
.shot-check{width:20px;flex:none;display:flex;align-items:center;justify-content:center;margin:0!important}
.shot-check input{width:14px!important;height:14px!important;padding:0;min-height:0}
.shot-workbench .shot-episode-link{display:flex!important;flex-direction:column;align-items:start!important;gap:3px;width:100%;min-width:0;padding:5px 6px!important;white-space:normal!important;text-align:left;background:transparent!important;border:0!important;box-shadow:none!important}
.shot-episode-link strong{font-size:12px;text-align:left;word-break:break-word}
.shot-episode-link small{font-size:10px;color:var(--el-text-color-secondary,#788aa1);white-space:normal}
.shot-script-editor{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);min-height:0;min-width:0;gap:10px}
.shot-script-source,.shot-video-editor{display:flex;flex-direction:column;min-height:0}
.shot-script-source pre{flex:1;min-height:0;margin:0;padding:10px;overflow:auto;background:var(--el-fill-color-light,#f7f9fc);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;font:12px/1.65 'Microsoft YaHei',sans-serif}
.shot-video-editor textarea{flex:1;min-height:140px;resize:none;font-size:12px}
.shot-editor-footer{color:var(--el-text-color-secondary,#8492a5);font-size:10px;padding-top:6px}
.shot-table-stage{display:grid;grid-template-rows:minmax(190px,.37fr) minmax(270px,.63fr);min-height:0;min-width:0;gap:10px;flex:1}
.shot-table-video{display:flex;flex-direction:column}
.shot-table-video textarea{flex:1;min-height:0;resize:none}
.shot-table-panel{display:flex;flex-direction:column;padding:10px 10px;overflow:hidden}
.shot-table-panel .shot-pane-head{padding:0 5px}
.shot-table-container{flex:1;min-height:0;width:100%;min-width:0;overflow:auto;scrollbar-width:thin}
.shot-professional-table{border-collapse:collapse;table-layout:fixed;width:100%;min-width:0;font-size:11px}
.shot-professional-table th{position:sticky;top:0;z-index:1;background:var(--el-fill-color-light,#e8eef5);color:var(--el-text-color-primary,#31455e);padding:7px 4px;line-height:1.45;white-space:normal;text-align:left;border-bottom:1px solid var(--el-border-color,#d7e2ea);overflow-wrap:anywhere}
.shot-professional-table td{min-width:0;vertical-align:top;border-bottom:1px solid var(--el-border-color,#dce5ef);padding:5px 3px;line-height:1.45;overflow-wrap:anywhere;white-space:normal}
.shot-professional-table tr.chosen{background:var(--el-color-primary-light-9,#f1f7ff)}
.shot-professional-table td:first-child,.shot-professional-table th:first-child{text-align:center}
.shot-professional-table td input[type=checkbox],.shot-professional-table th input[type=checkbox]{width:14px!important;height:14px!important;min-height:0;margin:0;padding:0}
.shot-professional-table td textarea.shot-field,.shot-professional-table td select,.shot-professional-table td input[type=number]{width:100%;min-width:0;max-width:100%;box-sizing:border-box;margin:0 0 3px;padding:5px 5px;border-radius:5px;font-size:11px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}
.shot-professional-table td textarea.shot-field{min-height:34px;resize:vertical}
.shot-professional-table td textarea.shot-long{min-height:65px}
.shot-professional-table td select{white-space:normal;text-overflow:ellipsis}
.shot-professional-table td input[type=number]{padding:5px 2px!important}
.shot-professional-table td small{display:block;font-size:10px;color:var(--el-text-color-secondary,#8b98aa);white-space:normal;overflow-wrap:anywhere}
.shot-asset-tags{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px}
.shot-asset-tags span{max-width:100%;word-break:break-word;padding:2px 4px;border-radius:5px;background:#eaf3ff;color:#29588a;font-size:10px}
.shot-assets-editor summary{cursor:pointer;font-size:9px;color:var(--el-color-primary,#347cdc);white-space:normal}
.shot-assets-choices{max-height:145px;overflow:auto;padding:5px 3px;display:grid;gap:4px;min-width:0}
.shot-assets-choices label{display:flex!important;align-items:center;gap:3px;min-width:0;font-size:9px!important;margin:0!important;white-space:normal;overflow-wrap:anywhere}
.shot-professional-table .shot-assets-choices input[type=checkbox]{width:13px!important;height:13px!important;flex:none}
.shot-workbench .shot-professional-table td .shot-danger{font-size:10px!important;padding:3px 4px!important;white-space:normal;color:var(--el-color-danger,#c84f4f)!important;background:var(--el-color-danger-light-9,#fff2f2)!important;border-color:var(--el-color-danger-light-7,#f1cccc)!important}
.shot-empty{padding:25px 12px;color:var(--el-text-color-secondary,#7b8da3);font-size:12px;text-align:center}
@media(max-width:1050px){
  .video-script-stage{grid-template-columns:minmax(180px,210px) minmax(0,1fr)}
  .shot-script-editor{grid-template-columns:1fr;grid-template-rows:minmax(140px,.35fr) minmax(230px,.65fr)}
}
@media(max-width:800px){
  .shot-workbench{height:auto;min-height:0}
  .video-script-stage{grid-template-columns:1fr;display:flex;flex-direction:column;min-height:0}
  .shot-episode-sidebar{max-height:230px}
  .shot-script-editor{display:flex;flex-direction:column}
  .shot-script-source{max-height:270px}
  .shot-script-source pre{max-height:200px}
  .shot-video-editor textarea{height:300px;min-height:300px}
  .shot-table-stage{display:flex;flex-direction:column}
  .shot-table-video textarea{height:220px;min-height:220px}
  .shot-table-container{overflow-x:auto}
  .shot-professional-table{min-width:730px}
}
</style>
