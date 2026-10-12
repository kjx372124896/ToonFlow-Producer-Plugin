// 项目文件始终相对 ToonFlow 当前工作区根目录，不接受 OS 绝对路径。
export function safeRoot(value = ".") {
  const str=String(value||".").trim().replaceAll("\\","/");
  if (!str || str === ".") return "";
  if (str.startsWith("/") || /^[a-zA-Z]:/.test(str)) throw new Error("只能选择画布所在工作区内的相对目录");
  const parts = str.split("/");
  if(parts.some(x=>!x || x==="." || x===".." || /[:*?"<>|\x00-\x1f]/.test(x))) throw new Error("保存目录存在非法路径段");
  return parts.join("/");
}
export function projectDirectory(project, root=".") {
  if(!project?.name || !project?.id) throw new Error("项目名或 ID 为空");
  const clean=String(project.name).replace(/[\\/:*?"<>|\x00-\x1f]/g,"-").replace(/^\.+|\.+$/g,"").trim().slice(0,55)||"未命名";
  const suffix=String(project.id).replace(/[^a-zA-Z0-9]/g,"").slice(-10);
  return [safeRoot(root),clean+"-"+suffix].filter(Boolean).join("/");
}
export function projectPath(project,root="."){return projectDirectory(project,root)+"/项目.tfprod";}
export async function ensureFolders(files,directory) {
  let sofar="";
  for(const name of directory.split("/").filter(Boolean)) {
    sofar=[sofar,name].filter(Boolean).join("/");
    try{await files.mkdir(sofar);}
    catch(e){try{await files.list(sofar)}catch{throw e;}}
  }
}
export async function createProjectOnDisk(files,data,root="."){
  if (!data?.project) throw new Error("项目数据不能为空");
  const directory=projectDirectory(data.project,root);
  await ensureFolders(files,directory);
  const target=directory+"/项目.tfprod";
  // 必须 exclusive，不能覆盖任何现存项目
  await files.write(target,JSON.stringify(data,null,2),true);
  await ensureFolders(files,directory+"/novel");
  await ensureFolders(files,directory+"/assets");
  const check=JSON.parse(await files.readText(target));
  if(check.project.id!==data.project.id) throw new Error("项目创建后读取校验失败");
  return target;
}
export async function migrateLegacyProject(files,oldPath,data) {
  if(!oldPath.startsWith("producer-studio/") || !data?.project) return oldPath;
  const dir=projectDirectory(data.project);
  const target=dir+"/项目.tfprod";
  // 旧项目可能已经迁移：只允许相同项目 ID 的目标文件存在
  try {
    const current=JSON.parse(await files.readText(target));
    if(current.project?.id !== data.project.id) throw new Error("新旧项目 ID 冲突，拒绝覆盖");
    return target;
  } catch(e) {if(String(e?.message||"").includes("冲突")) throw e;}
  await ensureFolders(files,dir);
  await ensureFolders(files,dir+"/novel");
  await ensureFolders(files,dir+"/assets");
  const copy=JSON.parse(JSON.stringify(data)); // Vue 响应式代理不能直接 structuredClone
  for(const asset of copy.assets||[]){
    if(!asset.imagePath?.startsWith("producer-assets/")) continue;
    const content=await files.read(asset.imagePath);
    const ext=asset.imagePath.match(/\.[a-zA-Z0-9]{1,6}$/)?.[0]||".png";
    const path=dir+"/assets/"+asset.id.replace(/[^a-zA-Z0-9_-]/g,"-")+ext;
    await files.write(path,content,true);
    if((await files.read(path)).byteLength!==content.byteLength) throw new Error("资产迁移写后校验失败："+asset.name);
    asset.imagePath=path;
  }
  // 老项目如已保存原小说文件，也一起复制；切勿引用其它项目文件夹。
  if(copy.sourceNovelPath && copy.sourceNovelPath.startsWith("producer-studio/")) {
    const original=await files.read(copy.sourceNovelPath);
    const filename=copy.sourceNovelPath.split("/").at(-1).replace(/[\\/:*?"<>|]/g,"_");
    const novelPath=dir+"/novel/"+filename;
    await files.write(novelPath,original,true);
    if((await files.read(novelPath)).byteLength!==original.byteLength) throw new Error("小说文件迁移校验失败");
    copy.sourceNovelPath=novelPath;
  }
  // 旧的节点绑定记录保留（同一画布有效），不重新生成事件、剧本、分镜。
  await files.write(target,JSON.stringify(copy,null,2),true);
  const readback=JSON.parse(await files.readText(target));
  if(readback.project?.id!==data.project.id || readback.panels?.length!==data.panels?.length) throw new Error("迁移校验失败");
  return target;
}
export async function listProjects(files,root=".") {
  const directory=safeRoot(root);
  const entries=(await files.list(directory)).entries||[];
  const projects=[];
  for(const item of entries.filter(x=>x.type==="directory")){
    const name=item.name;
    const path=[directory,name,"项目.tfprod"].filter(Boolean).join("/");
    try {
      const record=JSON.parse(await files.readText(path));
      if(record?.project?.id) projects.push({path,name:record.project.name,id:record.project.id});
    }catch{}
  }
  return projects.sort((a,b)=>a.name.localeCompare(b.name,"zh"));
}
