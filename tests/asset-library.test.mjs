import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,emptyStudio,buildPanels} from '../src/studio.mjs';
import {makeScriptsZip} from '../src/scriptZip.mjs';
import {parseAssetExtraction,extractScriptAssets,normalizeAssetLibrary,normalizeAsset,
  commitAssetCandidates,bindAssetIdentity,assetsForScript,suggestions,
  setDefaultImage,removeAssetImage} from '../src/assetEngine.mjs';
import {generateAssetImage,generateAssetRh} from '../src/assetMedia.mjs';

const sample={assets:[{kind:'角色',name:'苏荷',aliases:['大师兄'],identityHint:'青云宗大师兄',description:'文中明确提及的青年男性服装特征'},
  {kind:'场景',name:'宗门大殿',description:'空旷的古式宗门大殿，无人物'},
  {kind:'道具',name:'青铜令牌',description:'古青铜材质的扁平令牌'}]};
const script1={id:'s1',episode:1,title:'第一集',text:'1-1 山门 日 外\n△ 苏荷出现。\n大师兄：该出发了。',scenes:[{location:'山门',body:'△ 苏荷出现。\n大师兄：该出发了。'}]};
const script2={id:'s2',episode:2,title:'第二集',text:'2-1 山门 日 外\n△ 苏荷现身。',scenes:[{location:'山门',body:'△ 苏荷现身。'}]};
const script10={id:'s10',episode:10,title:'第十集',text:'10-1 宗门乙 夜 内\n△ 张三被称为大师兄。',scenes:[{location:'宗门乙',body:'△ 大师兄登场。'}]};
function base(){const s=emptyStudio();s.project=createProject({name:'资产统一测试'});s.scripts=[script1,script2,script10];return s;}
function event(raw){const data=new TextEncoder().encode('data: '+JSON.stringify({type:'done',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:raw}]}})+'\n\n');
  return {ok:true,headers:{get:()=>"text/event-stream"},body:new ReadableStream({start(c){c.enqueue(data);c.close();}})};}

test('选中多集导出的ZIP结构正确，UTF8中文文件名和逐集TXT正文完好',()=>{
  const zip=makeScriptsZip([script1,script2,script10]);
  const dv=new DataView(zip.buffer,zip.byteOffset,zip.byteLength);
  let offset=0;
  for(const s of [script1,script2,script10]){
    assert.equal(dv.getUint32(offset,true),0x04034b50);
    assert.equal(dv.getUint16(offset+6,true),0x0800);
    const size=dv.getUint32(offset+18,true),nameLen=dv.getUint16(offset+26,true);
    const name=new TextDecoder().decode(zip.slice(offset+30,offset+30+nameLen));
    assert.ok(name.includes('第'+String(s.episode).padStart(3,'0')+'集'));
    const actual=new TextDecoder().decode(zip.slice(offset+30+nameLen,offset+30+nameLen+size));
    assert.equal(actual,s.text);
    offset+=30+nameLen+size;
  }
  const centralOffset=offset;
  assert.equal(dv.getUint32(centralOffset,true),0x02014b50);
  const footer=zip.length-22;
  assert.equal(dv.getUint32(footer,true),0x06054b50);
  assert.equal(dv.getUint16(footer+10,true),3);
  assert.equal(dv.getUint32(footer+16,true),centralOffset);
  assert.throws(()=>makeScriptsZip([]),/选择/);
});

test('模型提取只接受合法的三类JSON资产，返回多集候选及身份线索',async()=>{
  const result=await extractScriptAssets(script1,{providerId:'t',modelId:'m'},{fetchFn:async(url,init)=>{
    assert.equal(url,'/api/ai/generate');assert.ok(JSON.parse(init.body).context.systemPrompt.includes('不同宗门'));
    assert.ok(JSON.parse(init.body).context.messages[0].content.includes(script1.text));
    return event(JSON.stringify(sample));
  }});
  assert.equal(result.length,3);assert.equal(result[0].scriptId,'s1');
  assert.equal(result[0].aliases[0],'大师兄');
  assert.equal(result[1].kind,'场景');
  assert.throws(()=>parseAssetExtraction('not JSON','s1'),/JSON/);
  assert.throws(()=>parseAssetExtraction('{"assets":[{"kind":"猫","name":"小花"}]}','s1'),/缺少/);
});

test('新版仅提取结构化资产描述：不会写入提示词，也不会调用额外生成接口',async()=>{
  const calls=[];
  const response={assets:[
    {kind:'角色',name:'苏荷',aliases:['大师兄'],identityHint:'青云宗大弟子',
      description:'男性，剧本交代他是青云宗大弟子，多次被称为大师兄，人物外貌、发型、服饰和身材在本集尚未明确描述。',prompt:'untrusted prompt',imagePrompt:'untrusted image prompt'},
    {kind:'场景',name:'宗门大殿',aliases:[],identityHint:'',
      description:'宗门内用于商议事务的大殿，原文提及此地点，但未具体说明房梁结构、地面材质、陈设颜色或建筑风格。'},
    {kind:'道具',name:'令牌',aliases:[],identityHint:'',
      description:'人物使用的重要凭证物件，剧情提到了令牌及其功能，但没有交代令牌的具体尺寸、材质、图案或颜色。'},
    {kind:'音频',name:'钟声',aliases:[],identityHint:'',
      description:'场景中的关键钟声，有明确的声音来源及剧情用途，具体节奏、响度和时长未在本集文本中给出。'}
  ]};
  const result=await extractScriptAssets(script1,{providerId:'p',modelId:'m'},{
    fetchFn:async(url,opts)=>{
      calls.push(url);
      const payload=JSON.parse(opts.body);
      assert.equal(payload.context.systemPrompt.includes('resultTool'),true,'明确解释当前不是旧工具调用模式');
      assert.match(payload.context.systemPrompt,/不做图片、音频或视频提示词生成/);
      assert.match(payload.context.systemPrompt,/30–80/);
      assert.match(payload.context.systemPrompt,/具名角色/);
      assert.ok(payload.context.systemPrompt.includes('同一地点的日/夜'));
      return event(JSON.stringify(response));
    }
  });
  assert.deepEqual(calls,['/api/ai/generate']);
  assert.equal(result.length,4);
  assert.ok(result.every(item=>item.description && !('prompt' in item) && !('imagePrompt' in item) && !('audioPrompt' in item)));
  assert.deepEqual(result.find(x=>x.kind==='角色').aliases,['大师兄']);
  const studio=base();
  commitAssetCandidates(studio,result);
  assert.equal(studio.assets.length,4);
  assert.ok(studio.assets.every(a=>a.imagePrompt==='' && a.audioPrompt==='' && !('prompt' in a)));
  assert.equal(studio.assets.find(a=>a.name==='苏荷').description,response.assets[0].description);
});

test('跨集再次提取同一资产，保留此前在资产库单独生成的提示词、媒体和身份索引',()=>{
  const studio=base();
  const one=commitAssetCandidates(studio,parseAssetExtraction(JSON.stringify({assets:[
    {kind:'角色',name:'苏荷',aliases:['大师兄'],identityHint:'青云宗',description:'男性，青云宗弟子。'}
  ]}),'s1'))[0];
  const target=studio.assets.find(x=>x.id===one);
  target.imagePrompt='独立生成的最终定妆提示词';
  target.images.push({id:'image-1',path:'assets/1.png',mimeType:'image/png'});
  commitAssetCandidates(studio,parseAssetExtraction(JSON.stringify({assets:[
    {kind:'角色',name:'苏荷',aliases:['苏师兄'],identityHint:'青云宗',description:'男性，师兄登场，但服装等细节未作交代。',prompt:'do not import'}
  ]}),'s2'));
  assert.equal(studio.assets.length,1);
  assert.equal(studio.assets[0].imagePrompt,'独立生成的最终定妆提示词');
  assert.equal(studio.assets[0].images.length,1);
  assert.ok(studio.assets[0].aliases.includes('苏师兄'));
  assert.deepEqual(new Set(studio.assets[0].scriptIds),new Set(['s1','s2']));
});

test('跨集苏荷去重为一个真实角色，场景和道具分门别类，按集显示引用',()=>{
  const s=base();
  const a=parseAssetExtraction(JSON.stringify(sample),'s1');
  const b=parseAssetExtraction(JSON.stringify({assets:[{kind:'角色',name:'苏荷',description:'第二集苏荷继续身穿原服装'}]}),'s2');
  commitAssetCandidates(s,[...a,...b]);
  assert.equal(s.assets.filter(x=>x.name==='苏荷').length,1);
  const su=s.assets.find(x=>x.name==='苏荷');
  assert.deepEqual(new Set(su.scriptIds),new Set(['s1','s2']));
  assert.equal(s.assetMentions.filter(x=>x.assetId===su.id).length,2);
  assert.equal(assetsForScript(s,'s1').length,3);
  assert.deepEqual(assetsForScript(s,'s2').map(x=>x.name),['苏荷']);
  assert.equal(assetsForScript(s,'s10').length,0);
  assert.equal(s.assets.filter(x=>x.kind==='场景').length,1);
  assert.equal(s.assets.filter(x=>x.kind==='道具').length,1);
});

test('跨宗门两个“大师兄”不能自动混为同一角色，可以按来源集手动绑定到苏荷或张三',()=>{
  const s=base();
  commitAssetCandidates(s,[{...parseAssetExtraction(JSON.stringify(sample),'s1')[0],bindTo:'__new__'}]);
  const su=s.assets[0];
  assert.deepEqual(suggestions({kind:'角色',name:'大师兄'},s.assets),[]);
  const zhang={...parseAssetExtraction(JSON.stringify({assets:[{kind:'角色',name:'张三',description:'乙宗门弟子',identityHint:'宗门乙大师兄'}]}),'s10')[0]};
  commitAssetCandidates(s,[zhang]);
  const zs=s.assets.find(x=>x.name==='张三');
  const master1={...parseAssetExtraction(JSON.stringify({assets:[{kind:'角色',name:'大师兄',description:'青云宗的大师兄苏荷'}]}),'s1')[0],bindTo:su.id};
  const master2={...parseAssetExtraction(JSON.stringify({assets:[{kind:'角色',name:'大师兄',description:'宗门乙的大师兄张三'}]}),'s10')[0],bindTo:zs.id};
  commitAssetCandidates(s,[master1,master2]);
  assert.equal(s.assets.length,2);
  assert.ok(s.assets.every(a=>a.aliases.includes('大师兄')));
  assert.equal(assetsForScript(s,'s10')[0].id,zs.id);
  const panel=buildPanels([script10],s.assets,[],s.assetMentions);
  assert.ok(panel.some(p=>p.assetIds.includes(zs.id)));
  assert.ok(panel.every(p=>!p.assetIds.includes(su.id)), '不同宗门同称呼按剧本出处分开');
});

test('不同宗门同叫“大师兄”的正式资产不会在另一集分镜同时挂载',()=>{
  const first=normalizeAsset({id:'mA',kind:'角色',name:'大师兄',scriptIds:['s1']});
  const second=normalizeAsset({id:'mB',kind:'角色',name:'大师兄',scriptIds:['s10']});
  const panels=buildPanels([script10],[first,second]);
  assert.ok(panels.length>0);
  assert.ok(panels.every(p=>p.assetIds.includes('mB')&&!p.assetIds.includes('mA')));
});

test('两个现有重复身份合并时保留图片音频和别名，分镜旧ID重新指向同一资产',()=>{
  const s=base();
  const a=normalizeAsset({id:'A',kind:'角色',name:'苏荷',images:[{id:'img1',path:'a.png',mimeType:'image/png'}],scriptIds:['s1'],aliases:[]});
  const b=normalizeAsset({id:'B',kind:'角色',name:'大师兄',images:[{id:'img2',path:'b.png',mimeType:'image/png'}],scriptIds:['s10'],aliases:['师兄'],audios:[{id:'voice',path:'voice.mp3'}]});
  s.assets=[a,b];s.assetMentions=[{id:'m1',assetId:'B',scriptId:'s10',mentionedAs:'大师兄',aliases:[]}];
  s.panels=[{id:'p',scriptId:'s10',assetIds:['B']}];
  bindAssetIdentity(s,'B','A');
  assert.equal(s.assets.length,1);assert.deepEqual(new Set(s.assets[0].images.map(i=>i.path)),new Set(['a.png','b.png']));
  assert.ok(s.assets[0].aliases.includes('大师兄'));assert.deepEqual(new Set(s.assets[0].scriptIds),new Set(['s1','s10']));
  assert.equal(s.panels[0].assetIds[0],'A');assert.equal(s.assetMentions[0].assetId,'A');
  assert.equal(s.assets[0].audios.length,1);
});

test('图片版本的默认图/删除图/旧项目默认 imagePath 迁移都保留实际可用路径',()=>{
  const a=normalizeAsset({id:'one',kind:'角色',name:'苏荷',imagePath:'original.png',mimeType:'image/png'});
  assert.equal(a.images.length,1);assert.equal(a.imagePath,'original.png');
  a.images.push({id:'2',path:'new.webp',mimeType:'image/webp'});
  setDefaultImage(a,'2');assert.equal(a.imagePath,'new.webp');assert.equal(a.mimeType,'image/webp');
  removeAssetImage(a,'2');assert.equal(a.imagePath,'original.png');
  assert.throws(()=>setDefaultImage(a,'not-found'),/不存在/);
  assert.throws(()=>removeAssetImage(a,'not-found'),/不存在/);
});

test('原生模型生成图片真实调用 /api/ai/media/generate 并返回落盘路径；音频不伪造模型接口',async()=>{
  const s=base();s.project.generation={image:{mode:'model',model:JSON.stringify(['img','model'])}};
  const files={async list(){return {directory:'D:/workspace'}}};
  const output=await generateAssetImage({id:'asset1',kind:'场景',description:'明亮的庭院'},s.project,files,{fetchFn:async(url,init)=>{
    assert.equal(url,'/api/ai/media/generate');const args=JSON.parse(init.body);
    assert.equal(args.mediaType,'image');assert.equal(args.providerId,'img');assert.ok(args.prompt.includes('无人'));
    return {ok:true,async json(){return {code:200,data:[{path:'assets/scene.png',mimeType:'image/png',mediaType:'image'}]}}};
  }});
  assert.equal(output[0].path,'assets/scene.png');
  await assert.rejects(generateAssetImage({id:'x',description:''},s.project,files),/描述/);
});

test('RH 音频/图片使用画布上下文应用 UID 和真实提示词，输出路径回写，拒绝缺少提示词能力',async()=>{
  const log=[];
  const ctx={
    canvasProvider:()=>({id:'cv1',async call({name,args}){
      log.push({name,args});
      if(name==='getCanvas')return {availableNodeTypes:['remote-runninghubWorkflowNode']};
      if(name==='addNode')return {nodeId:'rh-node'};
      if(name==='nodeTools' && args.name==='node:runRunningHubWorkflow')return {audio:{url:'assets/rh-speech.mp3',mimeType:'audio/mpeg'}};
      return {};
    }}),
    async setRhPrompt(id,prompt){log.push({name:'setRhPrompt',id,prompt});}
  };
  const a={id:'actor1',name:'苏荷',description:'青年人物外形描述'};
  const audio=await generateAssetRh(a,'audio',{id:'project'},ctx,{uid:'rh-speech',prompt:'我是苏荷'});
  assert.equal(audio.path,'assets/rh-speech.mp3');
  assert.ok(log.some(x=>x.name==='setRhPrompt'&&x.prompt==='我是苏荷'));
  assert.equal(a.rhNodes.audio.nodeId,'rh-node');
  await assert.rejects(generateAssetRh(a,'audio',{id:'project'},{canvasProvider:ctx.canvasProvider},{uid:'rh-speech'}),/提示词写入能力/);
});
