import test from "node:test";
import assert from "node:assert/strict";
import { emptyStudio, createProject, splitNovel, eventCandidates, adaptScript, extractAssets,
  buildPanels, parseStudio, parseScriptScenes } from "../src/studio.mjs";
import { pickId, resolveAvailableNodeTypes, assemblePanels } from "../src/mcp.mjs";

test("项目保留比例和手册并可序列化", () => {
  const state = emptyStudio();
  state.project = createProject({ name: "测试短剧", aspectRatio: "16:9", visualManual: "影视",
    directorManual: "人物动作", visualPreset: "真人", directorPreset: "电影" });
  assert.equal(parseStudio(JSON.stringify(state)).project.aspectRatio, "16:9");
  assert.equal(state.project.directorManual, "人物动作");
});
test("自动拆分中文数字章标题并保留对应正文", () => {
  const novel = "第1章 开端\n林月走进餐厅，拿出手机。\n\n第二章 反转\n林月说道：不要这样。";
  const chapters = splitNovel(novel, "原稿.txt");
  assert.equal(chapters.length, 2);
  assert.match(chapters[0].content, /走进餐厅/);
  assert.match(chapters[1].content, /不要这样/);
});
test("无标题小说保留单章，空输入明确错误", () => {
  assert.equal(splitNovel("一个没有章节标记的故事。", "样本.txt").length, 1);
  assert.throws(() => splitNovel("   "), /空/);
});
test("事件→剧本→资产→分镜保留关联关系", () => {
  const chapters = splitNovel("第一章 初识\n林月：这是我的手机。\n林月发现餐厅无人营业。");
  const events = eventCandidates(chapters[0]);
  assert.ok(events.length > 0);
  const scripts = [adaptScript(chapters[0], events, 1)];
  const assets = extractAssets(scripts);
  assert.ok(assets.some(a => a.kind === "角色" && a.name === "林月"));
  assert.ok(assets.some(a => a.kind === "道具" && a.name === "手机"));
  const panels = buildPanels(scripts, assets);
  assert.ok(panels.length > 0);
  assert.equal(panels[0].scriptId, scripts[0].id);
  assert.ok(panels[0].assetIds.every(id => assets.some(a => a.id === id)));
});
test("剧本多场次识别场景头", () => {
  const scenes = parseScriptScenes("1-1 教室 日 内\n△ 林月翻开课本。\n1-2 校园 夜 外\n林月：等等！", 1);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[1].location, "校园");
  assert.equal(scenes[1].time, "夜");
  assert.match(scenes[1].body, /等等/);
});
test("原生 remote-* 节点类型映射精确匹配 ToonFlow", () => {
  const found = resolveAvailableNodeTypes({
    id: "canvas-1",
    availableNodeTypes: [
      {type:"remote-textNode",label:"文本"},
      {type:"remote-imageGenerationNode",label:"图片生成"},
      {type:"remote-videoGenerationNode",label:"视频生成"},
      {type:"remote-imageNode",label:"图片"}
    ]
  });
  assert.equal(found.get("textNode"), "remote-textNode");
  assert.equal(found.get("imageGenerationNode"), "remote-imageGenerationNode");
  assert.equal(found.get("videoGenerationNode"), "remote-videoGenerationNode");
  assert.equal(found.get("imageNode"), "remote-imageNode");
});
test("缺少必需节点时在创建前报告实际类型，不产生半成品", async () => {
  let creations = 0;
  const client = { async tool(name) {
    if (name === "getCanvas") return { id: "canvas-1", availableNodeTypes: [
      { type: "remote-textNode" }, { type: "remote-videoGenerationNode" }
    ] };
    if (name === "addNode") creations++;
    throw new Error("不应该调用：" + name);
  } };
  const panels = [{ shot: "1-01", excerpt: "测试", prompt: "测试", assetIds: [] }];
  await assert.rejects(
    () => assemblePanels({client,panels,assets:[],project:{},onSaved(){}}),
    /imageGenerationNode/
  );
  assert.equal(creations, 0);
  assert.equal(panels[0].canvasBindings, undefined);
});
test("MCP 新建节点响应支持多种 ID 格式", () => {
  assert.equal(pickId({ node: { id: "abc" } }), "abc");
  assert.equal(pickId({ nodeId: "n1" }), "n1");
  assert.throws(() => pickId({}), /节点 ID/);
});


test("模拟官方画布 API：创建文本、参考图、生图、视频节点并自动连线，重复提交不重复新增", async () => {
  const calls = [], nodes = new Map(), edges = [];
  const handles = {
    textNode: [{ id: "text", type: "source", dataType: "STRING" }],
    imageNode: [{ id: "image", type: "source", dataType: "IMAGE" }],
    imageGenerationNode: [{ id: "in", type: "target", dataType: ["IMAGE", "STRING"] },
      { id: "image", type: "source", dataType: "IMAGE" }],
    videoGenerationNode: [{ id: "in", type: "target", dataType: ["IMAGE", "STRING"] },
      { id: "video", type: "source", dataType: "VIDEO" }]
  };
  const client = {
    async tool(name, args) {
      calls.push({ name, args });
      if (name === "getCanvas") return { canvasId: "test-canvas", availableNodeTypes: Object.keys(handles) };
      if (name === "addNode") {
        const id = "node-" + (nodes.size + 1);
        nodes.set(id, { id, type: args.type, ports: handles[args.type] });
        return { node: { id } };
      }
      if (name === "getCanvasNodes") return { nodes: args.nodeIds.map(id => nodes.get(id)) };
      if (name === "nodeTools") return { ok: true };
      if (name === "connectNodes") { edges.push(...args.connections); return { ok: true }; }
      throw new Error("未知模拟调用 " + name);
    }
  };
  const project = { aspectRatio: "9:16", visualManual: "电影摄影", directorManual: "连续动作" };
  const asset = { id: "asset-1", name: "林月", kind: "角色", imagePath: "producer-assets/p/role.png", mimeType: "image/png" };
  const panel = { id: "s-1", shot: "1-01", excerpt: "林月进入餐厅", prompt: "推镜",
    assetIds: [asset.id], selected: true, canvasBindings: null };
  const ctx = { client, panels: [panel], assets: [asset], project, onSaved() {} };
  const first = await assemblePanels(ctx);
  assert.equal(first.imported, 1);
  assert.equal(nodes.size, 4);
  assert.equal(edges.length, 3);
  assert.ok(calls.some(c => c.name === "nodeTools" && c.args.name === "node:setImage" && c.args.args.path === asset.imagePath));
  await assemblePanels(ctx);
  assert.equal(nodes.size, 4);
  assert.equal(edges.length, 3);
});

