import test from 'node:test';
import assert from 'node:assert/strict';
import {builtinList,manualText} from '../src/manuals.mjs';
import {parseVisualSections,visualManualParts,visualManualContext,composeAssetImagePrompt} from '../src/visualAssetRules.mjs';
import {generateAssetPrompt} from '../src/assetBatch.mjs';
import {generateAssetImage} from '../src/assetMedia.mjs';
import {normalizeAsset,bindAssetIdentity} from '../src/assetEngine.mjs';
import {DERIVATIVE_TYPES,addAssetDerivative,addDerivativeImage} from '../src/assetDerivatives.mjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

function event(text){
  const content='data: '+JSON.stringify({type:'done',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text}]}})+'\n\n';
  return {ok:true,headers:{get:()=> 'text/event-stream'},body:new ReadableStream({
    start(controller){controller.enqueue(new TextEncoder().encode(content));controller.close();}
  })};
}
const manuals=builtinList('visual');
const project=(m)=>({id:'visual-proj',visualManual:manualText(m),generation:{image:{mode:'model',model:JSON.stringify(['p','image'])}}});
const kinds=[['角色','art_character','art_character_derivative'],['场景','art_scene','art_scene_derivative'],['道具','art_prop','art_prop_derivative']];

test('11套旧版视觉手册均按类别引用完整全局美学、基础资产和衍生章节',()=>{
  assert.equal(manuals.length,11);
  for(const manual of manuals){
    const p=project(manual);
    const parsed=parseVisualSections(p.visualManual).sections;
    for(const [kind,base,derived] of kinds){
      const normal=visualManualParts(p,kind);
      const special=visualManualParts(p,kind,{derivative:true});
      assert.deepEqual(normal.map(x=>x.section),['prefix','总说明',base]);
      assert.deepEqual(special.map(x=>x.section),['prefix','总说明',base,derived]);
      assert.equal(normal[2].content,parsed[base]);
      assert.equal(special[3].content,parsed[derived]);
      const text=visualManualContext(p,kind);
      assert.ok(text.includes(parsed.prefix),manual.slug);
      assert.ok(!text.includes(parsed[derived]),'普通生图不能意外引入衍生规则');
      for(const [,other] of kinds)if(other!==base)assert.ok(!text.includes('【视觉手册章节：'+other+'】'));
    }
    assert.deepEqual(visualManualParts(p,'音频'),[]);
  }
});

test('文本提示词生成实际发送所选手册的全局和人物基础规范，衍生改用衍生章节',async()=>{
  const p=project(manuals.find(m=>m.slug==='realpeople_modern_city')||manuals[0]);
  const asset={id:'actor',kind:'角色',name:'苏荷',description:'女性，短发，身形高挑，浅色上衣',imagePrompt:'基础形象正面照'};
  const calls=[];
  for(const derivative of [null,{id:'v1',type:'换装',instruction:'更换为职业西装',baseImageId:'img0',prompt:''}]){
    const output=await generateAssetPrompt(asset,{providerId:'p',modelId:'text'},{
      project:p,derivative,fetchFn:async(_url,opts)=>{
        const req=JSON.parse(opts.body);
        calls.push(req.context);
        return event('电影感的苏荷，浅色上衣，纯白背景');
      }
    });
    assert.ok(output.includes('苏荷'));
  }
  assert.ok(calls[0].systemPrompt.includes('【视觉手册章节：prefix】'));
  assert.ok(calls[0].systemPrompt.includes('【视觉手册章节：art_character】'));
  assert.ok(!calls[0].systemPrompt.includes('【视觉手册章节：art_character_derivative】'));
  assert.ok(calls[1].systemPrompt.includes('【视觉手册章节：art_character_derivative】'));
  assert.ok(calls[1].messages[0].content.includes('更换为职业西装'));
});

test('基础生图及衍生生图的实际接口均带手册，衍生图还传入真实参考图片',async()=>{
  const p=project(manuals[0]);
  const actor={id:'a',kind:'角色',name:'角色1',description:'青年男子',imagePrompt:'清晰的角色基础形象',
    defaultImageId:'img0',images:[{id:'img0',path:'assets/base.png',mimeType:'image/png'}],derivatives:[]};
  const variant=addAssetDerivative(actor,{type:'换装',instruction:'黑色西装',baseImageId:'img0'});
  variant.prompt='同一角色面容，黑色西装，保持五官不变';
  const calls=[];
  const fetchFn=async(_url,opts)=>{
    const body=JSON.parse(opts.body);calls.push(body);
    return {ok:true,async json(){return {code:200,data:[{mediaType:'image',path:'assets/out-'+calls.length+'.png',mimeType:'image/png'}]}}};
  };
  const files={async list(){return {directory:'D:/work'}}};
  await generateAssetImage(actor,p,files,{fetchFn});
  const results=await generateAssetImage(actor,p,files,{fetchFn,derivative:variant});
  assert.ok(calls[0].prompt.includes('【视觉手册章节：art_character】'));
  assert.equal(calls[0].images,undefined);
  assert.ok(calls[1].prompt.includes('【视觉手册章节：art_character_derivative】'));
  assert.deepEqual(calls[1].images,[{path:'assets/base.png',mimeType:'image/png'}]);
  assert.ok(calls[1].outputDirectory.includes('/derivatives/'+variant.id));
  const image=addDerivativeImage(variant,results[0]);actor.images.push({...image,derivativeId:variant.id});
  assert.equal(actor.defaultImageId,'img0','换装后父资产默认脸不能被替换');
  assert.equal(variant.images[0].path,results[0].path);
  assert.equal(actor.images[1].derivativeId,variant.id);
  assert.ok(Object.keys(DERIVATIVE_TYPES).includes('场景'));
  assert.ok(Object.keys(DERIVATIVE_TYPES).includes('道具'));
  await assert.rejects(generateAssetImage(actor,p,files,{fetchFn,derivative:{...variant,baseImageId:'missing'}}),/参考图片/);
});

test('衍生资产数据可跨保存/旧数据归一化与同身份合并复用',()=>{
  const a=normalizeAsset({id:'a',kind:'角色',images:[{id:'img0',path:'base.png'}],defaultImageId:'img0',derivatives:[]});
  const d=addAssetDerivative(a,{type:'换装',instruction:'职业装'});
  d.prompt='明确服装';
  d.images.push({id:'d0',path:'suit.png',mimeType:'image/png'});
  const restored=normalizeAsset(JSON.parse(JSON.stringify(a)));
  assert.equal(restored.derivatives[0].images[0].path,'suit.png');
  assert.equal(normalizeAsset({id:'legacy',kind:'角色'}).derivatives.length,0);
  const project={assets:[restored,normalizeAsset({id:'b',kind:'角色',images:[]})],assetMentions:[],panels:[]};
  bindAssetIdentity(project,'a','b');
  assert.equal(project.assets.length,1);
  assert.equal(project.assets[0].derivatives[0].id,d.id);
});

test('资产库支持单个基础提示词、衍生方案、换装提示词和参考图生成，批量仍引用项目手册',()=>{
  const source=readFileSync(fileURLToPath(new URL('../src/AssetLibrary.vue',import.meta.url)),'utf8');
  assert.match(source,/@click="generateSinglePrompt"/);
  assert.match(source,/@click="createDerivative"/);
  assert.match(source,/@click="generateDerivativePrompt\(variant\)"/);
  assert.match(source,/@click="generateDerivativeImage\(variant\)"/);
  assert.match(source,/generateAssetPrompt\(asset,model,\{signal:controller.signal,project:scope.project\}\)/);
  assert.match(source,/composeAssetImagePrompt\(asset,scope.project\)/);
  assert.match(source,/generateAssetImage\(asset,scope.project,props.context.files,\{/);
  assert.match(source,/derivative:variant,signal:mediaController.signal/);
});
