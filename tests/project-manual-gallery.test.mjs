import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import coverImages from '../src/manualCoverImages.mjs';
import {builtinList,makeCustomManual,manualText} from '../src/manuals.mjs';
import {renderManualMarkdown} from '../src/manualMarkdown.mjs';

const path=fileURLToPath(new URL('../src/ProjectSettings.vue',import.meta.url));
const source=readFileSync(path,'utf8');

test('项目设置采用左右分栏的原始封面网格，不再将手册编辑器嵌在设置页',()=>{
  assert.match(source,/class="project-settings-layout"/);
  assert.match(source,/class="project-configuration"/);
  assert.match(source,/class="manual-selection"/);
  assert.match(source,/class="manual-cover-grid"/);
  assert.match(source,/:aria-pressed="selected\[kind\]===manual.id"/);
  assert.match(source,/@click="choose\(kind,manual.id\)"/);
  assert.match(source,/<Teleport to="body">/);
  assert.match(source,/v-if="editor" class="manual-modal-mask"/);
  assert.match(source,/role="dialog" aria-modal="true"/);
  assert.doesNotMatch(source,/v-if="editor" class="panel editor"/);
  assert.match(source,/class="panel generation-panel"/);
});

test('封面内提供编辑、复制、查看编辑及仅限自定义的删除，操作不误触选择',()=>{
  assert.match(source,/<div v-for="manual in manuals\(kind\)"[\s\S]*?class="manual-cover-tile"/);
  assert.match(source,/class="manual-cover-pick"[\s\S]*?@click="choose\(kind,manual.id\)"/);
  assert.match(source,/class="manual-cover-action manual-cover-edit"/);
  assert.match(source,/class="manual-cover-right"/);
  assert.match(source,/class="manual-cover-view"/);
  assert.match(source,/@click\.stop="startEdit\(kind,manual.id\)"/);
  assert.match(source,/@click\.stop="startCopy\(kind,manual.id\)"/);
  assert.match(source,/v-if="manual.source==='custom'"[\s\S]*?class="manual-cover-action manual-cover-delete"/);
  assert.match(source,/@click\.stop="deleteManualById\(kind,manual.id\)"/);
  assert.match(source,/const manual=custom.value.find\(m=>m.kind===kind&&m.id===id\)/);
  assert.match(source,/const copy=makeCustomManual\(manual,kind,manual.name\+" · 副本"\)/);
  assert.match(source,/:hover \.manual-cover-action/);
  assert.match(source,/:focus-within \.manual-cover-action/);
  assert.match(source,/@media\(hover:none\)/);
});

test('默认模型与并发重试配置归左栏，项目设置取消居中留白并保留响应式布局',()=>{
  const position=source.indexOf('class="project-configuration"');
  const gallery=source.indexOf('class="manual-selection"');
  const generator=source.indexOf('class="panel generation-panel"');
  assert.ok(position>=0&&generator>position&&gallery>generator);
  const left=source.slice(position,gallery);
  assert.equal((left.match(/class="generation-row"/g)||[]).length,4);
  assert.match(left,/v-model.number="queueSettings.text.concurrency"/);
  assert.match(left,/v-model.number="queueSettings.audio.retries"/);
  assert.match(source,/\.settings-root\{width:100%;max-width:none;margin:0;/);
  assert.match(source,/\.project-configuration \.generation-head,\.project-configuration \.generation-row/);
  const studio=readFileSync(fileURLToPath(new URL('../src/Studio.vue',import.meta.url)),'utf8');
  assert.match(studio,/class="section project-section"/);
  assert.match(studio,/\.section\.project-section\{max-width:none;width:100%/);
});

test('手册弹窗 Teleport 层级高于制片中心主遮罩，关闭操作不会绕过未保存确认',()=>{
  const host=readFileSync(fileURLToPath(new URL('../node/src/index.vue',import.meta.url)),'utf8');
  const hostIndex=Number(host.match(/\.producer-node-overlay\{[^}]*z-index:(\d+)/)?.[1]);
  const modalIndex=Number(source.match(/\.manual-modal-mask\{[^}]*z-index:(\d+)/)?.[1]);
  assert.ok(hostIndex>0,'宿主主遮罩应该声明堆叠层级');
  assert.ok(modalIndex>hostIndex,'手册弹窗不能被主窗口遮盖');
  assert.ok(modalIndex<=2147483647,'CSS z-index 不应超过 Chromium 最大值');
  assert.match(source,/<Teleport to="body">/);
  assert.match(source,/@click.self="closeManualEditor\(\)"/);
  assert.match(source,/@keydown.esc.stop.prevent="closeManualEditor\(\)"/);
  assert.match(source,/@click="closeManualEditor\(\)"/);
  assert.doesNotMatch(source,/@click="closeManualEditor"/);
  assert.match(source,/JSON.stringify\(editor.value\)!==editorSnapshot.value/);
});

test('视觉手册一整行、导演手册下一整行，各自封面单行横向翻页',()=>{
  assert.match(source,/class="manual-selection"/);
  assert.match(source,/v-for="kind in \['visual','director'\]"/);
  assert.match(source,/\.manual-selection\{display:grid!important;grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(source,/\.manual-selection\{display:grid!important;grid-template-columns:repeat\(2,/);
  assert.match(source,/\.manual-selection \.manual-cover-grid\{display:flex!important;flex-direction:row;flex-wrap:nowrap/);
  assert.match(source,/overflow-x:auto;overflow-y:hidden/);
  assert.match(source,/\.settings-root \.manual-selection \.manual-cover-tile\{display:block;flex:0 0 102px;width:102px;height:113px/);
  assert.match(source,/:ref="el=>setManualGallery\(kind,el\)"/);
  assert.match(source,/@click="scrollManualGallery\(kind,-1\)"/);
  assert.match(source,/@click="scrollManualGallery\(kind,1\)"/);
  assert.match(source,/element\.scrollBy\(\{left:/);
});
test('保存项目设置移到顶部新建项目旁边，底部只保留创建项目入口',()=>{
  const head=source.slice(source.indexOf('class="project-header"'),source.indexOf('class="project-settings-layout"'));
  assert.match(head,/@click="startCreating"/);
  assert.match(head,/v-if="project && !creating" class="primary" :disabled="working" @click="save">保存项目设置/);
  assert.ok(head.indexOf('@click="startCreating"')<head.indexOf('@click="save"'));
  const footer=source.slice(source.lastIndexOf('class="toolbar footer"'),source.indexOf('</template>'));
  assert.doesNotMatch(footer,/保存项目设置/);
  assert.match(source,/@click="create">创建项目并打开/);
  assert.match(source,/\.project-header-actions\{gap:7px;justify-content:flex-end\}/);
});

test('23套旧版手册全部带真实内嵌封面，部署只依赖单个UMD文件',()=>{
  for(const kind of ['visual','director']){
    const list=builtinList(kind),covers=coverImages[kind];
    assert.equal(Object.keys(covers).length,list.length);
    for(const manual of list){
      assert.match(covers[manual.slug],/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/);
      assert.ok(covers[manual.slug].length>900);
    }
  }
  assert.equal(builtinList('visual').length,11);
  assert.equal(builtinList('director').length,12);
});

test('原始手册复制编辑保留全套章节、来源封面，不能覆盖内置手册',()=>{
  const original=builtinList('visual')[2];
  const custom=makeCustomManual(original,'visual',original.name+' · 自定义');
  assert.notEqual(custom.id,original.id);
  assert.equal(custom.coverSourceSlug,original.slug);
  assert.equal(custom.sections.length,original.sections.length);
  assert.equal(manualText(custom),manualText(original));
  custom.sections[0].content='修改正文';
  assert.notEqual(custom.sections[0].content,original.sections[0].content);
  const withPhoto=makeCustomManual({...custom,coverPath:'producer-manuals/covers/one.webp'},'visual','已上传封面');
  assert.equal(withPhoto.coverPath,'producer-manuals/covers/one.webp');
});

test('新建视觉手册具有旧版全套章节，修改显示标题不影响资产规范的路由',()=>{
  const custom=makeCustomManual(null,'visual','新视觉手册');
  assert.equal(custom.sections.length,12);
  const needed=['README.md','prefix.md','art_prompt/art_character.md','art_prompt/art_character_derivative.md',
    'art_prompt/art_scene.md','art_prompt/art_scene_derivative.md','art_prompt/art_prop.md','art_prompt/art_prop_derivative.md'];
  for(const key of needed)assert.ok(custom.sections.some(s=>s.key===key),key);
  const character=custom.sections.find(s=>s.key==='art_prompt/art_character.md');
  character.title='人物基础形象设计';
  character.content='保持角色五官差异化';
  assert.ok(manualText(custom).includes('## art_character\n> 章节标题：人物基础形象设计\n保持角色五官差异化'));
});

test('Markdown 实时预览支持标题、加粗、列表及表格，严格转义HTML，杜绝脚本执行',()=>{
  const md=['# 手册标题','- **角色特征**','- 场景','| 类型 | 描述 |','| --- | --- |','| 角色 | 男性 |',
    '<script>alert("xss")</script>', '<img src=x onerror=alert(1)>'].join('\n');
  const html=renderManualMarkdown(md);
  assert.match(html,/<h1>手册标题<\/h1>/);
  assert.match(html,/<strong>角色特征<\/strong>/);
  assert.match(html,/<ul>/);
  assert.match(html,/<table>/);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.doesNotMatch(html,/<script>/);
  assert.doesNotMatch(html,/<img/);
});

test('编辑弹窗含封面、章节Tab、Markdown编辑及预览、取消提醒和保存为副本',()=>{
  assert.match(source,/onManualCoverUpload/);
  assert.match(source,/editorCoverPreview\|\|coverSrc\(editor\)/);
  assert.match(source,/role="tablist" aria-label="手册章节"/);
  assert.match(source,/renderManualMarkdown\(editor.sections\[sectionIndex\].content\)/);
  assert.match(source,/class="manual-editor-columns"/);
  assert.match(source,/editorSnapshot.value/);
  assert.match(source,/confirm\("当前手册有未保存的修改/);
  assert.match(source,/await saveCustomManuals\(props.context.files,next\)/);
  assert.match(source,/choose\(manual.kind,manual.id\)/);
  assert.match(source,/manual.source="custom"/);
  assert.match(source,/producer-manuals\/covers\//);
  assert.match(source,/@click="closeManualEditor\(\)"/);
  assert.match(source,/@click="commitManual"/);
});
