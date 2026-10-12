import { uid } from "./studio.mjs";
import { eventPrompt } from "./eventAnalysis.mjs";

export const DEFAULT_EVENT_RULE_ID = "builtin:event-extraction-7";
export const EVENT_RULE_CATALOG = "producer-rules/事件提取规则.json";
export const builtinEventRule = Object.freeze({
  id: DEFAULT_EVENT_RULE_ID,
  name: "章节事件提取（标准7字段）",
  prompt: eventPrompt,
  source: "builtin"
});

export function ruleFingerprint(prompt) {
  const text = String(prompt || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return text.length + ":" + (hash >>> 0).toString(16);
}
export function validateEventRule(value) {
  const name = String(value?.name || "").trim();
  const prompt = String(value?.prompt || "").trim();
  if (!name || name.length > 80) throw new Error("规则名称须为1–80个字符");
  if (!prompt || prompt.length > 100000) throw new Error("提取规则正文须为1–100000个字符");
  if (!value?.id || value.id === DEFAULT_EVENT_RULE_ID || !String(value.id).startsWith("customEventRule-"))
    throw new Error("自定义规则 ID 无效");
  return {id:value.id,source:"custom",name,prompt,updatedAt:Number(value.updatedAt)||Date.now()};
}
export function createEventRule(source=null) {
  return {id:uid("customEventRule"),source:"custom",
    name:source ? source.name + " · 副本" : "新事件提取规则",
    prompt:source?.prompt || eventPrompt,updatedAt:Date.now()};
}
export function allEventRules(custom=[]) {
  return [{...builtinEventRule}, ...custom.filter(rule=>rule?.source==="custom")];
}
export function resolveEventRule(id, custom=[]) {
  return allEventRules(custom).find(rule=>rule.id===id) || null;
}
export function snapshotEventRule(rule) {
  if (!rule) throw new Error("所选提取规则不存在，请重新选择");
  if (!rule.prompt?.trim()) throw new Error("所选提取规则正文为空");
  return {id:rule.id,name:rule.name,prompt:rule.prompt,digest:ruleFingerprint(rule.prompt)};
}

function missingFileError(error){
  const code=String(error?.response?.data?.data?.code || error?.code || "");
  return /ENOENT|NOT_FOUND|404/i.test(code);
}
export async function loadEventRules(files) {
  let raw;
  try {raw=await files.readText(EVENT_RULE_CATALOG);}
  catch(error) {
    if (missingFileError(error)) return [];
    // 目录可能还不存在。不要把鉴权/网络等错误伪装成无自定义规则。
    try {
      const folder=await files.list("producer-rules");
      if (folder.entries?.some(item=>item.name==="事件提取规则.json")) throw new Error("自定义事件规则文件存在但无法读取："+(error.message||error));
      return [];
    } catch(folderError){
      if (missingFileError(folderError)) return [];
      throw folderError;
    }
  }
  let parsed;
  try {parsed=JSON.parse(raw);}
  catch {throw new Error("自定义事件提取规则文件 JSON 损坏，请备份并修复");}
  if (parsed?.schemaVersion!==1 || !Array.isArray(parsed.rules)) throw new Error("自定义事件提取规则文件格式不受支持");
  const rules=parsed.rules.map(validateEventRule);
  if (new Set(rules.map(rule=>rule.id)).size!==rules.length) throw new Error("自定义事件规则 ID 重复");
  return rules;
}
export async function saveEventRules(files,rules) {
  if (!Array.isArray(rules)) throw new Error("规则列表格式错误");
  const validated=rules.map(validateEventRule);
  if (new Set(validated.map(rule=>rule.id)).size!==validated.length) throw new Error("规则 ID 重复");
  try {await files.mkdir("producer-rules");}
  catch (error) {
    const dir=await files.list("producer-rules");
    if (!Array.isArray(dir.entries)) throw error;
  }
  const payload=JSON.stringify({schemaVersion:1,rules:validated},null,2);
  await files.write(EVENT_RULE_CATALOG,payload,false);
  // 写后验证完整内容，避免保存错误被误报成功。
  const verify=await loadEventRules(files);
  if (JSON.stringify(verify)!==JSON.stringify(validated)) throw new Error("规则文件保存后的内容校验失败");
  return verifiedCopy(validated);
}
function verifiedCopy(rules){return rules.map(rule=>({...rule}));}
