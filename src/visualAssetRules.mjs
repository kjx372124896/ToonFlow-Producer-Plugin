// 从已保存到项目里的 ToonFlow 1.1.8 原版 Markdown 手册中按章节提取。
// 项目运行时读取 project.visualManual，编辑/切换手册立即影响下一次生成，无须重新选择。
const sectionTitles = ['总说明','art_character_derivative','art_character','art_prop_derivative','art_prop','art_scene_derivative','art_scene','art_storyboard_video','director_planning_style','director_storyboard_table_style','director_storyboard','prefix'];
const kindSection = {'角色':'art_character','场景':'art_scene','道具':'art_prop'};
const derivativeSection = {'角色':'art_character_derivative','场景':'art_scene_derivative','道具':'art_prop_derivative'};
const titles = new Set(sectionTitles);

export function parseVisualSections(markdown) {
  const text=String(markdown||'').replace(/\r\n?/g,'\n').trim();
  if(!text)return {sections:{},unstructured:''};
  const re=/^## ([^\n]+)\n/gm;
  const matches=[...text.matchAll(re)].filter(m=>titles.has(m[1].trim()));
  if(!matches.length)return {sections:{},unstructured:text};
  const sections={};
  for(let i=0;i<matches.length;i++){
    const m=matches[i];
    const end=matches[i+1]?.index ?? text.length;
    const body=text.slice(m.index+m[0].length,end).trim();
    if(body)sections[m[1].trim()]=body;
  }
  return {sections,unstructured:''};
}
export function visualManualParts(project,kind,{derivative=false}={}){
  if(kind==='音频')return [];
  const {sections,unstructured}=parseVisualSections(project?.visualManual);
  if(unstructured)return [{section:'自定义视觉手册',content:unstructured}];
  const keys=['prefix','总说明',kindSection[kind]];
  if(derivative)keys.push(derivativeSection[kind]);
  const result=[];
  for(const key of keys){
    if(key && sections[key])result.push({section:key,content:sections[key]});
  }
  return result;
}
export function visualManualContext(project,kind,opts={}){
  const parts=visualManualParts(project,kind,opts);
  return parts.map(part=>'【视觉手册章节：'+part.section+'】\n'+part.content).join('\n\n');
}
export function composeAssetImagePrompt(asset,project,{derivative=null}={}){
  if(asset?.kind==='音频')throw new Error('音频资产不能使用视觉提示词');
  const base=(derivative?.prompt||asset?.imagePrompt||asset?.description||'').trim();
  if(!base)throw new Error('请先填写或生成资产图片提示词');
  const mode=asset.kind==='角色'?'角色身份和面容一致性':asset.kind==='场景'?'纯场景、无人无人物':'单独道具、不要人物与额外背景';
  const manual=visualManualContext(project,asset.kind,{derivative:!!derivative});
  if(!manual&&!derivative){
    // 没有设置手册时继续兼容旧逻辑：已有完整提示词原样使用，仅描述时附加类型约束。
    if(asset?.imagePrompt?.trim())return base;
    return asset.kind==='场景'?'纯场景，无人无角色。'+base:asset.kind==='道具'?'单独道具，干净纯色背景。'+base:'角色定妆，人物身份与外观一致性。'+base;
  }
  const controls=derivative
    ?'这是基于父资产参考图片的衍生图。必须以参考图为唯一身份/空间/物件基底；只调整以下要求，其他身份、五官、身形、结构和风格保持一致：'+(derivative.instruction||derivative.type||'')
    :'图片必须符合'+mode+'。';
  return [controls,manual&&'以下为项目已经选定、必须遵守的视觉手册，不要把它当作图片内容中的文字：\n'+manual,'【本次生成目标】\n'+base].filter(Boolean).join('\n\n');
}
