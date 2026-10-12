import test from "node:test";
import assert from "node:assert/strict";
import { enqueueTasks, normalizeQueueSettings, queueStats, recoverInterrupted,
  runTaskQueue, tasksFor, MAX_CONCURRENCY } from "../src/taskQueue.mjs";
import { createProject, emptyStudio } from "../src/studio.mjs";

function store(name="制片中心"){
  const s=emptyStudio();s.project=createProject({name});return s;
}
function defer(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}

test("项目四类独立限额：默认值、100上限、最小1及重试次数",()=>{
  const defaults=normalizeQueueSettings();
  assert.deepEqual(Object.keys(defaults),["text","image","video","audio"]);
  assert.equal(MAX_CONCURRENCY,100);
  assert.equal(defaults.text.concurrency,5);
  assert.equal(defaults.video.concurrency,2);
  const custom=normalizeQueueSettings({text:{concurrency:100,retries:3},image:{concurrency:500,retries:30},
    video:{concurrency:0,retries:-1},audio:{concurrency:"16",retries:"1"}});
  assert.equal(custom.text.concurrency,100);
  assert.equal(custom.image.concurrency,100);
  assert.equal(custom.video.concurrency,1);
  assert.equal(custom.image.retries,5);
  assert.equal(custom.video.retries,0);
  assert.equal(custom.audio.concurrency,16);
  assert.equal(JSON.parse(JSON.stringify(custom)).text.retries,3);
});

test("500个任务并发上限100：剩余自动排队，无重复领取任务",async()=>{
  const s=store();
  enqueueTasks(s,"text",Array.from({length:500},(_,i)=>({id:"chapter-"+i,sourceHash:"v1"})));
  let active=0,peak=0,call=0;
  const gate=defer();
  const runner=runTaskQueue({jobs:tasksFor(s,"text"),concurrency:100,retries:0,
    async execute(job){active++;peak=Math.max(peak,active);call++;await gate.promise;active--;return job.id;}});
  // 100个worker同步进入execute，后续排队未领取
  assert.equal(active,100);
  assert.equal(queueStats(tasksFor(s,"text")).queued,400);
  gate.resolve();
  const result=await runner;
  assert.equal(peak,100);
  assert.equal(call,500);
  assert.equal(result.stats.success,500);
  assert.equal(result.stats.queued,0);
  assert.equal(result.stats.failed,0);
});

test("失败自动进队尾重试，成功不重跑，永久失败累计次数后停止",async()=>{
  const s=store();
  enqueueTasks(s,"text",[{id:"ok",sourceHash:"v1"},{id:"flaky",sourceHash:"v1"},{id:"bad",sourceHash:"v1"}]);
  const logs=[],calls={};
  const result=await runTaskQueue({jobs:tasksFor(s,"text"),concurrency:2,retries:2,wait:async()=>{},
    execute(job){calls[job.id]=(calls[job.id]||0)+1;logs.push(job.id+"-"+calls[job.id]);
      if(job.id==="bad"||(job.id==="flaky"&&calls[job.id]===1))throw new Error("上游 503");
      return "ok";},
    onFailure(job,err){assert.equal(job.id,"bad");assert.match(err.message,/503/);}
  });
  assert.equal(result.stats.success,2);
  assert.equal(result.stats.failed,1);
  assert.equal(calls.ok,1);
  assert.equal(calls.flaky,2);
  assert.equal(calls.bad,3);
  assert.equal(tasksFor(s,"text").find(j=>j.id==="bad").lastError,"上游 503");
  // 已成功任务不会被默认重新加入；失败任务可以显式重试
  enqueueTasks(s,"text",[{id:"ok",sourceHash:"v1"}]);
  assert.equal(tasksFor(s,"text").find(j=>j.id==="ok").status,"success");
  enqueueTasks(s,"text",[{id:"bad",sourceHash:"v1"}],{force:true});
  assert.equal(tasksFor(s,"text").find(j=>j.id==="bad").attempts,0);
  assert.equal(tasksFor(s,"text").find(j=>j.id==="bad").status,"queued");
  assert.ok(logs.indexOf("flaky-2")>logs.indexOf("ok-1"),"重试回到尾部执行");
});

test("中断后待生成和运行中任务可恢复，项目数据序列化后依旧有效",async()=>{
  const s=store();enqueueTasks(s,"text",Array.from({length:15},(_,i)=>({id:"ch-"+i,sourceHash:"h"})));
  const controller=new AbortController();
  const gate=defer();
  const running=runTaskQueue({jobs:tasksFor(s,"text"),concurrency:3,signal:controller.signal,
    async execute(){await gate.promise;},retries:0});
  assert.equal(queueStats(tasksFor(s,"text")).running,3);
  controller.abort();gate.resolve();
  const stopped=await running;
  assert.equal(stopped.cancelled,true);
  assert.equal(stopped.stats.queued,15);
  const saved=JSON.parse(JSON.stringify(s));
  saved.taskQueues.text[0].status="running"; // 模拟刷新前持久化了运行中标记
  const restored=recoverInterrupted(saved,"text");
  assert.equal(restored[0].status,"queued");
  const resumed=await runTaskQueue({jobs:restored,concurrency:4,execute:async j=>j.id});
  assert.equal(resumed.stats.success,15);
  assert.equal(saved.chapters.length,0);
});

test("四个媒体队列独立：文本调度不消费图片/视频/音频任务，跨项目隔离",async()=>{
  const a=store("项目A"),b=store("项目B");
  for(const kind of ["text","image","video","audio"]){enqueueTasks(a,kind,[{id:"same-id",sourceHash:kind}]);}
  enqueueTasks(b,"text",[{id:"same-id",sourceHash:"b"}]);
  const result=await runTaskQueue({jobs:tasksFor(a,"text"),concurrency:10,execute:async()=>true});
  assert.equal(result.stats.success,1);
  for(const kind of ["image","video","audio"])
    assert.equal(queueStats(tasksFor(a,kind)).queued,1);
  assert.equal(queueStats(tasksFor(b,"text")).queued,1);
});

test("重复提交相同ID仅保留一个任务；原文发生变化可重新加入",()=>{
  const s=store();
  enqueueTasks(s,"text",[{id:"chapter-1",sourceHash:"h1"},{id:"chapter-1",sourceHash:"h1"}]);
  assert.equal(tasksFor(s,"text").length,1);
  tasksFor(s,"text")[0].status="success";
  enqueueTasks(s,"text",[{id:"chapter-1",sourceHash:"h1"}]);
  assert.equal(tasksFor(s,"text")[0].status,"success");
  enqueueTasks(s,"text",[{id:"chapter-1",sourceHash:"h2"}]);
  assert.equal(tasksFor(s,"text")[0].status,"queued");
  assert.equal(tasksFor(s,"text")[0].sourceHash,"h2");
});
