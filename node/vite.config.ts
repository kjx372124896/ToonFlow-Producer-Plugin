import { fileURLToPath } from "node:url";
import { createNodeConfig } from "../../Toonflow-app/packages/nodeScaffold/index.ts";
const config = createNodeConfig({
  name: "producerStudioNode",
  displayName: "短剧制片中心",
  author: "Local Plugin",
  github: "",
}, import.meta.url);
config.resolve = {
  alias: {
    "@toonflow/nodes-scaffold/runtime": fileURLToPath(new URL("../../Toonflow-app/packages/nodeScaffold/src/runtime.ts", import.meta.url))
  }
};
// 官方节点安装器只接受一个 JS 文件：把 SFC 样式内联到 UMD，保留官方元数据作为首行。
config.plugins.push({
  name: "producer-inline-styles",
  enforce: "post",
  generateBundle(_options, bundle) {
    const name = "producerStudioNode.umd.js";
    const chunk = bundle[name];
    if (!chunk || chunk.type !== "chunk") throw new Error("节点 UMD 未生成");
    let css = "";
    for (const [fileName, asset] of Object.entries(bundle)) {
      if (asset.type === "asset" && fileName.endsWith(".css")) {
        css += typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source);
        delete bundle[fileName];
      }
    }
    if (css) {
      const injector = "if(typeof document!==\"undefined\"){let s=document.getElementById('producerStudioNode-style');if(!s){s=document.createElement('style');s.id='producerStudioNode-style';document.head.appendChild(s)}s.textContent=" + JSON.stringify(css) + "}\n";
      const newLine = chunk.code.indexOf("\n");
      if (chunk.code.startsWith("/*! toonflowNode:") && newLine !== -1) chunk.code=chunk.code.slice(0,newLine+1)+injector+chunk.code.slice(newLine+1);
      else chunk.code=injector+chunk.code;
    }
  }
});
export default config;
