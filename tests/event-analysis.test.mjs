import test from "node:test";
import assert from "node:assert/strict";
import { analyzeChapter, chapterFingerprint, eventLine, eventPrompt, loadTextModels,
  parseEventLine, InvalidEventResultError, readEventModelStream } from "../src/eventAnalysis.mjs";
import { createProject, emptyStudio } from "../src/studio.mjs";

const example = '| 第1章 职业危机与许愿 | 林逸 | 职业魔术师林逸因解密打假风潮导致事业崩塌，颓废中许愿，意外触发神奇魔法系统绑定 | 强（主角动机建立） | 高 | 50秒 | 转折+悬疑 |';
function resultStream(raw, { stopReason = "stop", errors = null, cut = 13 } = {}) {
  const result = errors ? { type:"error",message:errors } : { type:"done",message:{
    role:"assistant",stopReason,content:[{type:"text",text:raw}]
  }};
  const payload="data: "+JSON.stringify(result)+"\r\n\r\n";
  const bytes=new TextEncoder().encode(payload);
  return {ok:true,headers:{get:()=>"text/event-stream; charset=utf-8"},body:new ReadableStream({start(ctrl){
    for(let i=0;i<bytes.length;i+=cut)ctrl.enqueue(bytes.slice(i,i+cut));
    ctrl.close();
  }})};
}

test("七字段协议与原始单行格式严格校验",()=>{
  const data=parseEventLine(example);
  assert.equal(data.chapterTitle,"第1章 职业危机与许愿");
  assert.equal(data.characters,"林逸");
  assert.equal(data.duration,"50秒");
  assert.equal(data.emotions,"转折+悬疑");
  assert.equal(eventLine(data),example);
  assert.ok(eventPrompt.includes("恰好七个非空字段"));
  assert.throws(()=>parseEventLine(example.replace("| 林逸 |","| 林逸 | 餐厅 |")),/7个/);
  assert.throws(()=>parseEventLine(example+"\n"),/单行/);
  assert.throws(()=>parseEventLine("说明："+example),/单行/);
  assert.throws(()=>parseEventLine(example.replace("50秒","1分钟")),/整数X秒/);
  assert.throws(()=>parseEventLine(example.replace("转折+悬疑","转折+惊悚")),/情绪强度/);
  assert.throws(()=>parseEventLine(example.replace("高 | 50秒","非常高 | 50秒")),/信息密度/);
  assert.throws(()=>parseEventLine(example.replace("职业魔术师林逸因解密打假风潮导致事业崩塌，颓废中许愿，意外触发神奇魔法系统绑定","非常高兴")),/30-60字/);
});

test("事件流支持分片/CRLF；没有 done 或有 error 时拒绝伪成功",async()=>{
  assert.equal(await readEventModelStream(resultStream(example,{cut:1})),example);
  await assert.rejects(()=>readEventModelStream(resultStream("",{errors:"余额不足"})),/余额不足/);
  await assert.rejects(()=>readEventModelStream(resultStream(example,{stopReason:"length"})),/未完整输出/);
  const empty={...resultStream(example),body:new ReadableStream({start(c){c.close();}})};
  await assert.rejects(()=>readEventModelStream(empty),/提前结束/);
});

test("通过宿主模型清单和 SSE 每章执行，发送 systemPrompt、user 原文和 provider/model",async()=>{
  const models=await loadTextModels(async(url)=>{
    assert.equal(url,"/api/ai/models");return {ok:true,json:async()=>({code:200,data:[
      {providerId:"text-provider",modelId:"text-model",label:"自定义模型",providerLabel:"测试供应商"}
    ]})};
  });
  assert.equal(models.length,1);
  let requests=0;
  const result=await analyzeChapter({order:1,title:"第1章 职业危机与许愿",content:"林逸希望学会魔法。"},models[0],{
    fetchFn:async(url,init)=>{
      requests++;assert.equal(url,"/api/ai/generate");assert.equal(init.method,"POST");
      const body=JSON.parse(init.body);
      assert.equal(body.providerId,"text-provider");assert.equal(body.modelId,"text-model");
      assert.ok(body.context.systemPrompt.includes("信息密度"));
      assert.ok(body.context.messages[0].content.includes("林逸希望学会魔法"));
      assert.equal(body.context.messages[0].role,"user");
      assert.equal(typeof body.context.messages[0].timestamp,"number");
      assert.ok(!Object.hasOwn(body,"apiKey"));
      return resultStream(example);
    }
  });
  assert.equal(requests,1);assert.equal(result.raw,example);
  assert.equal(result.structured.mainline,"强（主角动机建立）");
});

test("模型格式出错只重试一次，网络错误不重复计费",async()=>{
  let requests=0;
  const chapter={title:"第1章 职业危机与许愿",content:"林逸许愿获得魔法。",order:1};
  const cfg={providerId:"p",modelId:"m"};
  const result=await analyzeChapter(chapter,cfg,{fetchFn:async()=>resultStream(++requests===1?"格式错误":example)});
  assert.equal(requests,2);assert.equal(result.raw,example);
  requests=0;
  await assert.rejects(()=>analyzeChapter(chapter,cfg,{fetchFn:async()=>{
    requests++;throw new Error("网络失败");
  }}),/网络失败/);
  assert.equal(requests,1);
  let finalError;
  await analyzeChapter(chapter,cfg,{fetchFn:async()=>resultStream("格式错误")}).catch(e=>finalError=e);
  assert.ok(finalError instanceof InvalidEventResultError);
  assert.equal(finalError.raw,"格式错误");
});

test("无标准章节标题的原文使用合成章头，旧项目和事件记录可安全持久化",async()=>{
  const chapter={id:"ch-x",order:3,title:"无章头",content:"正常章节内容"};
  const hash=chapterFingerprint(chapter);
  const store=emptyStudio();store.project=createProject({name:"测试项目"});store.chapters.push(chapter);
  store.events.push({id:"evt-x",chapterId:"ch-x",status:"success",sourceHash:hash,structured:parseEventLine(example),raw:example});
  assert.equal(JSON.parse(JSON.stringify(store)).events[0].sourceHash,hash);
  chapter.content="章节已修改";
  assert.notEqual(chapterFingerprint(chapter),hash);
  let prompt="";
  await analyzeChapter(chapter,{providerId:"p",modelId:"m"},{fetchFn:async(_url,req)=>{
    prompt=JSON.parse(req.body).context.messages[0].content;
    return resultStream(example.replace("第1章 职业危机与许愿","第3章 无章头"));
  }});
  assert.ok(prompt.includes("第3章 无章头"));
});
test("模型不能将章节事件写进其他章节：章名不一致时自动重试后失败",async()=>{
  let attempts=0;
  await assert.rejects(()=>analyzeChapter({title:"第2章 新起点",content:"一行原文"},{providerId:"p",modelId:"m"},
    {fetchFn:async()=>{attempts++;return resultStream(example);}}),/章节名称与当前章节不一致/);
  assert.equal(attempts,2);
});
