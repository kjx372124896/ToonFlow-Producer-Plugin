import builtins from "./legacyManualPresets.json" with { type: "json" };
import { uid } from "./studio.mjs";
export const legacyPresets = builtins;
const CATALOG="producer-manuals/自定义手册.json";
const clone=value=>JSON.parse(JSON.stringify(value));
// Keep routing headings stable even if the user renames the display title in the editor.
// Asset prompting uses these headings to load prefix + category + derivative rules.
const visualRoutingKeys = {
  "README.md":"总说明","prefix.md":"prefix",
  "art_prompt/art_character.md":"art_character",
  "art_prompt/art_character_derivative.md":"art_character_derivative",
  "art_prompt/art_scene.md":"art_scene",
  "art_prompt/art_scene_derivative.md":"art_scene_derivative",
  "art_prompt/art_prop.md":"art_prop",
  "art_prompt/art_prop_derivative.md":"art_prop_derivative"
};
export function manualText(manual) {
  return (manual?.sections||[]).map(s=>{
    const title=manual?.kind==="visual"?(visualRoutingKeys[s.key]||s.title):s.title;
    const customTitle=s.title!==title?"\n> 章节标题："+s.title:"";
    return "## "+title+customTitle+"\n"+s.content;
  }).join("\n\n");
}
export function builtinList(kind) {return clone(builtins[kind]||[]);}
export function allManuals(kind,custom=[]) {
  return [...builtinList(kind),...custom.filter(x=>x.kind===kind)];
}
export async function loadCustomManuals(files) {
  try {
    const data=JSON.parse(await files.readText(CATALOG));
    return Array.isArray(data.manuals) ? data.manuals.filter(m=>m && ["visual","director"].includes(m.kind)) : [];
  } catch(e) {
    // 仅在尚无目录/文件时返回空；已存在但 JSON 错误应暴露，不能静默丢失用户自定义手册
    try {
      const dir=await files.list("producer-manuals");
      if(dir.entries?.some(x=>x.name==="自定义手册.json")) throw new Error("自定义手册文件损坏，请恢复文件或备份");
    } catch(inner) {
      if(String(inner.message).includes("损坏")) throw inner;
    }
    return [];
  }
}
export async function saveCustomManuals(files,custom) {
  try {await files.mkdir("producer-manuals")}catch(e){await files.list("producer-manuals")}
  await files.write(CATALOG,JSON.stringify({schemaVersion:1,manuals:custom},null,2),false);
  const verify=JSON.parse(await files.readText(CATALOG));
  if(verify.manuals?.length!==custom.length) throw new Error("自定义手册写后验证失败");
}
export function makeCustomManual(source,kind,name) {
  // 新建时预置与旧版相同的章节键；资产生成依赖 art_character、
  // art_scene 及对应 derivative 键，不能用无意义的 custom/ 路径代替。
  const base=source?clone(source):{sections:(builtins[kind]?.[0]?.sections||[
    {key:"README.md",title:"总说明",content:""}
  ]).map(s=>({key:s.key,title:s.title,content:""}))};
  return { id:uid("customManual"),kind,name:String(name||base.name||"新手册").trim(),slug:"",source:"custom",
    coverPath:source?.coverPath||'',coverSourceSlug:source?.coverSourceSlug||source?.slug||'',
    sections:base.sections.map(x=>({...x})),updatedAt:Date.now()};
}
