import {parseModelValue,normalizeGeneration} from './generation.mjs';
import {resolveAvailableNodeTypes,pickId} from './mcp.mjs';
import {createLocalCanvasClient} from './localCanvas.mjs';
import {composeAssetImagePrompt} from './visualAssetRules.mjs';

export async function generateAssetImage(asset,project,files,{fetchFn=fetch,modelValue='',ratio='16:9',signal,derivative=null}={}){
  const setting=normalizeGeneration(project?.generation);
  const selected=parseModelValue(modelValue || setting.image.model);
  if(!selected)throw new Error('请选择图片模型或在项目设置中指定默认模型');
  if(!asset?.id||!(derivative?.prompt||asset.imagePrompt||asset.description||'').trim())throw new Error('请先填写资产描述或生图提示词');
  if(asset.kind==='音频')throw new Error('音频分类不适用图片生成，请使用 RH 音频工作流');
  const {directory}=await files.list();
  const outputDirectory=`assets/producer/${String(project.id).replace(/[^\w-]/g,'')}/${String(asset.id).replace(/[^\w-]/g,'')}`+
    (derivative?`/derivatives/${String(derivative.id).replace(/[^\w-]/g,'')}`:'');
  const referenceImage=derivative?asset.images?.find(image=>image.id===derivative.baseImageId):null;
  if(derivative && !referenceImage?.path)throw new Error('请先为衍生资产选择有效的基础参考图片');
  // 允许直接依据自由输入的变化要求生成衍生图；独立提示词为可选增强步骤。
  if(derivative && !String(derivative.instruction||'').trim())throw new Error('请先填写衍生资产的修改变化');
  const response=await fetchFn('/api/ai/media/generate',{method:'POST',signal,
    headers:{'Content-Type':'application/json','x-toonflow-workspace':'1'},
    body:JSON.stringify({directory,outputDirectory,mediaType:'image',providerId:selected.providerId,modelId:selected.modelId,
      prompt:composeAssetImagePrompt(asset,project,{derivative}),ratio,
      ...(referenceImage?{images:[{path:referenceImage.path,mimeType:referenceImage.mimeType||'image/png'}]}:{})})});
  if(!response.ok)throw new Error('图片生成失败 HTTP '+response.status+'：'+(await response.text()).slice(0,200));
  const data=await response.json();
  if(data.code!==200 || !Array.isArray(data.data) || !data.data.length)throw new Error(data.message||'图片生成未返回文件');
  const images=data.data.filter(x=>x?.mediaType==='image' && x.path && /^image\//.test(x.mimeType));
  if(!images.length)throw new Error('图片生成结果不是有效图片');
  return images.map(x=>({path:x.path,mimeType:x.mimeType,source:'model'}));
}

export async function generateAssetRh(asset,kind,project,context,{uid,signal,prompt,onBound}={}){
  if(!uid)throw new Error('请先选择 RH 工作流应用');
  if(!['image','audio'].includes(kind))throw new Error('不支持此输出格式');
  const client=createLocalCanvasClient(context.canvasProvider,{setTextNodeModel:context.setTextNodeModel});
  let snapshot;
  try { snapshot=await client.tool('getCanvas',{include:['nodeTypes']}); }
  catch (error) {
    const legacy=await client.tool('getCanvas',{});
    if(!legacy.availableNodeTypes && !legacy.nodeTypes)throw error;
    snapshot=legacy;
  }
  const types=resolveAvailableNodeTypes(snapshot);
  const type=types.get('runninghubWorkflowNode');
  if(!type)throw new Error('当前画布未安装 RH 工作流节点');
  const config=asset.rhNodes?.[kind];
  let nodeId;
  if(config?.canvasId===client.canvasId && config.uid===uid)nodeId=config.nodeId;
  else{
    const res=await client.tool('addNode',{type,label:`${asset.name} · RH ${kind==='image'?'图片':'配音'}`,
      position:{x:120,y:120}});
    nodeId=pickId(res);
    asset.rhNodes||={};asset.rhNodes[kind]={canvasId:client.canvasId,nodeId,uid};
    await onBound?.();
  }
  const call=(name,args={})=>client.tool('nodeTools',{nodeId,name:'node:'+name,args});
  await call('selectRunningHubApplication',{uid});
  if(typeof context.setRhPrompt==='function'){
    // 由所在节点的 VueFlow 同画布 store 写入 RH 文本参数；不修改 RH 插件和 ToonFlow 核心。
    await context.setRhPrompt(nodeId,prompt||asset.description);
  } else throw new Error('缺少 RH 提示词写入能力，已创建 RH 节点但尚未启动任务');
  if(signal?.aborted)throw new Error('任务已取消');
  const result=await call('runRunningHubWorkflow');
  const media=kind==='image'?result?.image:result?.audio;
  if(!media?.url||!media.mimeType || !media.mimeType.startsWith(kind+'/'))
    throw new Error(`RH 应用没有输出${kind==='image'?'图片':'音频'}，请检查应用输出类型`);
  return {path:media.url,mimeType:media.mimeType,source:'rh',nodeId};
}
