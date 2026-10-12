import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assetImageRatio} from '../src/assetBatch.mjs';
import {addAssetDerivative} from '../src/assetDerivatives.mjs';
import {generateAssetImage} from '../src/assetMedia.mjs';

const vue=readFileSync(fileURLToPath(new URL('../src/AssetLibrary.vue',import.meta.url)),'utf8');
const template=vue.split('</template>')[0];
const imageSource=readFileSync(fileURLToPath(new URL('../src/assetMedia.mjs',import.meta.url)),'utf8');

test('默认生图比例所有视觉分类均为 16:9，预览框和卡片统一 4:3',()=>{
  for(const kind of ['角色','场景','道具'])assert.equal(assetImageRatio({kind}),'16:9');
  assert.match(imageSource,/ratio='16:9'/);
  assert.match(vue,/\.asset-grid \.asset-thumb\{aspect-ratio:4 \/ 3!important\}/);
  assert.match(vue,/\.media-area \.large-preview\{[^}]*aspect-ratio:4 \/ 3/);
  assert.match(vue,/\.media-area \.image-version-preview\{[^}]*aspect-ratio:4 \/ 3/);
  assert.match(vue,/\.large-preview img\{[^}]*object-fit:contain/);
});

test('图片列表与主预览绑定选中图片，放大查看，设为默认仍为独立操作',()=>{
  assert.match(template,/v-if="currentPreviewImage && previews\[currentPreviewImage.path\]"/);
  assert.match(template,/@click="selectPreview\(img.id\)"/);
  assert.match(template,/:aria-pressed="currentPreviewImage\?\.id===img.id"/);
  assert.match(template,/@click="openZoom"/);
  assert.match(template,/v-if="zoomOpen && currentPreviewImage" class="asset-zoom-overlay"/);
  assert.match(template,/@click="zoomOpen=false"/);
  assert.match(template,/@click="chooseDefault\(img.id\)"/);
  assert.match(vue,/function selectPreview\(id\)\{[^}]*selectedPreviewId.value=id;derivativeBaseImageId.value=id;/);
  assert.doesNotMatch(vue.match(/function selectPreview\(id\)\{[^}]*\}/)?.[0]||'',/setDefaultImage/);
});

test('衍生资产自由变化输入，不再固定类型，默认关联当前选中图片，模型及比例完全共用',()=>{
  const asset={id:'a',kind:'角色',images:[{id:'base',path:'assets/base.png'},{id:'other',path:'assets/other.png'}],defaultImageId:'base'};
  const variant=addAssetDerivative(asset,{type:'改成秋冬针织毛衣',instruction:'把服装更换为秋冬针织毛衣，保留脸型',baseImageId:'other'});
  assert.equal(variant.type,'改成秋冬针织毛衣');
  assert.equal(variant.baseImageId,'other');
  assert.match(template,/v-model="derivativeInstruction"/);
  assert.doesNotMatch(template,/v-model="derivativeType"/);
  assert.match(vue,/baseImageId:derivativeBaseImageId.value\|\|selectedPreviewId.value/);
  assert.match(template,/v-for="\(image,index\) in detail.images"/);
  assert.equal((template.match(/v-model="imageModel"/g)||[]).length,1);
  assert.equal((template.match(/v-model="imageRatio"/g)||[]).length,1);
  assert.doesNotMatch(vue,/derivativeImageModel/);
  assert.match(vue,/modelValue:imageModel.value,ratio:imageRatio.value/);
});

test('直接输入修改要求也可生成衍生图，无需强制先调用提示词模型；请求传入所选参考图',async()=>{
  const asset={id:'a',kind:'角色',name:'示例',description:'成年角色，五官清晰',imagePrompt:'写实角色图',
    images:[{id:'base',path:'assets/base.png',mimeType:'image/png'},{id:'other',path:'assets/other.webp',mimeType:'image/webp'}],defaultImageId:'base'};
  const derivative=addAssetDerivative(asset,{type:'换装',instruction:'换成蓝色外套，脸型不变',baseImageId:'other'});
  assert.equal(derivative.prompt,'');
  const calls=[];
  const result=await generateAssetImage(asset,{id:'proj',generation:{image:{model:JSON.stringify(['p','m'])}}},{list:async()=>({directory:'D:/project'})},{
    derivative,fetchFn:async(_u,req)=>{
      calls.push(JSON.parse(req.body));
      return {ok:true,json:async()=>({code:200,data:[{mediaType:'image',path:'result.png',mimeType:'image/png'}]})};
    }
  });
  assert.equal(result.length,1);
  assert.equal(calls[0].ratio,'16:9');
  assert.deepEqual(calls[0].images,[{path:'assets/other.webp',mimeType:'image/webp'}]);
  assert.ok(calls[0].prompt.includes('换成蓝色外套，脸型不变'));
});

test('音频上传/播放保留，配音生成功能与相关按钮已经移除',()=>{
  assert.match(template,/上传音频文件/);
  assert.match(template,/<audio v-if="previews\[audio.path\]" controls/);
  assert.doesNotMatch(template,/@click="generateVoice"/);
  assert.doesNotMatch(template,/RH 配音工作流/);
  assert.doesNotMatch(vue,/function generateVoice\(/);
});

test('资产弹窗更宽更矮、图片与列表并排、两栏独立滚动',()=>{
  assert.match(vue,/\.asset-detail\{display:flex;flex-direction:column;width:min\(1480px,calc\(100vw - 32px\)\);max-width:none;height:min\(780px,76vh\)/);
  assert.match(vue,/\.media-area\{display:grid;grid-template-columns:minmax\(230px,1.15fr\) minmax\(195px,.85fr\)/);
  assert.match(vue,/\.media-area,\.detail-controls\{min-width:0;min-height:0;overflow:auto/);
  assert.match(template,/class="generation-box shared-image-settings"/);
  assert.match(vue,/\.asset-detail\{height:min\(940px,94vh\);max-height:calc\(100vh - 16px\)/);
  assert.match(vue,/\.media-area\{grid-template-columns:minmax\(0,1.1fr\) minmax\(0,1fr\);grid-template-rows:clamp\(275px,42vh,380px\) auto auto/);
  assert.match(vue,/\.media-area \.image-row\{grid-column:2;grid-row:1;display:grid;grid-template-columns:repeat\(auto-fill,minmax\(77px,1fr\)\)/);
  assert.match(vue,/\.media-area \.image-version-actions\{position:absolute;/);
  assert.match(vue,/\.media-area \.large-preview\{grid-column:1;grid-row:1;/);
  assert.match(vue,/@media\(hover:none\)\{[\s\S]*?\.media-area \.image-version-actions\{opacity:1;pointer-events:auto\}/);
  assert.doesNotMatch(template,/class="derivative-image-list"/,'衍生图不再另画一份缩略图');
  assert.equal((template.match(/class="image-row"/g)||[]).length,1,'全部图片共用同一个版本列表');
  assert.match(vue,/asset\.images\.push\(\{\.\.\.image,derivativeId:variant.id\}\)/);
  assert.match(vue,/selectedPreviewId.value=image.id;derivativeBaseImageId.value=image.id/);
});
