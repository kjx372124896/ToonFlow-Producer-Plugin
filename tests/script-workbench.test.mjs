import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {scriptWorkbenchRequest,generateScript} from '../src/scriptGeneration.mjs';

const source=readFileSync(fileURLToPath(new URL('../src/ScriptManager.vue',import.meta.url)),'utf8');
const chapters=[
 {id:'a',order:1,title:'第一章',content:'苏荷在门口遇到张三，说必须出发。'},
 {id:'b',order:2,title:'第二章',content:'两人在走廊争执，张三转身离开。'}
];
const fullScript='1-1 走廊 日 内\n△ 苏荷走进走廊。\n苏荷：我们现在出发。';
function sse(content){
 const bytes=new TextEncoder().encode('data: '+JSON.stringify({type:'done',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:content}]}})+'\n\n');
 return {ok:true,headers:{get:()=>'text/event-stream'},body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};
}

test('单页改写请求总是附带选中章节、当前剧本和本轮要求，空白剧本也可提交',()=>{
 const input={chapters,episode:1,targetSeconds:120,feedback:'保留原著台词并突出开场冲突'};
 const blank=scriptWorkbenchRequest({...input,currentText:''});
 assert.match(blank,/【所选章节原文】/);
 assert.match(blank,/【当前剧本正文】/);
 assert.match(blank,/【本轮改写要求】/);
 assert.ok(blank.includes(chapters[0].content)&&blank.includes(chapters[1].content));
 assert.ok(blank.includes('（空白，尚无剧本'));
 assert.ok(blank.includes(input.feedback));
 assert.ok(blank.includes('第1集')&&blank.includes('120秒'));
 const revised=scriptWorkbenchRequest({...input,currentText:fullScript});
 assert.ok(revised.includes(fullScript));
 assert.ok(revised.includes(input.feedback));
 assert.ok(!revised.includes('（空白，尚无剧本'));
 assert.throws(()=>scriptWorkbenchRequest({...input,feedback:'  '}),/改写要求/);
});

test('单页AI生成和改写实际调用文本模型时包含三类上下文，且覆盖完整剧本',async()=>{
 const messages=[];
 const opts={chapters,episode:1,targetSeconds:90,model:{providerId:'textProvider',modelId:'gptScript'},
    workbench:true,feedback:'让冲突更强，保留台词'};
 const fetchFn=async(url,options)=>{
   assert.equal(url,'/api/ai/generate');
   const data=JSON.parse(options.body);
   assert.equal(data.providerId,'textProvider');
   assert.equal(data.modelId,'gptScript');
   const prompt=data.context.messages[0].content;
   assert.ok(prompt.includes('【当前剧本正文】')&&prompt.includes('【本轮改写要求】')&&prompt.includes('【所选章节原文】'));
   messages.push(prompt);
   return sse(fullScript);
 };
 const first=await generateScript({...opts,currentText:'',fetchFn});
 const second=await generateScript({...opts,currentText:fullScript,fetchFn});
 assert.equal(first,fullScript);
 assert.equal(second,fullScript);
 assert.ok(messages[0].includes('（空白，尚无剧本'));
 assert.ok(messages[1].includes(fullScript));
 assert.equal(messages.length,2);
});

test('单屏工作台布局、章节即时预览、剧本保存和小输入框均存在，无首次改写要求和翻页Tab',()=>{
 const template=source.split('</template>')[0];
 assert.match(template,/class="script-card script-config-bar"/);
 assert.match(template,/class="script-card chapter-pane"/);
 assert.match(template,/class="script-card source-pane"/);
 assert.match(template,/class="script-card draft-pane"/);
 assert.match(template,/class="script-card instruction-pane"/);
 assert.match(template,/<pre class="source-reading">\{\{sourcePreview/);
 assert.match(template,/v-model="workspace.text" class="draft-text"/);
 assert.match(template,/v-model="workspace.feedback" class="workbench-instruction-input" rows="2"/);
 assert.match(template,/@click="requestRewrite"/);
 assert.match(template,/@click="saveDraftNow"/);
 assert.match(template,/@click="confirmScript"/);
 assert.doesNotMatch(template,/首次改写要求/);
 assert.doesNotMatch(template,/mode==='generate'|mode==='manage'|class="script-tabs"/);
 assert.match(template,/v-if="showLibrary" class="script-library-overlay"/);
 assert.match(source,/height:calc\(100vh - 144px\)/);
 assert.match(source,/grid-template-columns:minmax\(200px,244px\) minmax\(0,1fr\)/);
 assert.match(source,/workbench-right\{display:grid;grid-template-rows:/);
 assert.match(source,/\.instruction-pane \.workbench-instruction-input\{flex:none;min-height:54px;height:54px/);
});

test('已有剧本不会锁住章节或模型，统一改写记录历史并保存',()=>{
 assert.match(source,/:disabled="busy" @change="toggleChapter/);
 assert.match(source,/const currentText=workspace.text/);
 assert.match(source,/currentText,feedback,model,workbench:true,signal:token.signal/);
 assert.match(source,/workspace.revisions=\[\.\.\.workspace.revisions,\{request:feedback,text/);
 assert.doesNotMatch(source,/workspace.text && workspace.sourceHash!==sourceSignature/);
 assert.doesNotMatch(source,/if\(workspace.text && workspace.lastModel\)/);
 assert.match(source,/await props.context.flushSave\(\)/);
 assert.match(source,/function saveDraftNow\(/);
});
