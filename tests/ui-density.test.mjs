import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const component = name => readFileSync(fileURLToPath(new URL('../src/'+name+'.vue', import.meta.url)),'utf8');
const style = name => component(name).split('<style scoped>')[1]?.split('</style>')[0] || '';

test('制片中心导航、页面和分镜弹窗使用新的紧凑尺寸',()=>{
  const css=style('Studio');
  assert.match(css,/\.side\{width:156px;padding:11px 7px/);
  assert.match(css,/\.section,\.section\.novel-section,\.section\.scripts-section,\.section\.assets-section\{padding:13px 16px 20px/);
  assert.match(css,/\.board-preview-grid\{grid-template-columns:repeat\(auto-fill,minmax\(260px,1fr\)\)/);
  assert.match(css,/\.board-dialog,\.asset-picker-dialog\{width:min\(100%,990px\);max-width:990px;max-height:calc\(100vh - 28px\);min-height:0/);
  assert.match(css,/@media\(max-width:700px\)/);
});

test('资产库批量模型配置折叠且勾选/生成/删除入口保留',()=>{
  const source=component('AssetLibrary');
  const css=style('AssetLibrary');
  assert.match(source,/<div class="batch-main-row">/);
  assert.match(source,/@click="showBatchSettings=!showBatchSettings"/);
  assert.match(source,/<div v-if="showBatchSettings" class="batch-settings">/);
  assert.match(css,/\.batch-main-row\{display:flex;align-items:center;/);
  assert.match(css,/\.batch-options\{display:grid;grid-template-columns:/);
  assert.match(source,/@click="startBatch\('prompt'\)"/);
  assert.match(source,/@click="startBatch\('image'\)"/);
  assert.match(source,/@click="deleteSelectedAssets"/);
  assert.match(source,/@change="selectVisibleAssets\(\$event.target.checked\)"/);
  assert.match(css,/\.asset-grid\{grid-template-columns:repeat\(auto-fill,minmax\(144px,1fr\)\);gap:10px/);
  assert.match(css,/\.asset-thumb\{aspect-ratio:1\/1\}/);
  assert.match(css,/\.asset-detail\{width:min\(960px,100%\);max-height:calc\(100vh - 32px\)/);
  assert.match(css,/@media\(max-width:650px\)/);
});

test('小说、剧本、项目设置三页统一压缩列表行高与表单间距',()=>{
  const novel=style('NovelManager');
  const scripts=style('ScriptManager');
  const project=style('ProjectSettings');
  assert.match(novel,/\.novel-table td\{padding:8px 8px\}/);
  assert.match(novel,/\.novel-modal\{width:min\(850px,96vw\);max-height:88vh/);
  assert.match(scripts,/\.script-card\{padding:12px 13px;border-radius:9px\}/);
  assert.match(scripts,/\.draft-text\{height:365px;min-height:285px/);
  assert.match(scripts,/\.full-editor\{height:min\(84vh,820px\);min-height:440px;width:min\(1080px,100%\)/);
  assert.match(project,/\.panel\{padding:12px 14px;border-radius:9px\}/);
  assert.match(project,/\.settings-root\{width:100%;max-width:1480px/);
  assert.match(project,/\.generation-head,\.generation-row\{display:grid;grid-template-columns:90px 166px minmax\(190px,420px\) 108px 108px/);
  const settings=component('ProjectSettings');
  assert.equal((settings.match(/class="generation-row"/g)||[]).length,4,'四种媒体生成各占一行');
  assert.match(settings,/class="project-location-row"/);
  assert.match(settings,/class="project-settings-layout"/);
  assert.match(settings,/class="manual-selection"/);
  assert.match(settings,/class="manual-cover-grid"/);
  assert.match(settings,/class="generation-head"/);
  assert.doesNotMatch(settings,/<details class="panel queue-panel">/,'并发/重试不应再占用独立面板');
  for(const kind of ['text','image','video','audio']){
    for(const field of ['concurrency','retries']){
      const needle='v-model.number="queueSettings.'+kind+'.'+field+'"';
      assert.ok(settings.includes(needle),'缺少 '+kind+' '+field+' 配置');
    }
  }
  assert.equal((settings.match(/@change="saveQueueSettings"/g)||[]).length,8,'4 类任务，每类两个数值，均实时保存');
  for(const name of ['Studio','AssetLibrary','NovelManager','ScriptManager','ProjectSettings'])
    assert.doesNotMatch(style(name),/transform\s*:\s*scale\(|\bzoom\s*:/,
      name+' 必须通过布局规则优化，不能用强制缩放导致点击坐标和文本模糊');
});
