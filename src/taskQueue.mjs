// 制片中心独立项目任务队列。这里只管理调度；具体文本/图片/视频/音频生成由调用方提供执行器。
export const TASK_KINDS = ["text", "image", "video", "audio"];
const defaultLimits = {text:5,image:3,video:2,audio:3};
export const MAX_CONCURRENCY = 100;
export function normalizeQueueSettings(input) {
  const result={};
  for (const kind of TASK_KINDS) {
    const item=input?.[kind]||{};
    const limit=Number(item.concurrency), retries=Number(item.retries);
    result[kind]={
      concurrency:Number.isFinite(limit) ? Math.min(MAX_CONCURRENCY,Math.max(1,Math.trunc(limit))) : defaultLimits[kind],
      retries:Number.isFinite(retries) ? Math.min(5,Math.max(0,Math.trunc(retries))) : 2
    };
  }
  return result;
}
export function tasksFor(studio,kind) {
  if (!TASK_KINDS.includes(kind)) throw new Error("不支持的队列类型："+kind);
  studio.taskQueues ||= {};
  studio.taskQueues[kind] ||= [];
  return studio.taskQueues[kind];
}
export function enqueueTasks(studio,kind,items,{force=false}={}) {
  const tasks=tasksFor(studio,kind), existing=new Map(tasks.map(job=>[job.id,job]));
  for (const item of items) {
    if (!item.id) throw new Error("队列任务缺少 ID");
    const old=existing.get(item.id);
    if (old) {
      if (old.status==="running" || old.status==="queued") continue;
      if (!force && old.status==="success" && old.sourceHash===item.sourceHash &&
        (old.ruleDigest || "") === (item.ruleDigest || "") &&
        (old.rule?.id || "") === (item.rule?.id || "")) continue;
      Object.assign(old,{...item,status:"queued",attempts:0,lastError:"",updatedAt:new Date().toISOString()});
    } else {
      const job={...item,status:"queued",attempts:0,lastError:"",updatedAt:new Date().toISOString()};
      tasks.push(job);existing.set(job.id,job);
    }
  }
  return tasks;
}
export function recoverInterrupted(studio,kind) {
  const tasks=tasksFor(studio,kind);
  for (const job of tasks) if (job.status==="running" || job.status==="retrying") {
    job.status="queued";
    job.updatedAt=new Date().toISOString();
  }
  return tasks;
}
export function queueStats(tasks) {
  const stats={total:tasks.length,queued:0,running:0,success:0,failed:0,retrying:0};
  for (const job of tasks) {
    if (job.status==="queued") stats.queued++;
    else if(job.status==="running")stats.running++;
    else if(job.status==="retrying")stats.retrying++;
    else if(job.status==="success")stats.success++;
    else if(job.status==="failed")stats.failed++;
  }
  return stats;
}
function abortError(){const e=new Error("任务已取消");e.name="AbortError";return e;}
export function waitForRetry(ms,signal) {
  if(signal?.aborted)return Promise.reject(abortError());
  return new Promise((resolve,reject)=>{
    const finish=()=>{clearTimeout(timer);signal?.removeEventListener("abort",stop);};
    const stop=()=>{finish();reject(abortError());};
    const timer=setTimeout(()=>{finish();resolve();},ms);
    signal?.addEventListener("abort",stop,{once:true});
  });
}
// 并发工人领取唯一 ID；失败尾部重新入队（让等待任务先执行），最多重试 retries 次。
// 即使关闭页面，也不会把未开始的任务标记为失败；重新打开可恢复。
export async function runTaskQueue({jobs,concurrency=1,retries=2,execute,onSuccess,onFailure,persist=async()=>{},signal,onProgress=()=>{},wait=waitForRetry}) {
  const cap=Math.min(MAX_CONCURRENCY,Math.max(1,Math.trunc(Number(concurrency)||1)));
  const retryLimit=Math.min(5,Math.max(0,Math.trunc(Number(retries)||0)));
  const pending=jobs.filter(job=>job.status==="queued");
  let fatal=null,completed=0;
  const report=()=>onProgress({completed,stats:queueStats(jobs)});
  async function worker(){
    while (pending.length && !signal?.aborted && !fatal) {
      const job=pending.shift();
      if (!job || job.status!=="queued") continue;
      job.status="running";job.attempts=(job.attempts||0)+1;job.updatedAt=new Date().toISOString();report();
      try {
        const result=await execute(job,signal);
        if(signal?.aborted)throw abortError();
        await onSuccess?.(job,result);
        if(signal?.aborted)throw abortError();
        job.status="success";job.lastError="";job.updatedAt=new Date().toISOString();
        completed++;
      } catch(error) {
        if(signal?.aborted || error?.name==="AbortError") {
          job.status="queued";job.updatedAt=new Date().toISOString();
          report();break;
        }
        job.lastError=error instanceof Error?error.message:String(error);
        job.failedRaw=typeof error?.raw==="string"?error.raw:undefined;
        job.updatedAt=new Date().toISOString();
        if(job.attempts<=retryLimit) {
          job.status="retrying";
          report();
          // 退避防止 429/503 密集请求；一次最多等待 8 秒。
          try {await wait(Math.min(8000,1000*2**(job.attempts-1)),signal);} catch {job.status="queued";break;}
          if(signal?.aborted){job.status="queued";break;}
          job.status="queued";pending.push(job);
        } else {
          job.status="failed";completed++;
          await onFailure?.(job,error);
        }
      }
      report();
      try {await persist(job);}catch(e){fatal=e;break;}
    }
  }
  await Promise.all(Array.from({length:Math.min(cap,pending.length)},()=>worker()));
  // 页面停止/请求中断后，任务状态统一回到可恢复队列。
  for(const job of jobs)if(job.status==="running"||job.status==="retrying")job.status="queued";
  report();
  if(fatal)throw fatal;
  return {completed,stats:queueStats(jobs),cancelled:!!signal?.aborted};
}
