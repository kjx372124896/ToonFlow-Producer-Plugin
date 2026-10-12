import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EVENT_RULE_ID, EVENT_RULE_CATALOG, allEventRules, builtinEventRule,
  createEventRule, loadEventRules, resolveEventRule, ruleFingerprint, saveEventRules,
  snapshotEventRule, validateEventRule } from "../src/eventRules.mjs";
import { eventPrompt, analyzeChapter } from "../src/eventAnalysis.mjs";
import { enqueueTasks, tasksFor } from "../src/taskQueue.mjs";
import { emptyStudio } from "../src/studio.mjs";

function fakeFiles(){
  const entries = new Map();
  const dirs = new Set();
  return {entries,dirs,
    async mkdir(name){if(dirs.has(name))throw Object.assign(new Error("exists"),{code:"EEXIST"});dirs.add(name);},
    async list(name){if(!dirs.has(name))throw Object.assign(new Error("not found"),{code:"ENOENT"});
      return {entries:[...entries.keys()].filter(p=>p.startsWith(name+"/")).map(p=>({name:p.split("/").at(-1)}))};},
    async readText(name){if(!entries.has(name))throw Object.assign(new Error("not found"),{code:"ENOENT"});return entries.get(name);},
    async write(name,value){if(!dirs.has(name.split("/")[0]))throw new Error("dir missing");entries.set(name,value);}
  };
}
const example='| 第1章 职业危机与许愿 | 林逸 | 职业魔术师林逸因解密打假风潮导致事业崩塌，颓废中许愿，意外触发神奇魔法系统绑定 | 强（主角动机建立） | 高 | 50秒 | 转折+悬疑 |';
function output(raw){const data=new TextEncoder().encode('data: '+JSON.stringify({type:'done',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:raw}]}})+'\n\n');
  return {ok:true,headers:{get:()=>"text/event-stream"},body:new ReadableStream({start(c){c.enqueue(data);c.close();}})};}

test("默认规则可选、内置指令保持原内容且不可当作自定义规则覆盖",()=>{
  assert.equal(DEFAULT_EVENT_RULE_ID,"builtin:event-extraction-7");
  assert.deepEqual(allEventRules().map(x=>x.id),[DEFAULT_EVENT_RULE_ID]);
  assert.equal(resolveEventRule(DEFAULT_EVENT_RULE_ID).prompt,eventPrompt);
  assert.throws(()=>validateEventRule(builtinEventRule),/ID 无效/);
  const copy=createEventRule(builtinEventRule);
  assert.notEqual(copy.id,DEFAULT_EVENT_RULE_ID);
  assert.equal(copy.prompt,eventPrompt);
  assert.equal(copy.source,"custom");
  assert.notEqual(ruleFingerprint(copy.prompt),ruleFingerprint(copy.prompt+'新增要求'));
});

test("创建、保存、选择、修改、复制和删除规则可跨项目复用并写后验证",async()=>{
  const files=fakeFiles();
  assert.deepEqual(await loadEventRules(files),[]);
  const first=createEventRule();first.name="动作重点";first.prompt="分析角色行动，按7字段输出";
  const second=createEventRule(first);second.name="悬疑重点";
  await saveEventRules(files,[first,second]);
  assert.ok(files.entries.has(EVENT_RULE_CATALOG));
  let loaded=await loadEventRules(files);
  assert.equal(loaded.length,2);
  assert.equal(allEventRules(loaded).length,3);
  assert.equal(resolveEventRule(first.id,loaded).prompt,first.prompt);
  assert.deepEqual(snapshotEventRule(loaded[1]),{
    id:second.id,name:second.name,prompt:second.prompt,digest:ruleFingerprint(second.prompt)
  });
  const copy=createEventRule(loaded[1]);
  loaded[0].prompt="新版本强转折规则";
  await saveEventRules(files,[...loaded,copy]);
  loaded=await loadEventRules(files);
  assert.equal(loaded.length,3);
  assert.equal(resolveEventRule(first.id,loaded).prompt,"新版本强转折规则");
  await saveEventRules(files,loaded.filter(x=>x.id!==second.id));
  assert.equal(resolveEventRule(second.id,await loadEventRules(files)),null);
  assert.equal(resolveEventRule(DEFAULT_EVENT_RULE_ID,await loadEventRules(files)).source,"builtin");
});

test("规则正文错误、损坏数据和写后失败均不报告保存成功",async()=>{
  const files=fakeFiles();
  const wrong=createEventRule();wrong.prompt="  ";
  await assert.rejects(()=>saveEventRules(files,[wrong]),/正文/);
  const valid=createEventRule();
  await saveEventRules(files,[valid]);
  files.entries.set(EVENT_RULE_CATALOG,"{not json");
  await assert.rejects(()=>loadEventRules(files),/JSON 损坏/);
  const corrupted=fakeFiles();await corrupted.mkdir("producer-rules");
  corrupted.entries.set(EVENT_RULE_CATALOG,JSON.stringify({schemaVersion:1,rules:[{...valid,id:DEFAULT_EVENT_RULE_ID}]}));
  await assert.rejects(()=>loadEventRules(corrupted),/ID 无效/);
  const writeBroken=fakeFiles();writeBroken.write=async()=>{};
  await assert.rejects(()=>saveEventRules(writeBroken,[valid]),/校验失败|not found/);
});

test("章节分析使用所选规则作为 systemPrompt，格式错误重试也保留这条规则",async()=>{
  const prompt="重点关注情节反转，确保输出七字段单行文本。";
  let calls=0;
  const choice={providerId:"p",modelId:"m"};
  const result=await analyzeChapter({title:"第1章 职业危机与许愿",content:"小说原文",order:1},choice,{
    prompt,fetchFn:async(url,req)=>{
      assert.equal(url,"/api/ai/generate");
      const body=JSON.parse(req.body);
      calls++;
      assert.ok(body.context.systemPrompt.startsWith(prompt));
      if(calls===2)assert.ok(body.context.systemPrompt.includes("格式纠正"));
      return output(calls===1?"格式不正确":example);
    }
  });
  assert.equal(calls,2);
  assert.equal(result.structured.duration,"50秒");
  await assert.rejects(()=>analyzeChapter({title:"第1章",content:"原文"},choice,{prompt:" "}),/规则正文不能为空/);
});

test("章节队列保存提交时规则快照：编辑规则后不改变已排队章节；变更规则允许重新生成",()=>{
  const studio=emptyStudio();
  const custom=createEventRule();custom.prompt="原始规则";
  const rule=snapshotEventRule(custom);
  enqueueTasks(studio,"text",[{id:"ch1",sourceHash:"hash",rule,ruleDigest:rule.digest}]);
  const job=tasksFor(studio,"text")[0];
  custom.prompt="修改后的规则";
  assert.equal(job.rule.prompt,"原始规则");
  assert.notEqual(job.rule.digest,ruleFingerprint(custom.prompt));
  job.status="success";
  enqueueTasks(studio,"text",[{id:"ch1",sourceHash:"hash",rule,ruleDigest:rule.digest}]);
  assert.equal(job.status,"success");
  const next=snapshotEventRule(custom);
  enqueueTasks(studio,"text",[{id:"ch1",sourceHash:"hash",rule:next,ruleDigest:next.digest}]);
  assert.equal(job.status,"queued");
  assert.equal(job.rule.prompt,"修改后的规则");
  assert.equal(JSON.parse(JSON.stringify(studio)).taskQueues.text[0].rule.prompt,"修改后的规则");
  job.status="success";
  const another={...next,id:"customEventRule-other"};
  enqueueTasks(studio,"text",[{id:"ch1",sourceHash:"hash",rule:another,ruleDigest:another.digest}]);
  assert.equal(job.status,"queued","使用内容相同但不同的规则时仍允许重新分析");
});
