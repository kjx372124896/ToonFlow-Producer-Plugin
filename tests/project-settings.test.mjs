import test from "node:test";
import assert from "node:assert/strict";
import { projectDirectory, projectPath, createProjectOnDisk, migrateLegacyProject, listProjects, safeRoot } from "../src/projectStorage.mjs";
import { createProject, emptyStudio } from "../src/studio.mjs";
import { builtinList, allManuals, makeCustomManual, manualText, saveCustomManuals, loadCustomManuals } from "../src/manuals.mjs";
import { defaultGeneration, normalizeGeneration, loadRhApps, loadAvailableModels, modelValue, parseModelValue, validateSelectedModels } from "../src/generation.mjs";

function memoryFiles(){
  const files=new Map(),dirs=new Set([""]);
  return {
    files,dirs,
    async mkdir(path){if(dirs.has(path)) throw Error("EEXIST");dirs.add(path);},
    async list(path=""){
      if(!dirs.has(path))throw Error("ENOENT "+path);
      const entries=[...dirs].filter(x=>x!==path&&x.startsWith(path?path+"/":"")&&!x.slice(path?path.length+1:0).includes("/")).map(x=>({name:x.split("/").at(-1),type:"directory",path:x}))
        .concat([...files.keys()].filter(x=>x.startsWith(path?path+"/":"")&&!x.slice(path?path.length+1:0).includes("/")).map(x=>({name:x.split("/").at(-1),type:"file",path:x})));
      return {entries};
    },
    async write(path,content,exclusive){
      if(exclusive&&files.has(path))throw Error("EEXIST");
      files.set(path,typeof content==="string"?Buffer.from(content):Buffer.from(content));
    },
    async readText(path){if(!files.has(path))throw Error("ENOENT");return files.get(path).toString("utf8");},
    async read(path){if(!files.has(path))throw Error("ENOENT");return files.get(path);}
  };
}

test("23套旧版手册完整导入，保留168个章节",()=>{
  const visual=builtinList("visual"),director=builtinList("director");
  assert.equal(visual.length,11);assert.equal(director.length,12);
  assert.equal([...visual,...director].reduce((n,x)=>n+x.sections.length,0),168);
  const all=[...visual,...director];assert.ok(manualText(visual[0]).length>200);
  assert.ok(all.every(p=>p.sections.every(s=>s.key.endsWith(".md"))));
});
test("旧手册只读，编辑生成自定义副本，保存到工作区",async()=>{
  const files=memoryFiles(),builtin=builtinList("visual")[0];
  const custom=makeCustomManual(builtin,"visual","自定义影像手册");
  custom.sections[0].content="新内容";
  assert.notEqual(custom.sections[0].content,builtin.sections[0].content);
  await saveCustomManuals(files,[custom]);
  const loaded=await loadCustomManuals(files);
  assert.equal(loaded[0].sections[0].content,"新内容");
  assert.equal(allManuals("visual",loaded).length,12);
});
test("项目默认保存在画布工作区，独立目录、拒绝覆盖",async()=>{
  const files=memoryFiles();
  const a=emptyStudio();a.project=createProject({name:"测试短剧"});
  const b=emptyStudio();b.project=createProject({name:"另一个项目"});
  const path1=await createProjectOnDisk(files,a);
  const path2=await createProjectOnDisk(files,b);
  assert.notEqual(path1,path2);
  assert.equal(path1,projectPath(a.project));
  assert.ok(path1.startsWith("测试短剧-"));
  assert.ok(files.dirs.has(projectDirectory(a.project)+"/assets"));
  assert.equal((await listProjects(files)).length,2);
  await assert.rejects(createProjectOnDisk(files,a),/EEXIST/);
  assert.throws(()=>safeRoot("C:/secret"),/相对目录/);
  assert.throws(()=>safeRoot("../other"),/非法路径/);
});
test("旧项目迁移复制真实资产并保留原始分镜绑定",async()=>{
  const files=memoryFiles(); const state=emptyStudio();state.project=createProject({name:"旧版制片项目"});
  state.panels=[{id:"panel1",canvasBindings:{canvasId:"cv1",imageId:"i1"}}];
  state.assets=[{id:"a1",imagePath:"producer-assets/picture.jpg",mimeType:"image/jpeg"}];
  files.files.set("producer-assets/picture.jpg",Buffer.from([1,2,3,4,5]));
  const old="producer-studio/old/项目.tfprod";
  const target=await migrateLegacyProject(files,old,state);
  assert.equal(target,projectPath(state.project));
  const migrated=JSON.parse(await files.readText(target));
  assert.deepEqual(migrated.panels,state.panels);
  assert.ok(migrated.assets[0].imagePath.startsWith(projectDirectory(state.project)+"/assets/"));
  assert.deepEqual(await files.read(migrated.assets[0].imagePath),Buffer.from([1,2,3,4,5]));
  assert.equal(state.assets[0].imagePath,"producer-assets/picture.jpg");
});

test("模型下拉从 ToonFlow 原生文本和媒体模型接口获取，并保存 providerId/modelId", async()=>{
  const urls=[];
  const models=await loadAvailableModels(async(url)=>{
    urls.push(url);
    return {ok:true,async json(){return {code:200,data:url==="/api/ai/models"?
      [{providerId:"p-text",modelId:"gpt-alpha",label:"文本模型",providerLabel:"自定义供应商"}]:
      [{type:"image",providerId:"p-img",modelId:"imgen",label:"图片生成"},
       {type:"video",providerId:"p-vid",modelId:"vidgen",label:"视频生成"},
       {type:"audio",providerId:"p-aud",modelId:"audgen",label:"音频生成"}]};}};
  });
  assert.deepEqual(urls,["/api/ai/models","/api/ai/media/models"]);
  assert.equal(models.text[0].value,JSON.stringify(["p-text","gpt-alpha"]));
  assert.equal(models.image[0].value,modelValue("p-img","imgen"));
  assert.equal(models.video[0].value,modelValue("p-vid","vidgen"));
  assert.equal(models.audio[0].value,modelValue("p-aud","audgen"));
  assert.deepEqual(parseModelValue(models.text[0].value),{providerId:"p-text",modelId:"gpt-alpha"});
  const saved=normalizeGeneration({
    text:{mode:"rh",model:models.text[0].value},
    image:{mode:"model",model:models.image[0].value},
    video:{mode:"model",model:models.video[0].value},
    audio:{mode:"model",model:models.audio[0].value}
  });
  assert.equal(saved.text.mode,"model");
  assert.equal(saved.text.model,models.text[0].value);
  assert.equal(saved.image.model,models.image[0].value);
  assert.equal(saved.video.model,models.video[0].value);
  assert.equal(saved.audio.model,models.audio[0].value);
  validateSelectedModels(saved,models);
  assert.throws(()=>validateSelectedModels({...saved,image:{mode:"model",model:modelValue("other","missing")}},models),/图片默认模型已不可用/);
  validateSelectedModels({...saved,image:{mode:"rh",model:modelValue("other","missing"),rhAppUid:"rh"}},models);
  assert.throws(()=>validateSelectedModels({...saved,audio:{mode:"model",model:modelValue("bad","missing")}},models),/音频默认模型已不可用/);
  validateSelectedModels({...saved,audio:{mode:"off",model:modelValue("bad","missing")}},models);
});

test("文本固定模型，图片/视频支持 RH，音频可关闭、选模型或 RH",async()=>{
  const g=normalizeGeneration({text:{mode:"rh"},image:{mode:"rh",rhAppUid:"img-app"},video:{mode:"rh",rhAppUid:"vid-app"}});
  assert.deepEqual(g.text,{mode:"model",model:""});
  assert.equal(g.image.mode,"rh");assert.equal(g.video.rhAppUid,"vid-app");
  assert.deepEqual(g.audio,{mode:"off",model:"",rhAppUid:""});
  assert.equal(normalizeGeneration({audio:{mode:"rh",rhAppUid:"aud-app"}}).audio.rhAppUid,"aud-app");
  assert.equal(normalizeGeneration({audio:{mode:"model",model:"model-id"}}).audio.mode,"model");
  assert.deepEqual(defaultGeneration().text,{mode:"model",model:""});
  const apps=await loadRhApps(async()=>({ok:true,async json(){return {code:200,data:{mediaProviderConfigs:{runninghub:{workflowApps:[
    {uid:"abc",webappId:"123",name:"RH 图片"},{uid:"def",webappId:"456",name:"RH 视频"}
  ]}}}};}}));
  assert.equal(apps.length,2);assert.equal(apps[1].uid,"def");
});
