import {uid} from './studio.mjs';
export const DERIVATIVE_TYPES={
  '角色':['换装','妆容变化','发型变化','配饰变化'],
  '场景':['日夜变化','天气变化','布置变化','氛围变化'],
  '道具':['材质变化','配色变化','状态变化','细节变化']
};
export function normalizeDerivatives(value){
  if(!Array.isArray(value))return [];
  return value.filter(v=>v&&typeof v==='object'&&v.id).map(v=>{
    const images=Array.isArray(v.images)?v.images.filter(i=>i?.path).slice():[];
    const defaultImageId=images.some(i=>i.id===v.defaultImageId)?v.defaultImageId:(images[0]?.id||'');
    return {...v,type:String(v.type||''),instruction:String(v.instruction||''),prompt:String(v.prompt||''),
      images,defaultImageId,baseImageId:String(v.baseImageId||'')};
  });
}
export function addAssetDerivative(asset,{type,instruction,baseImageId}={}){
  if(!asset?.id||!DERIVATIVE_TYPES[asset.kind])throw new Error('只有角色、场景、道具支持视觉衍生资产');
  // 自由输入变化要求，不再限制衍生资产类型；保留旧类型字段兼容已有项目。
  const label=String(type||instruction||'自定义修改').trim().slice(0,32);
  if(!label)throw new Error('请输入衍生资产修改要求');
  if(!String(instruction||'').trim())throw new Error('请填写衍生资产的具体变化要求');
  const source=baseImageId||asset.defaultImageId||'';
  if(source && !asset.images?.some(i=>i.id===source))throw new Error('选择的基础参考图已不存在');
  const derivative={id:uid('derivative'),type:label,instruction:String(instruction).trim(),baseImageId:source,
    prompt:'',images:[],defaultImageId:'',createdAt:new Date().toISOString()};
  asset.derivatives ||= [];
  asset.derivatives.push(derivative);
  return derivative;
}
export function addDerivativeImage(derivative,media){
  if(!media?.path||!/^image\//.test(media.mimeType||''))throw new Error('衍生图片结果无效');
  const image={id:uid('image'),...media,createdAt:new Date().toISOString()};
  derivative.images ||= [];
  derivative.images.push(image);
  if(!derivative.defaultImageId)derivative.defaultImageId=image.id;
  return image;
}
