import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../node/src/index.vue", import.meta.url)), "utf8");

test("制片中心节点内容宽度与 220px 宿主外壳一致，不再产生横向溢出", () => {
  assert.match(source, /\.studio-node-card\s*\{[^}]*width:100%;[^}]*max-width:100%;[^}]*min-width:0;/);
  assert.doesNotMatch(source, /\.studio-node-card\s*\{[^}]*width:280px/);
  assert.match(source, /\.studio-node-name\s*\{[^}]*min-width:0/);
  assert.match(source, /\.studio-open-btn\s*\{[^}]*width:100%;[^}]*min-width:0;[^}]*box-sizing:border-box/);
});

test("紧凑节点保留项目名、三项统计、打开制片中心操作及标题提示", () => {
  assert.match(source, /:title="projectTitle"/);
  assert.match(source, /projectStats\.chapters/);
  assert.match(source, /projectStats\.scripts/);
  assert.match(source, /projectStats\.panels/);
  assert.match(source, /@click\.stop="openStudio"/);
  assert.match(source, /<Studio v-else class="producer-node-main"/);
});
