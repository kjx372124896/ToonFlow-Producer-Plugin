import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseAssetExtraction,commitAssetCandidates,normalizeAsset} from '../src/assetEngine.mjs';
import {generateAssetPrompt,promptFieldForAsset,assetImageRatio,validateImageAsset} from '../src/assetBatch.mjs';
import {generateAssetImage} from '../src/assetMedia.mjs';

function event(raw) {
  const body=new TextEncoder().encode('data: '+JSON.stringify({type:'done',message:{
    role:'assistant',stopReason:'stop',content:[{type:'text',text:raw}]
  }})+'\n\n');
  return {ok:true,headers:{get:()=> 'text/event-stream'},body:new ReadableStream({
    start(controller){controller.enqueue(body);controller.close();}
  })};
}

test('音频是独立第四类资产：提取、存储、归一化均保留音频提示词与文件',()=>{
  const candidates=parseAssetExtraction(JSON.stringify({assets:[{
    kind:'音频',name:'雨夜脚步声',description:'雨夜石板地上的脚步，节奏由慢变快',aliases:[]
  }]}),'s1');
  assert.equal(candidates[0].kind,'音频');
  const studio={scripts:[{id:'s1'}],assets:[],panels:[],assetMentions:[]};
  commitAssetCandidates(studio,candidates);
  assert.equal(studio.assets[0].kind,'音频');
  const asset=normalizeAsset({...studio.assets[0],audioPrompt:'清晰的雨滴和脚步',audios:[{id:'a',path:'rain.wav',mimeType:'audio/wav'}]});
  assert.equal(asset.audioPrompt,'清晰的雨滴和脚步');
  assert.equal(asset.audios[0].path,'rain.wav');
  assert.equal(asset.images.length,0);
});

test('按资产类别生成不同的中文提示词并走真实 ToonFlow 文本 SSE 接口',async()=>{
  const classes=['角色','场景','道具','音频'];
  for(const kind of classes){
    const asset={id:'id-'+kind,kind,name:'测试'+kind,description:'对应资产的原始描述'};
    const expected=kind==='音频'?'audioPrompt':'imagePrompt';
    assert.equal(promptFieldForAsset(asset),expected);
    const prompt=await generateAssetPrompt(asset,{providerId:'text',modelId:'model'},{
      fetchFn:async(url,opts)=>{
        assert.equal(url,'/api/ai/generate');
        const req=JSON.parse(opts.body);
        assert.equal(req.providerId,'text');
        assert.ok(req.context.systemPrompt.includes(kind==='场景'?'场景':kind==='音频'?'声源':kind==='道具'?'道具':'人物'),kind);
        assert.ok(req.context.messages[0].content.includes(asset.name));
        return event('中文生成提示词：'+asset.name);
      }
    });
    asset[expected]=prompt;
    assert.ok(asset[expected].includes(asset.name));
    assert.equal(asset.description,'对应资产的原始描述','不覆盖原始描述');
  }
  assert.equal(assetImageRatio({kind:'角色'}),'16:9');
  assert.equal(assetImageRatio({kind:'场景'}),'16:9');
  assert.equal(assetImageRatio({kind:'道具'}),'16:9');
  assert.throws(()=>validateImageAsset({kind:'音频',imagePrompt:'测试'}),/音频/);
  assert.doesNotThrow(()=>validateImageAsset({kind:'角色',imagePrompt:'定妆特写'}));
});

test('批量提示词保存为 imagePrompt，后续实际生图使用提示词而非旧原始描述',async()=>{
  const asset={id:'s',kind:'场景',name:'夜晚空港',description:'旧描述',imagePrompt:'纯空镜，夜晚空港，宽幅蓝调电影镜头'};
  await generateAssetImage(asset,{id:'project1',generation:{image:{mode:'model',model:JSON.stringify(['image','v1'])}}},{
    async list(){return {directory:'D:/workspace'};}
  },{ratio:assetImageRatio(asset),fetchFn:async(_url,opts)=>{
    const req=JSON.parse(opts.body);
    assert.equal(req.prompt,asset.imagePrompt);
    assert.equal(req.ratio,'16:9');
    return {ok:true,async json(){return {code:200,data:[{mediaType:'image',path:'assets/generated.png',mimeType:'image/png'}]};}};
  }});
});

test('资产 UI 有独立勾选/筛选全选/批量生成入口，详情改为居中弹窗',()=>{
  const source=readFileSync(fileURLToPath(new URL('../src/AssetLibrary.vue',import.meta.url)),'utf8');
  assert.match(source,/\['全部','角色','场景','道具','音频'\]/);
  assert.match(source,/allVisibleSelected/);
  assert.match(source,/toggleAssetSelection\(asset.id/);
  assert.match(source,/selectVisibleAssets\(\$event.target.checked\)/);
  assert.match(source,/startBatch\('prompt'\)/);
  assert.match(source,/startBatch\('image'\)/);
  assert.match(source,/a\.kind!=='音频'/);
  assert.match(source,/role="dialog" aria-modal="true"/);
  assert.match(source,/\.asset-detail\{width:min\(1140px,100%\);max-height:calc\(100vh - 56px\);overflow-y:auto/);
  assert.doesNotMatch(source,/\.asset-overlay\{position:fixed;inset:0;background:var\(--el-bg-color/);
});
