// One-time extraction of unchanged thumbnails from the user's local ToonFlow 1.1.8 skills.
// Output is embedded in the single UMD node: no extra files at install time.
import {createRequire} from 'node:module';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);
const sharp=require('D:/Toonflow-app-1.1.8/node_modules/sharp');
const presets=JSON.parse(await readFile('src/legacyManualPresets.json','utf8'));
const base='D:/Toonflow-app-1.1.8/data/skills';
const out={visual:{},director:{}};
for(const kind of ['visual','director']){
  const dir=kind==='visual'?'art_skills':'story_skills';
  for(const manual of presets[kind]){
    const folder=path.join(base,dir,manual.slug,'images');
    let names=[];
    try{names=(await readdir(folder)).filter(f=>/\.(png|jpe?g|webp)$/i.test(f));}catch{}
    const preferred=['title.png','1.png'];
    const filename=preferred.find(p=>names.includes(p))||names[0];
    if(!filename)continue;
    const buffer=await sharp(path.join(folder,filename)).resize(288,176,{fit:'cover',position:'attention'})
      .webp({quality:70,effort:5}).toBuffer();
    out[kind][manual.slug]='data:image/webp;base64,'+buffer.toString('base64');
  }
}
await writeFile('src/manualCoverImages.mjs','// Original covers resized and embedded from ToonFlow 1.1.8 local skills.\nexport default '+JSON.stringify(out)+';\n');
console.log('covers:',Object.fromEntries(Object.entries(out).map(([k,v])=>[k,Object.keys(v).length])));
