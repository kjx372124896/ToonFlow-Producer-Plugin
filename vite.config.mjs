import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";

const meta = {
  id: "ext-producerStudio",
  displayName: "短剧制片中心",
  extensions: ["tfprod"],
  resourceKind: "file",
  text: true,
  configRules: [],
  version: JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version,
  readme: "ToonFlow 2.x 制片管理扩展。打开工作区中的 .tfprod 文件进入制片管理界面。"
};
export default defineConfig({
  plugins: [vue(), {
    name: "producer-bundle",
    enforce: "post",
    generateBundle(_options, bundle) {
      const fileName = "ext-producerStudio.umd.js";
      const chunk = bundle[fileName];
      if (!chunk || chunk.type !== "chunk") throw new Error("未找到 UMD 扩展产物");
      let css = "";
      for (const [name, asset] of Object.entries(bundle)) {
        if (asset.type === "asset" && name.endsWith(".css")) {
          css += typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source);
          delete bundle[name];
        }
      }
      const id = "toonflowExt-ext-producerStudio";
      const style = "if(typeof document!==\"undefined\"){let s=document.getElementById(" + JSON.stringify(id) + ");if(!s){s=document.createElement('style');s.id=" + JSON.stringify(id) + ";document.head.appendChild(s)}s.textContent=" + JSON.stringify(css) + ";}\n";
      chunk.code = "/*! toonflowExt:" + JSON.stringify(meta).replaceAll("/", "\\u002f") + " */\n" + style + chunk.code;
    }
  }],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist", emptyOutDir: true, cssCodeSplit: false,
    lib: { entry: "src/index.js", name: "toonflowExts.ext-producerStudio", formats: ["umd"], fileName: () => "ext-producerStudio.umd.js" },
    rolldownOptions: {
      external: ["vue", "@vue/runtime-core", "@vue/runtime-dom"],
      output: { exports: "default", codeSplitting: false, globals: {
        vue: "toonflowExtHost.vue",
        "@vue/runtime-core": "toonflowExtHost.vue",
        "@vue/runtime-dom": "toonflowExtHost.vue"
      }}
    }
  }
});
