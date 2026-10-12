import test from "node:test";
import assert from "node:assert/strict";
import { parseStoryboardRows, createStoryboardBoard, buildVideoPromptRequest } from "../src/studio.mjs";

test("专业分镜表解析并将选中镜头合并为一个完整分镜板", () => {
  const script = { id: "script-1", episode: 1, title: "第1集", text: "1-1 客厅 日 内\n△ 甲走入" };
  const assets = [{ id: "asset-1", kind: "角色", name: "甲", imagePath: "assets/a.png" }];
  const rows = parseStoryboardRows(JSON.stringify({ shots: [
    { shotNo: "1-01", duration: 1, shotSize: "全景", action: "甲走入", assetNames: ["甲"] },
    { shotNo: "1-02", duration: 3, shotSize: "中景", action: "甲停下", assetNames: ["甲"] },
    { shotNo: "1-03", duration: 7, shotSize: "特写", action: "甲回头", assetNames: ["甲"] }
  ] }), script, assets);
  rows.forEach(row => { row.selected = true; });
  const board = createStoryboardBoard(rows);
  assert.equal(board.duration, 11);
  assert.deepEqual(board.sourceIds, rows.map(row => row.id));
  assert.deepEqual(board.assets, ["asset-1"]);
  assert.equal(buildVideoPromptRequest(board, assets).shots.length, 3);
});

test("分镜表拒绝不合法时长并绑定已知资产", () => {
  const script = { id: "s", episode: 2, text: "剧本" };
  const assets = [{ id: "a", kind: "场景", name: "客厅" }];
  assert.throws(() => parseStoryboardRows(JSON.stringify({ shots: [{ duration: 13, action: "动作" }] }), script, assets), /1-12秒/);
  const rows = parseStoryboardRows(JSON.stringify({ shots: [{ duration: 2, action: "动作", assetNames: ["客厅", "未知"] }] }), script, assets);
  assert.deepEqual(rows[0].assetIds, ["a"]);
});