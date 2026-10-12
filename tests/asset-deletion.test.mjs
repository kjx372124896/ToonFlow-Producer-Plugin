import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { removeAssetsFromStudio } from '../src/assetEngine.mjs';

function createFixture(){
  const assets = [
    { id:'a', name:'苏荷', kind:'角色', images:[{id:'img-a',path:'assets/a.png'}], audios:[] },
    { id:'b', name:'门派大厅', kind:'场景', images:[{id:'img-b',path:'assets/b.png'}], audios:[] },
    { id:'c', name:'钟声', kind:'音频', images:[], audios:[{id:'snd-c',path:'assets/c.wav'}] },
    { id:'d', name:'玉佩', kind:'道具', images:[{id:'img-d',path:'assets/d.png'}], audios:[] }
  ];
  return {
    assets, scripts:[{id:'s1',text:'原有完整剧本'}],
    assetMentions:[
      {id:'ma',assetId:'a',scriptId:'s1'},
      {id:'mb',assetId:'b',scriptId:'s1'},
      {id:'mc',assetId:'c',scriptId:'s1'}
    ],
    panels:[{
      id:'panel1', assetIds:['a','b','d'], assets:['a','b','d'],
      assetVersions:{a:'img-a',b:'img-b',d:'img-d'},
      shots:[{
        id:'shot1', assetIds:['a','b'], assets:['a','b'],
        assetVersions:{a:'img-a',b:'img-b'},imagePath:'assets/shot.png'
      }]
    }],
    storyboards:[{
      id:'row1',assetIds:['a','d'],assetVersions:{a:'img-a',d:'img-d'}
    }],
    storyboardBoards:[{
      id:'board1',assetIds:['a','b','d'],assets:['a','b','d'],assetVersions:{a:'img-a',b:'img-b'},
      shots:[{id:'board-shot',assetIds:['a','b','d'],assetVersions:{a:'img-a',b:'img-b'}}]
    }],
    assetExtractionDrafts:[{id:'draft-a',bindTo:'a',name:'同一角色'}, {id:'draft-d',bindTo:'d',name:'道具'}]
  };
}

test('单个删除只移除目标索引，同时清理跨集、分镜表、分镜板和媒体版本关联',()=>{
  const project=createFixture();
  const savedAsset=project.assets[0];
  const result=removeAssetsFromStudio(project,['a']);
  assert.equal(result.count,1);
  assert.deepEqual(result.removed,[{id:'a',name:'苏荷',kind:'角色'}]);
  assert.deepEqual(project.assets.map(a=>a.id),['b','c','d']);
  assert.deepEqual(project.assetMentions.map(m=>m.assetId),['b','c']);
  assert.deepEqual(project.panels[0].assetIds,['b','d']);
  assert.deepEqual(project.panels[0].assets,['b','d']);
  assert.deepEqual(project.panels[0].assetVersions,{b:'img-b',d:'img-d'});
  assert.deepEqual(project.panels[0].shots[0].assetIds,['b']);
  assert.deepEqual(project.panels[0].shots[0].assetVersions,{b:'img-b'});
  assert.deepEqual(project.storyboards[0].assetIds,['d']);
  assert.deepEqual(project.storyboards[0].assetVersions,{d:'img-d'});
  assert.deepEqual(project.storyboardBoards[0].assetIds,['b','d']);
  assert.deepEqual(project.storyboardBoards[0].assets,['b','d']);
  assert.deepEqual(project.storyboardBoards[0].shots[0].assetIds,['b','d']);
  assert.deepEqual(project.storyboardBoards[0].shots[0].assetVersions,{b:'img-b'});
  assert.equal(project.assetExtractionDrafts[0].bindTo,'');
  assert.equal(project.assetExtractionDrafts[1].bindTo,'d');
  assert.equal(project.scripts[0].text,'原有完整剧本');
  assert.equal(savedAsset.images[0].path,'assets/a.png','只移除索引，不删除实际媒体路径');
});

test('批量删除一次性处理勾选的多个类型，未选资产及其关联保持不变',()=>{
  const project=createFixture();
  const result=removeAssetsFromStudio(project,['b','c','b']);
  assert.equal(result.count,2);
  assert.deepEqual(project.assets.map(a=>a.id),['a','d']);
  assert.deepEqual(project.assetMentions.map(m=>m.assetId),['a']);
  assert.deepEqual(project.panels[0].assetIds,['a','d']);
  assert.deepEqual(project.panels[0].assetVersions,{a:'img-a',d:'img-d'});
  assert.deepEqual(project.panels[0].shots[0].assetIds,['a']);
  assert.deepEqual(project.storyboardBoards[0].shots[0].assetIds,['a','d']);
  assert.equal(project.assetExtractionDrafts[0].bindTo,'a');
  assert.equal(project.assetExtractionDrafts[1].bindTo,'d');
  assert.equal(project.assets[0].images[0].path,'assets/a.png');
  assert.equal(project.assets[1].images[0].path,'assets/d.png');
});

test('删除不存在的 ID 或空选择会拒绝执行，不产生任何部分修改',()=>{
  const project=createFixture();
  const before=JSON.stringify(project);
  assert.throws(()=>removeAssetsFromStudio(project,['a','missing']),/已不存在/);
  assert.equal(JSON.stringify(project),before);
  assert.throws(()=>removeAssetsFromStudio(project,[]),/请选择/);
  assert.equal(JSON.stringify(project),before);
});

test('资产库 UI 同时提供卡片单删、详情单删、批量删除与写后校验',()=>{
  const source=readFileSync(fileURLToPath(new URL('../src/AssetLibrary.vue',import.meta.url)),'utf8');
  assert.match(source,/删除选中（/);
  assert.match(source,/@click="deleteSelectedAssets"/);
  assert.match(source,/@click\.stop="deleteOneAsset\(asset\)"/);
  assert.match(source,/@click="deleteAsset"/);
  assert.match(source,/removeChosenAssets\(selectedAssets\.value\.map\(asset=>asset\.id\)\)/);
  assert.match(source,/removeAssetsFromStudio\(scope,\[\.\.\.idSet\]\)/);
  assert.match(source,/await props\.context\.flushSave\(\)/);
  assert.match(source,/for\(const key of keys\)scope\[key\]=snapshot\[key\]/);
  assert.match(source,/本地图片、音频文件及已创建的画布节点不会删除/);
});
