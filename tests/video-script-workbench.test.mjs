import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {emptyStudio,parseStudio,parseStoryboardRows,storyboardRequest,createStoryboardBoard} from '../src/studio.mjs';
import {createVideoScriptRecord,videoScriptRequest,generateVideoScript,replaceEpisodeStoryboard} from '../src/videoScript.mjs';

const script1={id:'s1',episode:1,title:'开端',text:'1-1 食堂 日 内\n△ 林衍看向苏荷。\n苏荷：今天必须出发。'};
const script2={id:'s2',episode:2,title:'新局',text:'2-1 宿舍 夜 内\n△ 苏荷坐在书桌边。\n苏荷：我找到答案了。'};
function stream(text){
  const message={type:'done',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text}]}};
  return {ok:true,headers:{get:()=> 'text/event-stream'},body:new ReadableStream({start(ctrl){
    ctrl.enqueue(new TextEncoder().encode('data: '+JSON.stringify(message)+'\n\n'));ctrl.close();
  }})};
}

test('视频脚本单独保存于 videoScripts，旧项目无视频脚本时也可打开',()=>{
  const old={...emptyStudio(),scripts:[script1],storyboards:[]};
  delete old.videoScripts;
  const read=parseStudio(JSON.stringify(old));
  assert.deepEqual(read.videoScripts,[]);
  const entry=createVideoScriptRecord(script1,'1｜食堂｜3秒｜林衍看向苏荷');
  read.videoScripts.push(entry);
  const copy=parseStudio(JSON.stringify(read));
  assert.equal(copy.videoScripts[0].scriptId,script1.id);
  assert.equal(copy.videoScripts[0].text,entry.text);
});

test('从剧本到视频脚本的模型请求确实包含项目手册、资产、原剧本与集数',async()=>{
  let request;
  const result=await generateVideoScript({script:script1,assets:[{kind:'角色',name:'林衍',description:'青年男性'}],
    project:{aspectRatio:'9:16',visualManual:'现代都市真人',directorManual:'快速推进'},
    model:{providerId:'textProvider',modelId:'model1'},
    fetchFn:async(u,opts)=>{
      assert.equal(u,'/api/ai/generate');
      request=JSON.parse(opts.body);
      return stream('1｜食堂·日·内｜3秒｜中景｜林衍缓慢回头｜苏荷：今天必须出发｜环境人声｜硬切。');
    }
  });
  assert.match(result,/苏荷：今天必须出发/);
  assert.match(request.context.messages[0].content,/现代都市真人/);
  assert.match(request.context.messages[0].content,/快速推进/);
  assert.match(request.context.messages[0].content,/林衍/);
  assert.match(request.context.messages[0].content,/今天必须出发/);
  assert.match(videoScriptRequest(script2),/第2集/);
  await assert.rejects(generateVideoScript({script:script1}),/文本模型/);
});

test('分镜表请求必须把视频脚本作为主要依据，同时保留剧本作为台词核查',()=>{
  const video='1｜食堂｜2秒｜全景建立空间\n2｜食堂｜3秒｜苏荷突然起身';
  const prompt=storyboardRequest(script1,[{kind:'角色',name:'苏荷'}],{},video);
  assert.match(prompt,/已确认的视频脚本（分镜表必须以此为主依据）/);
  assert.match(prompt,/苏荷突然起身/);
  assert.match(prompt,/原始剧本（用于核对台词及人物）/);
  assert.match(prompt,/今天必须出发/);
  const manualPrompt=storyboardRequest(script1,[],{directorManual:'专业调度与连续性',visualManual:'影视高级光影'},video);
  assert.match(manualPrompt,/专业调度与连续性/);
  assert.match(manualPrompt,/影视高级光影/);
  const old=storyboardRequest(script1);
  assert.ok(!old.includes('已确认的视频脚本'));
});

test('生成新集分镜表时只替换当前集，镜头可继续制作下游分镜板',()=>{
  const rows1=parseStoryboardRows(JSON.stringify({shots:[
    {shotNo:'1-01',duration:3,action:'林衍走入',assetNames:['林衍']}
  ]}),script1,[{id:'actor1',name:'林衍'}]);
  const rows2=parseStoryboardRows(JSON.stringify({shots:[
    {shotNo:'2-01',duration:2,action:'苏荷抬眼'}
  ]}),script2);
  const revised=parseStoryboardRows(JSON.stringify({shots:[
    {shotNo:'2-01',duration:4,action:'苏荷抬眼，镜头推近',dialogue:'我找到答案了'}
  ]}),script2);
  const merged=replaceEpisodeStoryboard(rows1.concat(rows2),revised,script2.id);
  assert.equal(merged.length,2);
  assert.deepEqual(merged[0],rows1[0]);
  assert.equal(merged[1].action,'苏荷抬眼，镜头推近');
  revised[0].selected=true;
  const board=createStoryboardBoard([revised[0]]);
  assert.equal(board.episode,2);
  assert.equal(board.sourceIds.length,1);
  assert.equal(board.duration,4);
  assert.deepEqual(replaceEpisodeStoryboard(merged,[],script2.id),rows1);
});

test('分镜工作台沿用资产库视觉规范：按钮、表单、卡片和低调的阶段切换',()=>{
  const source=readFileSync(fileURLToPath(new URL('../src/StoryboardWorkbench.vue',import.meta.url)),'utf8');
  const asset=readFileSync(fileURLToPath(new URL('../src/AssetLibrary.vue',import.meta.url)),'utf8');
  assert.match(asset,/\.asset-library button\.primary\{background:#306fe3/);
  assert.match(source,/\.shot-workbench button\.shot-action-primary\{background:#306fe3!important/);
  assert.match(source,/\.shot-workbench button\{min-height:30px!important;padding:5px 9px!important;font-size:12px!important/);
  assert.match(source,/\.shot-workbench input,\.shot-workbench select,\.shot-workbench textarea\{[^}]*border-radius:6px/);
  assert.match(source,/\.shot-workbench select\{padding:6px 8px;min-height:32px\}/);
  assert.match(source,/\.shot-card\{[^}]*background:var\(--el-bg-color,#fff\);border:1px solid/);
  assert.match(source,/\.shot-step-tabs\{[^}]*background:transparent/);
  assert.match(source,/\.shot-workbench \.shot-step-tabs button\.active\{background:var\(--el-color-primary-light-9,#eaf3ff\)!important/);
  assert.match(source,/<button class="shot-action-next"[^>]*>进入分镜表 →<\/button>/);
  assert.match(source,/\.shot-config\{[^}]*border:0/);
  assert.match(source,/\.shot-professional-table\{[^}]*table-layout:fixed;width:100%;min-width:0/);
  assert.match(source,/overflow-wrap:anywhere;white-space:pre-wrap/);
});

test('两页分镜工作台真实存在：第一页左右编辑并批量，第二页上下视频脚本及表格，可保存可换行',()=>{
  const source=readFileSync(fileURLToPath(new URL('../src/StoryboardWorkbench.vue',import.meta.url)),'utf8');
  const host=readFileSync(fileURLToPath(new URL('../src/Studio.vue',import.meta.url)),'utf8');
  for(const x of ['视频脚本','专业分镜表','batchGenerate','checkedIds','generateOne','saveVideoScript','generateTable','save'])assert.ok(source.includes(x),x);
  assert.match(source,/v-if="stage==='script'" class="video-script-stage"/);
  assert.match(source,/class="shot-card shot-script-source"/);
  assert.match(source,/class="shot-card shot-video-editor"/);
  assert.match(source,/v-else class="shot-table-stage"/);
  assert.match(source,/class="shot-card shot-table-video"/);
  assert.match(source,/class="shot-card shot-table-panel"/);
  assert.match(source,/class="shot-professional-table"/);
  assert.match(source,/class="shot-table-container"/);
  assert.match(source,/table-layout:fixed;width:100%;min-width:0/);
  assert.match(source,/textarea\.shot-field/);
  assert.match(source,/overflow-wrap:anywhere;white-space:pre-wrap/);
  assert.match(source,/replaceEpisodeStoryboard\(props.rows,generated,script.id\)/);
  assert.match(source,/@change="toggleRowAsset\(row,asset.id,\$event.target.checked\)"/);
  assert.match(source,/function toggleRowAsset\(row,assetId,enabled\)/);
  assert.match(source,/@click="emit\('makeBoards'\)"/);
  assert.match(source,/@click="emit\('shotImage',row\)"/);
  assert.match(host,/\.section\.storyboard-section\{max-width:none;width:100%;height:100%/);
  assert.match(host,/createStoryboardBoard\(selectedStoryboardRows.value\)/);
  assert.match(host,/:model-value="storyboardModelValue"/);
  assert.match(host,/@update:modelValue="storyboardModelValue=\$event"/);
  assert.match(source,/const modelChoice=computed\(\{get:\(\)=>props.modelValue/);
});
