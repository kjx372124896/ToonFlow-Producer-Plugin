import { uid, parseScriptScenes } from "./studio.mjs";
import { readEventModelStream } from "./eventAnalysis.mjs";
import { ensureFolders } from "./projectStorage.mjs";

export const SCRIPT_SYSTEM_PROMPT = `你是专业影视短剧编剧。将用户提供的一个或多个小说章节改编为可拍摄、可用于分镜制作的完整单集剧本。
严格按用户设定的目标时长组织剧情节奏与场次，不把原文章节数当成集数。每次只输出一集完整剧本，不要说明文字、Markdown、代码块、导演心得或改编分析。
要求：
1. 只根据给定原文改编。忠于人物关系、人物身份、核心事件及关键因果，不得凭空增加原文不存在的重要情节、角色或结局。
2. 优先保留原著有价值的关键对白，避免随意改写人物原话；删除重复叙述，将内心心理转换成可以表演的动作或必要的旁白。
3. 场景头每行单独成行，严格格式「集数-场次 地点 日/夜 内/外」，例如「1-1 苏鸾寝殿 夜 内」；集数使用输入中指定的数字，场次从1连续编号。时间只能写“日”或“夜”，空间只能写“内”或“外”。
4. 行动、环境、表演使用「△ 」开头，每句台词独立成行，写为「角色名：台词」；不用小说式大段旁白解释剧情，不要写分镜机位/镜头提示词/画面生成提示词。
5. 台词精炼自然、台词有明确的角色与目的；节奏紧凑、有清楚的开场推进、事件发展和结尾钩子，但不能编造原文没有的悬念事实。
6. 目标时长是创作预算，不是原文长度的机械换算。根据时长控制场次、对白、行动密度，不为凑时长堆积空镜或重复剧情；原文不足时合理压缩场次，不能捏造事件。
7. 仅输出完整剧本正文，从第一行场景头直接开始。`;

export function selectedChapters(all, ids){
  const chosen=new Set(ids);
  const result=(all||[]).filter(ch=>chosen.has(ch.id)).sort((a,b)=>(a.order??0)-(b.order??0));
  if(!result.length)throw new Error("请至少选择一个小说章节");
  if(result.length!==chosen.size)throw new Error("所选章节中有已删除的章节，请重新选择");
  if(result.some(ch=>!String(ch.content||"").trim()))throw new Error("所选章节含空白原文，无法改编");
  return result;
}
export function sourceSignature(chapters){
  let hash=2166136261;
  const text=chapters.map(ch=>ch.id+"\u0000"+ch.title+"\u0000"+ch.content).join("\u0002");
  for(let i=0;i<text.length;i++)hash=Math.imul(hash ^ text.charCodeAt(i),16777619);
  return text.length+":"+(hash>>>0).toString(16);
}
export function nextEpisode(scripts){
  return Math.max(0,...(scripts||[]).map(s=>Number(s.episode)||0))+1;
}
export function validateDraftSettings({episode,targetSeconds,chapters}){
  const ep=Number(episode),duration=Number(targetSeconds);
  if(!Number.isSafeInteger(ep)||ep<1||ep>9999)throw new Error("集数必须为1–9999的整数");
  if(!Number.isSafeInteger(duration)||duration<15||duration>3600)throw new Error("目标时长必须为15–3600秒的整数");
  if(!chapters?.length)throw new Error("至少需要一章原文");
  return {episode:ep,targetSeconds:duration};
}
export function draftPreviewSource(chapters){
  return chapters.map(ch=>`【${ch.title}】\n${ch.content}`).join("\n\n──────── 章节分隔 ────────\n\n");
}
export function scriptRequest({chapters,episode,targetSeconds,requirements="",currentText="",feedback=""}){
  const settings=validateDraftSettings({episode,targetSeconds,chapters});
  const source=draftPreviewSource(chapters);
  if(source.length>240000)throw new Error(`原文合计 ${source.length} 字符，超过单次调用的240000字符上限，请分批选择章节`);
  const base=`集数：第${settings.episode}集\n目标成片时长：${settings.targetSeconds}秒（${(settings.targetSeconds/60).toFixed(1)}分钟）\n原文章节：${chapters.map(c=>c.title).join("、")}\n改写要求：${requirements.trim()||"未指定，按专业短剧改编标准与目标时长自行规划"}`;
  if(!currentText) {
    return `请根据以下全部原文，生成一集专业短剧剧本。\n${base}\n\n【小说原文起】\n${source}\n【小说原文止】\n\n请直接输出剧本，从「${episode}-1 地点 日/夜 内/外」开始。`;
  }
  if(!feedback.trim())throw new Error("请输入本轮修改意见");
  return `请基于上一版完整剧本按本轮意见修订，输出【修改后的完整剧本】，不是增量补丁。保留未要求修改的有效内容，仍要忠于原文并满足目标时长。\n${base}\n\n【本轮修改要求】\n${feedback.trim()}\n\n【上一版完整剧本】\n${currentText}\n【上一版结束】\n\n【原小说作为事实依据】\n${source}\n【小说结束】\n\n只输出修改后的完整剧本。`;
}
// 单页剧本工作台专用：原文、当前剧本（允许为空）和本轮要求始终随同一次请求发送。
export function scriptWorkbenchRequest({chapters,episode,targetSeconds,currentText="",feedback=""}){
  const settings=validateDraftSettings({chapters,episode,targetSeconds});
  const requirement=String(feedback||"").trim();
  if(!requirement)throw new Error("请输入本轮改写要求");
  const source=draftPreviewSource(chapters);
  if(source.length>240000)throw new Error("选中原文超过240000字符，请减少章节");
  const draft=String(currentText||"");
  return [
    "你正在使用单页短剧编剧工作台。请根据原文事实、当前剧本（可为空）和本轮改写要求，输出完整单集剧本正文。",
    "若当前剧本为空，则根据原文和要求从头生成；若已有正文，则以当前正文为编辑底稿，只调整必要内容，保留未要求修改的有效情节和原著重要对白。",
    "最终必须输出【完整剧本】，而不是解释、片段或差异补丁。符合系统规定的连续场次格式。",
    "【目标集数】第"+settings.episode+"集",
    "【目标时长】"+settings.targetSeconds+"秒",
    "【本轮改写要求】\n"+requirement,
    "【当前剧本正文】\n"+(draft.trim()?draft:"（空白，尚无剧本，请直接根据所选原文生成）"),
    "【所选章节原文】\n"+source,
    "【原文结束】"
  ].join("\n\n");
}

export function validateScriptText(raw,episode){
  const text=String(raw||"").replace(/\r\n?/g,"\n").trim();
  if(!text)throw new Error("模型没有输出剧本正文");
  if(/^```|^#\s|^以下是|^根据|^好的/u.test(text))throw new Error("模型输出了说明或 Markdown，而不是从场景头开始的正式剧本");
  const lines=text.split("\n");
  const first=lines[0]?.match(/^(\d+)-(\d+)\s+(.+?)\s+(日|夜)\s+(内|外)\s*$/u);
  if(!first)throw new Error("剧本首行必须为「集数-场次 地点 日/夜 内/外」格式");
  if(Number(first[1])!==Number(episode)||Number(first[2])!==1)throw new Error(`场景头必须从 ${episode}-1 开始`);
  const headings=lines.filter(x=>/^\d+-\d+\s+.+\s+(日|夜)\s+(内|外)\s*$/u.test(x));
  if(!headings.length || lines.filter(x=>x.trim()).length<3)throw new Error("剧本太短或缺少有效动作和台词");
  headings.forEach((h,i)=>{
    const m=h.match(/^(\d+)-(\d+)\s+/u);
    if(Number(m[1])!==Number(episode)||Number(m[2])!==i+1)
      throw new Error(`场景编号必须按 ${episode}-1、${episode}-2……连续排列`);
  });
  if(!lines.some(x=>/^△\s*\S/u.test(x)||/^[\p{Script=Han}A-Za-z][^\n：:]{0,20}[：:]\S/u.test(x.trim())))
    throw new Error("剧本缺少动作描写或角色对白");
  return text;
}
export async function generateScript({chapters,episode,targetSeconds,requirements,currentText,feedback,model,fetchFn=fetch,signal,workbench=false}){
  if(!model?.providerId || !model.modelId)throw new Error("请先选择有效文本模型");
  const userPrompt=workbench?scriptWorkbenchRequest({chapters,episode,targetSeconds,currentText,feedback}):scriptRequest({chapters,episode,targetSeconds,requirements,currentText,feedback});
  const response=await fetchFn("/api/ai/generate",{
    method:"POST",headers:{"Content-Type":"application/json","x-toonflow-workspace":"1"},
    body:JSON.stringify({providerId:model.providerId,modelId:model.modelId,context:{
      systemPrompt:SCRIPT_SYSTEM_PROMPT,
      messages:[{role:"user",timestamp:Date.now(),content:userPrompt}]
    }}),signal
  });
  const raw=await readEventModelStream(response,signal);
  return validateScriptText(raw,episode);
}
export function makeEpisodeScript({chapters,episode,targetSeconds,requirements,text,title,model,revisions=[]}){
  const settings=validateDraftSettings({chapters,episode,targetSeconds});
  const final=validateScriptText(text,settings.episode);
  const now=new Date().toISOString();
  return {id:uid("script"),chapterId:chapters[0].id,chapterIds:chapters.map(ch=>ch.id),
    episode:settings.episode,title:String(title||`第${episode}集 · ${chapters.map(ch=>ch.title).join('、')}`).trim(),
    status:"已定稿",targetSeconds:settings.targetSeconds,requirements:String(requirements||""),
    sourceHash:sourceSignature(chapters),sourceChapterTitles:chapters.map(ch=>ch.title),
    model:model?{providerId:model.providerId,modelId:model.modelId}:null,
    text:final,scenes:parseScriptScenes(final,settings.episode),
    sourceEventIds:[],revisionCount:revisions.length,createdAt:now,updatedAt:now};
}
export function episodeFilePath(resourcePath,script){
  const path=String(resourcePath||"").replace(/\\/g,"/");
  if(!path || !path.includes("/"))throw new Error("没有当前项目文件夹路径");
  return path.slice(0,path.lastIndexOf("/"))+"/scripts/第"+String(script.episode).padStart(3,"0")+"集-"+
    script.id.replace(/[^a-z0-9_-]/gi,"-")+".txt";
}
export async function writeEpisodeFile(files,resourcePath,script){
  const file=script.filePath || episodeFilePath(resourcePath,script);
  await ensureFolders(files,file.slice(0,file.lastIndexOf("/")));
  await files.write(file,script.text,false);
  const readback=await files.readText(file);
  if(readback!==script.text)throw new Error("剧本文本文件写入校验失败，未确认入库");
  return file;
}
