import {readEventModelStream} from './eventAnalysis.mjs';
import {uid} from './studio.mjs';

export const VIDEO_SCRIPT_SYSTEM_PROMPT = `你是资深短剧导演兼视频脚本编剧。请把已经完成的分集剧本改写成【可直接用于下一阶段专业分镜表设计的完整视频脚本】，只输出脚本正文，不输出解读、Markdown代码围栏或建议。
请按剧本发生顺序，为每个连续可拍摄叙事单元列出【序号｜场景·日夜·内外｜建议时长｜画面与人物调度｜动作表演｜原著关键台词｜声音/节奏｜转场】。
要求：充分覆盖原剧本，重要原著台词不随意丢失；严格依照已提供剧本与资产，不凭空增加关键情节；时长清晰，动作可拍摄；节奏符合短剧，开头有钩子，结尾有悬念；场景连续性明确；建议视频脚本的粒度比正式逐镜分镜表略粗，下一阶段才拆成单个镜头。输出中文。
`;

export function createVideoScriptRecord(script, text=''){
  if(!script?.id)throw new Error('未选择有效的剧本');
  return {id:uid('videoScript'),scriptId:script.id,episode:script.episode,title:script.title||'',text:String(text),updatedAt:new Date().toISOString()};
}
export function videoScriptRequest(script,project={},assets=[]){
  if(!script?.text?.trim())throw new Error('剧本正文为空，无法生成视频脚本');
  return [
    '【项目画幅】'+(project.aspectRatio||'9:16'),
    '【分集】第'+script.episode+'集 '+(script.title||''),
    '【视觉手册】\n'+(project.visualManual||'（未设置）'),
    '【导演手册】\n'+(project.directorManual||'（未设置）'),
    '【可用资产】\n'+(assets.map(a=>a.kind+'｜'+a.name+'｜'+(a.description||'')).join('\n')||'（暂无资产）'),
    '【完整分集剧本】\n'+script.text,
    '【要求】将完整剧本转换为完整的视频脚本，保留核心剧情与关键台词。'
  ].join('\n\n');
}
export async function generateVideoScript({script,project={},assets=[],model,fetchFn=fetch,signal}){
  if(!model?.providerId||!model.modelId)throw new Error('请先在项目设置中配置文本模型');
  const response=await fetchFn('/api/ai/generate',{method:'POST',signal,
    headers:{'Content-Type':'application/json','x-toonflow-workspace':'1'},
    body:JSON.stringify({providerId:model.providerId,modelId:model.modelId,context:{
      systemPrompt:VIDEO_SCRIPT_SYSTEM_PROMPT,
      messages:[{role:'user',timestamp:Date.now(),content:videoScriptRequest(script,project,assets)}]
    }})
  });
  const text=String(await readEventModelStream(response,signal)).trim()
    .replace(/^```(?:markdown|text)?\s*/i,'').replace(/\s*```$/,'').trim();
  if(text.length<30)throw new Error('视频脚本生成结果太短，请检查模型输出');
  return text;
}

export function replaceEpisodeStoryboard(rows,newRows,scriptId){
  return [...(rows||[]).filter(row=>row.scriptId!==scriptId),...newRows];
}
