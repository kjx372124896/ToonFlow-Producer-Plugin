import {uid} from './studio.mjs';
import {readEventModelStream} from './eventAnalysis.mjs';
import {normalizeDerivatives} from './assetDerivatives.mjs';

const KINDS=['角色','场景','道具','音频'];
export const ASSET_EXTRACTION_PROMPT=`# Script Assets Extract · 仅提取资产清单

你是专业的影视短剧剧本资产分析助手。完整阅读用户给出的本集剧本，只做资产**识别、分类、去重和客观描述**，输出可供资产库审核的结构化清单。

【严格边界】
- 本步骤仅提取资产，不做图片、音频或视频提示词生成，不生成媒体文件。
- 严禁返回 prompt、imagePrompt、audioPrompt、negativePrompt、模型参数、画风关键词或英文绘图短语。
- name 使用剧本中的真实名称或最常用称呼，不添加外观形容词或多余说明。
- description 使用中文，目标为 30–80 个汉字（含标点约 30–80 字）；要具体、精炼、视觉/声音可识别，但**只记录剧本可证实的细节**。原文证据不足时如实写“剧本未交代外貌/材质/颜色”等，不为了凑字数虚构。
- 不要复述剧情、台词或输出整段剧本，不因下游需要而臆造未出现的角色、场景、道具。
- 资产识别要完整，兼顾下游复用：提取所有**有名字的角色**、所有明确出现的**不同场景/地点**，以及有独立视觉意义或剧情功能的重要道具；无名普通群众与可替代通用物品可省略。
- 当前资产库支持“角色、场景、道具、音频”四类；“音频”仅包括本集实际提到且对制作重要的配音、音效、环境音和配乐，普通无关背景声不提取。

【各类提取规则】
1. 角色（kind=角色）
   - 提取剧本出现的全部具名角色，重要的无名角色亦可提取；同一人物的姓名、职称、别称、乳名合并为一个条目，name 选本集最常用的正式称呼，其余记入 aliases。
   - description 开头标明剧本可确认的性别（“男性，……”或“女性，……”）；原文无法确定时写“性别未明确，……”，禁止仅凭姓名或称号推测。
   - 描述剧本实际明确的外貌、发型、衣着、体态、身份相关视觉特征；未交代的要注明“原文未交代”，不要添加妆造和年龄等创作设定。
   - identityHint 记录角色所属势力、职务、身份关系等能区分同名者的证据；不同宗门都叫“大师兄”的角色不得自动视为同一个人。

2. 场景（kind=场景）
   - 识别剧本中的每个不同地点，包含室内、室外及场次标题中出现的实际地点。
   - 同一地点的日/夜、天气、灯光等状态合并成一个条目，在 description 中描述状态差异，不拆出重复场景。
   - description 优先记载原文有依据的空间结构、建筑、陈设、光线和色调。纯场景，不要人物、人物动作或人形剪影。
   - 普通固定陈设不额外拆成道具，除非有独立剧情功能。

3. 道具（kind=道具）
   - 提取对情节有功能、特征鲜明或需要跨镜头保持一致的物件；角色随身物品有独立剧情作用时单独提取。
   - description 说明已知的形状、尺寸参照、颜色、材质、纹理、独特标记或效果；未知属性如实说明，勿猜测。
   - 仅描述单个道具本身，不把场景背景或手持者纳入视觉描述。

4. 音频（kind=音频）
   - 保留当前项目的音频资产能力，只提取剧本实际明确且需要复用的声音/音乐/配音类型。
   - description 描述声源、声音内容、节奏、情绪或空间氛围等原文可确定的信息；不混写画面镜头信息。
   - 已经属于角色的普通单句台词不单独建立音频资产；重复出现的同类关键声音合并。

【身份、去重和范围】
- 本集内同一资产只输出一条；使用 aliases 保存其不同称呼，不自动把同称谓的不同人合并。
- 不能从“同名”或“大师兄”等泛称直接推导跨集身份；有歧义保留 identityHint，留给资产库人工确认绑定。
- 只提取当前这一集明确使用到的资产，不输出其他集、小说背景中未出现的资产。
- 以忠实剧本为最高优先级，未知信息不虚构，不要求强行凑够字数。

【结构化输出】
当前程序以 ToonFlow 文本模型返回的 JSON 解析结果，没有 resultTool。请在 **一条完整回复** 中返回合法 JSON 对象（不使用 Markdown 代码块、解释文字或多次提交）。
格式：
{"assets":[{"kind":"角色","name":"苏荷","aliases":["大师兄"],"identityHint":"青云宗的大弟子","description":"男性，剧本可确认的身份为青云宗大弟子，外貌、发型和服饰尚未在本集交代，具体人物造型待后续视觉手册确认。"}]}
assets 必须是数组，可为空；每个对象仅使用 kind、name、aliases、identityHint、description 五个字段。kind 必须是“角色”“场景”“道具”“音频”之一，aliases 为字符串数组，无别名写 []，identityHint 无线索写空字符串。
禁止任何 prompt 字段；后续“资产库 → 生成提示词”才会独立完成提示词生成。`;
export function normalizeName(value){return String(value||'').normalize('NFKC').trim().replace(/\s+/g,'').toLocaleLowerCase();}
export function parseAssetExtraction(raw,scriptId){
  const source=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  let json;try{json=JSON.parse(source);}catch{throw new Error('模型资产提取未返回合法 JSON');}
  if(!json||!Array.isArray(json.assets))throw new Error('资产输出必须包含 assets 数组');
  if(json.assets.length>100)throw new Error('单集提取超过100个资产，请减少无关资产');
  const out=[];
  for(const item of json.assets){
    if(!KINDS.includes(item.kind)||!String(item.name||'').trim()||!String(item.description||'').trim())throw new Error('模型返回的资产缺少分类、名称或描述');
    const name=item.name.trim();
    const aliases=[...new Set((Array.isArray(item.aliases)?item.aliases:[]).filter(a=>typeof a==='string'&&a.trim()).map(a=>a.trim()))].filter(a=>normalizeName(a)!==normalizeName(name)).slice(0,20);
    out.push({id:uid('candidate'),scriptId,kind:item.kind,name,aliases,description:item.description.trim().slice(0,1800),identityHint:String(item.identityHint||'').trim().slice(0,500),bindTo:''});
  }
  return out;
}
export async function extractScriptAssets(script,model,{fetchFn=fetch,signal}={}){
  if(!model?.providerId||!model.modelId)throw new Error('请设置有效的文本模型');
  if(!script?.id||!script.text?.trim())throw new Error('剧本正文为空');
  const response=await fetchFn('/api/ai/generate',{method:'POST',signal,
    headers:{'Content-Type':'application/json','x-toonflow-workspace':'1'},
    body:JSON.stringify({providerId:model.providerId,modelId:model.modelId,context:{systemPrompt:ASSET_EXTRACTION_PROMPT,
      messages:[{role:'user',timestamp:Date.now(),content:`剧本：第${script.episode}集 ${script.title}\n【正文】\n${script.text}\n【结束】`}]}})});
  return parseAssetExtraction(await readEventModelStream(response,signal),script.id);
}
export function normalizeAsset(asset){
  const images=Array.isArray(asset.images)?asset.images.slice():[];
  if(asset.imagePath && !images.some(i=>i.path===asset.imagePath))images.unshift({id:uid('image'),path:asset.imagePath,mimeType:asset.mimeType||'image/png',createdAt:''});
  const audio=Array.isArray(asset.audios)?asset.audios.slice():[];
  const defaultImageId=images.some(i=>i.id===asset.defaultImageId)?asset.defaultImageId:(images.find(i=>i.path===asset.imagePath)?.id||images[0]?.id||'');
  return {...asset,derivatives:normalizeDerivatives(asset.derivatives),imagePrompt:typeof asset.imagePrompt==='string'?asset.imagePrompt:'',audioPrompt:typeof asset.audioPrompt==='string'?asset.audioPrompt:'',aliases:Array.isArray(asset.aliases)?[...new Set(asset.aliases)]:[],scriptIds:[...new Set(asset.scriptIds||[])],images,audios:audio,defaultImageId,
    imagePath:images.find(i=>i.id===defaultImageId)?.path||'',mimeType:images.find(i=>i.id===defaultImageId)?.mimeType||''};
}
export function suggestions(candidate,assets){
  // 只按完全相同的正式名称候选匹配，别名不自动合并：别名可以属于不同人物。
  if(candidate.kind==='角色' && /^(?:大师兄|二师兄|小师妹|师兄|师姐|师弟|师妹|师父|掌门|长老|宗主|少主|公子|小姐|哥哥|姐姐|大哥|二哥|弟弟|陛下|殿下|师尊)$/u.test(String(candidate.name).trim()))return [];
  return assets.filter(a=>a.kind===candidate.kind&&normalizeName(a.name)===normalizeName(candidate.name)).map(a=>a.id);
}
export function normalizeAssetLibrary(studio){
  studio.assets=(studio.assets||[]).map(normalizeAsset);
  studio.assetMentions ||= [];
  studio.assetExtractionDrafts ||= [];
  return studio;
}
export function assetsForScript(studio,id){
  const mentions=(studio.assetMentions||[]).filter(x=>x.scriptId===id);
  const matched=new Set(mentions.map(x=>x.assetId));
  for(const asset of studio.assets||[])if(asset.scriptIds?.includes(id))matched.add(asset.id);
  return (studio.assets||[]).filter(a=>matched.has(a.id));
}
export function commitAssetCandidates(studio,candidates){
  normalizeAssetLibrary(studio);
  const taken=[];
  const validScriptIds=new Set((studio.scripts||[]).map(x=>x.id));
  for(const candidate of candidates){
    if(!validScriptIds.has(candidate.scriptId))throw new Error('提取源剧本已删除：'+candidate.scriptId);
    if(!KINDS.includes(candidate.kind)||!candidate.name?.trim())throw new Error('资产名称或分类无效');
    let target;
    if(candidate.bindTo && candidate.bindTo!=='__new__'){
      target=studio.assets.find(a=>a.id===candidate.bindTo);
      if(!target)throw new Error('绑定目标资产已删除：'+candidate.name);
      if(target.kind!==candidate.kind)throw new Error('禁止将'+candidate.kind+'绑定到'+target.kind);
    }else if(candidate.bindTo!=='__new__'){
      const exact=suggestions(candidate,studio.assets);
      // 多个正式同名资产时禁止猜测。
      if(exact.length===1)target=studio.assets.find(a=>a.id===exact[0]);
      else if(exact.length>1)throw new Error('发现多个同名身份，请为'+candidate.name+'明确选择绑定目标');
    }
    if(!target){
      target=normalizeAsset({id:uid('asset'),kind:candidate.kind,name:candidate.name,description:candidate.description,
        identityHint:candidate.identityHint||'',imagePrompt:'',audioPrompt:'',aliases:[],scriptIds:[],imagePath:'',status:'待生成提示词'});
      studio.assets.push(target);
    }
    if(!target.scriptIds.includes(candidate.scriptId))target.scriptIds.push(candidate.scriptId);
    // 只在名称不冲突时加入别名（不把别名当成全局唯一身份）。
    target.aliases=[...new Set([...target.aliases,...(candidate.aliases||[]),
      ...(normalizeName(candidate.name)!==normalizeName(target.name)?[candidate.name]:[])])];
    const existing=studio.assetMentions.find(m=>m.scriptId===candidate.scriptId&&m.assetId===target.id&&normalizeName(m.mentionedAs)===normalizeName(candidate.name));
    if(existing){existing.description=candidate.description;existing.identityHint=candidate.identityHint||'';}
    else studio.assetMentions.push({id:uid('mention'),assetId:target.id,scriptId:candidate.scriptId,mentionedAs:candidate.name,
      aliases:[...(candidate.aliases||[])],description:candidate.description,identityHint:candidate.identityHint||''});
    taken.push(target.id);
  }
  return [...new Set(taken)];
}
export function bindAssetIdentity(studio,sourceId,targetId){
  normalizeAssetLibrary(studio);
  if(sourceId===targetId)throw new Error('不能绑定到自身');
  const source=studio.assets.find(a=>a.id===sourceId),target=studio.assets.find(a=>a.id===targetId);
  if(!source||!target||source.kind!==target.kind)throw new Error('只能绑定同类别的两个现有资产');
  target.aliases=[...new Set([...target.aliases,source.name,...source.aliases])];
  target.scriptIds=[...new Set([...target.scriptIds,...source.scriptIds])];
  const paths=new Set(target.images.map(i=>i.path));
  for(const item of source.images)if(!paths.has(item.path)){target.images.push(item);paths.add(item.path);}
  target.audios.push(...source.audios.filter(item=>!target.audios.some(x=>x.path===item.path)));
  target.derivatives ||= [];
  target.derivatives.push(...(source.derivatives||[]).filter(item=>!target.derivatives.some(x=>x.id===item.id)));
  for(const mention of studio.assetMentions||[])if(mention.assetId===sourceId)mention.assetId=targetId;
  for(const panel of studio.panels||[])panel.assetIds=[...new Set((panel.assetIds||[]).map(id=>id===sourceId?targetId:id))];
  studio.assets=studio.assets.filter(a=>a.id!==sourceId);
  return target;
}
// 只移除资产索引及所有分镜引用，不触碰已落盘的图片、音频或画布节点。
// 单个与批量删除共用这一条数据链路，防止批量删除遗漏嵌套镜头和图片版本绑定。
export function removeAssetsFromStudio(studio, assetIds) {
  if (!studio || !Array.isArray(studio.assets)) throw new Error('资产库未初始化');
  if (!Array.isArray(assetIds) || !assetIds.length) throw new Error('请选择需要删除的资产');
  const ids = new Set(assetIds.filter(id => typeof id === 'string' && id));
  if (!ids.size) throw new Error('没有有效的资产 ID');
  const found = studio.assets.filter(asset => ids.has(asset.id));
  if (found.length !== ids.size) throw new Error('有选中的资产已不存在，请刷新后重试');

  studio.assets = studio.assets.filter(asset => !ids.has(asset.id));
  if (Array.isArray(studio.assetMentions))
    studio.assetMentions = studio.assetMentions.filter(mention => !ids.has(mention.assetId));

  const withoutRemoved = values => values.filter(value =>
    !ids.has(typeof value === 'string' ? value : value?.id));

  function prune(item) {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item.assetIds)) item.assetIds = withoutRemoved(item.assetIds);
    if (Array.isArray(item.assets)) item.assets = withoutRemoved(item.assets);
    if (item.assetVersions && typeof item.assetVersions === 'object' && !Array.isArray(item.assetVersions))
      for (const id of ids) delete item.assetVersions[id];
    if (typeof item.assetId === 'string' && ids.has(item.assetId)) delete item.assetId;
    if (Array.isArray(item.shots)) for (const shot of item.shots) prune(shot);
  }

  for (const field of ['panels', 'storyboards', 'storyboardBoards']) {
    if (Array.isArray(studio[field])) for (const item of studio[field]) prune(item);
  }
  // 仍在审核的候选记录要保留；只清空指向已删除身份的人工绑定。
  if (Array.isArray(studio.assetExtractionDrafts))
    for (const draft of studio.assetExtractionDrafts)
      if (ids.has(draft.bindTo)) draft.bindTo = '';

  return { count: found.length, removed: found.map(asset => ({
    id: asset.id, name: asset.name, kind: asset.kind
  })) };
}

export function setDefaultImage(asset,id){
  const found=(asset.images||[]).find(i=>i.id===id);
  if(!found)throw new Error('指定图片不存在');
  asset.defaultImageId=found.id;asset.imagePath=found.path;asset.mimeType=found.mimeType;
}
export function removeAssetImage(asset,id){
  const selected=(asset.images||[]).find(i=>i.id===id);
  if(!selected)throw new Error('图片不存在');
  asset.images=asset.images.filter(i=>i.id!==id);
  if(asset.defaultImageId===id){
    asset.defaultImageId=asset.images[0]?.id||'';
    asset.imagePath=asset.images[0]?.path||'';
    asset.mimeType=asset.images[0]?.mimeType||'';
  }
  return selected;
}
