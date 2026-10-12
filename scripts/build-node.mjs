import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const app = resolve(root, "..", "Toonflow-app");
const vite = resolve(app, "packages", "nodeScaffold", "node_modules", "vite", "bin", "vite.js");
const target = resolve(root, "node", "vite.config.ts");
const built = resolve(app, "build", "nodes", "producerStudioNode.umd.js");
const dist = resolve(root, "dist");
try { await stat(vite); } catch { throw new Error("找不到官方节点脚手架的 Vite。请确认 Toonflow-app 已安装依赖。"); }
const result = spawnSync(process.execPath, [vite, "build", "--config", target], {
  cwd: resolve(root, "node"), env: { ...process.env, NODE_ENV: "production" },
  stdio: "inherit"
});
if (result.error || result.status !== 0) throw result.error || new Error("Node scaffold build failed");
await mkdir(dist, { recursive: true });
for (const oldName of ["ext-producerStudio.umd.js", "producerStudio.umd.js"]) {
  const legacy = resolve(dist, oldName);
  try {
    await stat(legacy);
    await mkdir(resolve(root, "archive"), { recursive: true });
    await rename(legacy, resolve(root, "archive", oldName));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
await copyFile(built, resolve(dist, "producerStudioNode.umd.js"));
console.log("已构建可安装节点：", resolve(dist, "producerStudioNode.umd.js"));
