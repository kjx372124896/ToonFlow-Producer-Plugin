import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = join(root, "dist", "producerStudioNode.umd.js");
const destinationDir = process.env.TOONFLOW_STABLE_NODES || "D:\\toonflow-stable\\data\\nodes";
const destination = join(destinationDir, "producerStudioNode.umd.js");
const archive = join(root, "archive");
const digest = async file => createHash("sha256").update(await readFile(file)).digest("hex");
await stat(source);
await stat(destinationDir);
const built = await readFile(source);
if (!built.toString("utf8", 0, 300).includes("toonflowNode:")) {
  throw new Error("构建结果不符合 ToonFlow 节点插件格式");
}
const sourceHash = await digest(source);
let currentHash;
try { currentHash = await digest(destination); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (currentHash === sourceHash) {
  console.log("目标稳定版插件已是最新，SHA256:", sourceHash);
  process.exit(0);
}
if (currentHash) {
  await mkdir(archive, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(archive, "producerStudioNode-stable-" + stamp + "-" + currentHash.slice(0, 10) + ".umd.js");
  await copyFile(destination, backup);
  if (await digest(backup) !== currentHash) throw new Error("旧插件备份校验失败，终止更新");
  console.log("旧插件已备份:", backup);
}
await copyFile(source, destination);
const installedHash = await digest(destination);
if (installedHash !== sourceHash) throw new Error("部署后 SHA256 不一致，请检查目标文件");
console.log("稳定版插件已更新:", destination);
console.log("SHA256:", installedHash);
console.log("请保存工作区并重新启动 ToonFlow，以确保已加载新的插件代码");
