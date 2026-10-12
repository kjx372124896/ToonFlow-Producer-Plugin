import test from "node:test";
import assert from "node:assert/strict";
import { createProject, emptyStudio, extractAssets, buildPanels, parseScriptScenes } from "../src/studio.mjs";
import { SCRIPT_SYSTEM_PROMPT, selectedChapters, sourceSignature, draftPreviewSource,
  nextEpisode, scriptRequest, validateDraftSettings, validateScriptText, generateScript,
  makeEpisodeScript, episodeFilePath, writeEpisodeFile } from "../src/scriptGeneration.mjs";

const chapters=[
  {id:"ch1",order:1,title:"第1章 旧梦",content:"深夜，苏鸾发现密信。她对沈昭说：信已经到了。"},
  {id:"ch2",order:2,title:"第2章 借刀",content:"沈昭知道了线索，劝苏鸾谨慎，二人随后决定去相府。"},
  {id:"ch3",order:3,title:"第3章 见证",content:"第三章的内容"}
];
const content="1-1 苏鸾寝殿 夜 内\n△ 纸灯晃动，苏鸾将密信放在桌上。\n苏鸾：信已经到了。\n沈昭：先别轻举妄动。\n\n1-2 相府 日 外\n△ 二人抵达相府，远远望见门前侍卫。\n苏鸾：我们得查清楚。";
const revised="1-1 苏鸾寝殿 夜 内\n△ 深夜风声猎猎，苏鸾将密信推到沈昭面前。\n苏鸾：信已经到了。\n沈昭：那就查清楚。\n\n1-2 相府 日 外\n△ 两人穿过门外的人群，停在相府前。\n苏鸾：你要小心。";
function makeResponse(text){
  const bytes=new TextEncoder().encode('data: '+JSON.stringify({type:"done",message:{role:"assistant",stopReason:"stop",content:[{type:"text",text}]}})+'\r\n\r\n');
  return {ok:true,headers:{get:()=>"text/event-stream"},body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};
}
function memoryFiles(){
  const files=new Map(),folders=new Set();
  return {files,folders,
    async mkdir(path){if(folders.has(path))throw new Error("exists");folders.add(path);},
    async list(path){if(!folders.has(path))throw new Error("missing folder");return {entries:[]};},
    async write(path,value,exclusive){if(exclusive && files.has(path))throw new Error("exists");files.set(path,value);},
    async readText(path){if(!files.has(path))throw new Error("not found");return files.get(path);}
  };
}

test("可以选择单章或合并多章，按原小说顺序预览，空章和不存在的章节拒绝",()=>{
  const chosen=selectedChapters(chapters,["ch2","ch1"]);
  assert.deepEqual(chosen.map(c=>c.id),["ch1","ch2"]);
  assert.ok(draftPreviewSource(chosen).indexOf("第1章")<draftPreviewSource(chosen).indexOf("第2章"));
  assert.ok(draftPreviewSource(chosen).includes("二人随后决定去相府"));
  assert.throws(()=>selectedChapters(chapters,[]),/至少选择/);
  assert.throws(()=>selectedChapters(chapters,["ch1","deleted"]),/删除/);
  assert.throws(()=>selectedChapters([{id:"bad",content:"",title:"空章"}],["bad"]),/空白/);
  assert.notEqual(sourceSignature(chosen),sourceSignature([chapters[0],{...chapters[1],content:"已变更"}]));
});

test("目标时长、集数约束和每集命名，不能占用异常集数或时长",()=>{
  for(const invalid of [0,12.5,10000,NaN])assert.throws(()=>validateDraftSettings({episode:invalid,targetSeconds:120,chapters}),/集数/);
  for(const invalid of [0,14,3601,90.3])assert.throws(()=>validateDraftSettings({episode:2,targetSeconds:invalid,chapters}),/时长/);
  assert.deepEqual(validateDraftSettings({episode:2,targetSeconds:90,chapters}),{episode:2,targetSeconds:90});
  assert.equal(nextEpisode([{episode:1},{episode:9}]),10);
  assert.equal(nextEpisode([]),1);
  assert.ok(SCRIPT_SYSTEM_PROMPT.includes("日/夜"));
  assert.ok(SCRIPT_SYSTEM_PROMPT.includes("关键对白"));
});

test("首次生成以专业场次格式指令改编，多轮修改需保留原文、上一版、时长和追加反馈",()=>{
  const input={chapters:chapters.slice(0,2),episode:3,targetSeconds:125,requirements:"保留原台词"};
  const first=scriptRequest(input);
  assert.ok(first.includes("第3集"));
  assert.ok(first.includes("125秒"));
  assert.ok(first.includes("保留原台词"));
  assert.ok(first.includes(chapters[0].content));
  assert.ok(first.includes(chapters[1].content));
  assert.ok(!first.includes(chapters[2].content));
  const second=scriptRequest({...input,currentText:content,feedback:"提高冲突强度，保留第一句台词"});
  assert.ok(second.includes("上一版完整剧本"));
  assert.ok(second.includes(content));
  assert.ok(second.includes("提高冲突强度"));
  assert.ok(second.includes("125秒"));
  assert.ok(second.includes(chapters[0].content));
  assert.throws(()=>scriptRequest({...input,currentText:content,feedback:" "}),/本轮修改意见/);
});

test("完整专业剧本格式：场景连续、日夜/内外正确、纯正文，错误模型结果不入库",()=>{
  assert.equal(validateScriptText(content,1),content);
  assert.equal(parseScriptScenes(content,1).length,2);
  assert.throws(()=>validateScriptText("```\n"+content+"\n```",1),/说明或 Markdown/);
  assert.throws(()=>validateScriptText(content.replace("1-1","1-2"),1),/从 1-1 开始/);
  assert.throws(()=>validateScriptText(content.replace("1-2","1-3"),1),/连续/);
  assert.throws(()=>validateScriptText(content.replace("夜 内","凌晨 内"),1),/首行/);
  assert.throws(()=>validateScriptText(content,2),/2-1/);
  assert.throws(()=>validateScriptText("1-1 苏鸾寝殿 夜 内\n\n",1),/太短/);
});

test("实际 SSE 请求首稿和二次修改使用文本模型，二次修改返回整集而非补丁",async()=>{
  const model={providerId:"tf",modelId:"script"};let calls=0;
  const fetchFn=async(url,init)=>{
    calls++;assert.equal(url,"/api/ai/generate");assert.equal(init.method,"POST");
    const payload=JSON.parse(init.body);
    assert.equal(payload.providerId,"tf");assert.equal(payload.modelId,"script");
    assert.ok(payload.context.systemPrompt.includes("专业影视短剧编剧"));
    if(calls===2){
      assert.ok(payload.context.messages[0].content.includes("上一版完整剧本"));
      assert.ok(payload.context.messages[0].content.includes("删去多余铺垫"));
      assert.ok(payload.context.messages[0].content.includes(content));
    }
    return makeResponse(calls===1?content:revised);
  };
  const base={chapters:chapters.slice(0,2),episode:1,targetSeconds:100,requirements:"",model,fetchFn};
  const first=await generateScript(base);
  const second=await generateScript({...base,currentText:first,feedback:"删去多余铺垫"});
  assert.equal(first,content);assert.equal(second,revised);assert.equal(calls,2);
  const bad=await generateScript({...base,fetchFn:async()=>makeResponse("模型解释：需要更多材料")}).then(()=>"unexpected",e=>e.message);
  assert.match(bad,/场次|场景头/);
});

test("确认前工作稿与正式剧本相互隔离，确认保存一集兼容资产库和分镜",async()=>{
  const studio=emptyStudio();studio.project=createProject({name:"影视项目"});studio.chapters=chapters;
  studio.scriptWorkspace={chapterIds:["ch1","ch2"],text:content,episode:1,targetSeconds:100,revisions:[{text:content}]};
  assert.equal(studio.scripts.length,0);
  const script=makeEpisodeScript({chapters:chapters.slice(0,2),episode:1,targetSeconds:100,
    requirements:"保留原台词",text:content,model:{providerId:"tf",modelId:"script"},revisions:[{text:content}]});
  assert.equal(script.chapterIds.length,2);
  assert.equal(script.chapterId,"ch1"); // 与旧项目兼容
  assert.equal(script.episode,1);
  assert.equal(script.status,"已定稿");
  assert.equal(script.revisionCount,1);
  assert.equal(script.scenes.length,2);
  const files=memoryFiles();
  script.filePath=await writeEpisodeFile(files,"影视项目-xyz/项目.tfprod",script);
  assert.ok(script.filePath.includes("/scripts/第001集-"));
  assert.equal(await files.readText(script.filePath),content);
  studio.scripts.push(script);delete studio.scriptWorkspace;
  const serialized=JSON.parse(JSON.stringify(studio));
  assert.equal(serialized.scripts.length,1);
  assert.equal(serialized.scriptWorkspace,undefined);
  const assets=extractAssets(serialized.scripts);
  assert.ok(assets.some(x=>x.kind==="角色"&&x.name==="苏鸾"));
  const panels=buildPanels(serialized.scripts,assets);
  assert.ok(panels.length>=2);
  assert.ok(panels.every(x=>x.scriptId===script.id && x.episode===1));
});

test("写后校验失败阻止假成功；修改既有剧本复用原文件路径",async()=>{
  const script=makeEpisodeScript({chapters:chapters.slice(0,1),episode:1,targetSeconds:75,text:content});
  const files=memoryFiles();
  const file=await writeEpisodeFile(files,"影视项目-x/项目.tfprod",script);
  await writeEpisodeFile(files,"影视项目-x/项目.tfprod",{...script,filePath:file,text:revised});
  assert.equal(files.files.size,1);
  assert.equal(await files.readText(file),revised);
  files.write=async()=>{};
  await assert.rejects(()=>writeEpisodeFile(files,"影视项目-x/项目.tfprod",{...script,filePath:file,text:content}),/校验失败/);
  assert.throws(()=>episodeFilePath("",script),/路径/);
});
