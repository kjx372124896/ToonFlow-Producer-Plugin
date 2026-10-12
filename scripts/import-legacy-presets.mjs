import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const oldSkills = resolve(root, "..", "Toonflow-app-1.1.8", "data", "skills");
const list = async type => {
  const dir = resolve(oldSkills, type === "visual" ? "art_skills" : "story_skills");
  const folders = (await readdir(dir, { withFileTypes: true })).filter(x => x.isDirectory()).sort((a,b) => a.name.localeCompare(b.name));
  const result = [];
  for (const entry of folders) {
    const folder = join(dir, entry.name);
    const walk = async (directory) => {
      const entries = (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name));
      const sections = [];
      for (const e of entries) {
        if (e.isDirectory() && e.name !== "images") sections.push(...await walk(join(directory, e.name)));
        else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
          const path = join(directory, e.name);
          const content = await readFile(path,"utf8");
          sections.push({ key: relative(folder,path).replaceAll("\\","/"), title: e.name === "README.md" ? "总说明" : e.name.slice(0,-3), content });
        }
      }
      return sections;
    };
    const sections = await walk(folder);
    sections.sort((a,b) => (a.key === "README.md" ? -1 : b.key === "README.md" ? 1 : a.key.localeCompare(b.key)));
    const readme = sections.find(x => x.key === "README.md")?.content || "";
    const name = readme.split(/\r?\n/)[0].replace(/^#+\s*/,"").replace(/--/g,"").trim() || entry.name;
    if (!sections.length) continue;
    result.push({ id:"builtin:" + type + ":" + entry.name, kind:type, name,
      slug:entry.name, source:"builtin", sections });
  }
  return result;
};
const output = { schemaVersion:1, provenance:"Toonflow-app-1.1.8/data/skills (original full Markdown, images excluded)",visual:await list("visual"),director:await list("director") };
const path = resolve(root,"src","legacyManualPresets.json");
await mkdir(dirname(path),{recursive:true});
await writeFile(path,JSON.stringify(output),"utf8");
console.log(JSON.stringify({path,visual:output.visual.length,director:output.director.length,sections:[...output.visual,...output.director].reduce((n,x)=>n+x.sections.length,0),
  markdownCharacters: [...output.visual,...output.director].reduce((n,p)=>n+p.sections.reduce((t,s)=>t+s.content.length,0),0)},null,2));
