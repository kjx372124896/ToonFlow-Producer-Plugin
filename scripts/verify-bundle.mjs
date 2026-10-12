import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const src = readFileSync(new URL("../dist/ext-producerStudio.umd.js", import.meta.url), "utf8");
assert.match(src, /^\/\*! toonflowExt:\{/);
const host = { vue: {} };
const sandbox = { toonflowExtHost: host, window: { toonflowExtHost: host } };
sandbox.self = sandbox;
runInNewContext(src, sandbox, { timeout: 10000 });
const definition = sandbox.toonflowExts?.["ext-producerStudio"]
  || sandbox.window.toonflowExts?.["ext-producerStudio"];
assert.equal(definition?.id, "ext-producerStudio");
assert.equal(definition?.resourceKind, "file");
assert.equal(definition?.text, true);
assert.equal(typeof definition?.load, "function");
const module = await definition.load();
assert.ok(module.default);
console.log("OK: UMD 元数据、插件注册、异步组件入口可读取");
