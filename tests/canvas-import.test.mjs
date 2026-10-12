import test from "node:test";
import assert from "node:assert/strict";
import { assemblePanels } from "../src/mcp.mjs";
import { createLocalCanvasClient } from "../src/localCanvas.mjs";

// 模拟用户实际使用的 toonflow-stable 画布 3.0 接口：
// getCanvas 默认只返回概览；nodeTypes、节点、连线及函数分别查询。
function host() {
  const nodes = new Map(), edges = [], calls = [], visits = new Map();
  const ports = {
    "remote-videoGenerationNode": [{ id: "in", type: "target", dataType: ["IMAGE", "STRING"] }],
    "remote-imageNode": [{ id: "image", type: "source", dataType: "IMAGE" }],
    "remote-textNode": [{ id: "text", type: "source", dataType: "STRING" }],
    "remote-runninghubWorkflowNode": [{ id: "in", type: "target", dataType: ["STRING", "IMAGE"] }]
  };
  const exposed = {
    "remote-videoGenerationNode": ["setPrompt", "getConfig", "setConfig"],
    "remote-imageNode": ["setImage"],
    "remote-textNode": ["setText"],
    "remote-runninghubWorkflowNode": ["selectRunningHubApplication"]
  };
  const getCanvas = args => {
    const overview = { id: "canvas-A", totalNodes: nodes.size, totalEdges: edges.length };
    if (args.include?.includes("nodeTypes")) {
      return { ...overview, availableNodeTypes: Object.keys(ports).map(type => ({ type, label: type })) };
    }
    assert.deepEqual(args, {}, "默认概览不能意外返回节点、函数或可用类型");
    return overview;
  };
  const context = { id: "canvas-A", async call({ name, args }) {
    calls.push({ name, args });
    if (name === "getCanvas") return getCanvas(args);
    if (name === "getCanvasNodes") {
      assert.ok(args.nodeIds?.length && args.fields?.length, "仅按 ID 读取所需字段");
      const absent = args.nodeIds.find(id => !nodes.has(id));
      if (absent) throw new Error("节点不存在：" + absent);
      return { nodes: args.nodeIds.map(id => {
        const node = nodes.get(id);
        return { id, type: node.type, ...(args.fields.includes("ports") ? { ports: node.data.handles } : {}) };
      }) };
    }
    if (name === "getCanvasEdges") {
      return { edges: edges.filter(edge =>
        !args.nodeIds?.length || args.nodeIds.includes(edge.source) || args.nodeIds.includes(edge.target)) };
    }
    if (name === "getNodeTools") {
      const nodeTools = args.nodeIds.flatMap(id => {
        const target = nodes.get(id);
        if (!target) return [];
        visits.set(id, (visits.get(id) || 0) + 1);
        if (visits.get(id) < 3) return [];
        return exposed[target.type].map(name => ({ nodeId: id, name: "node:" + name }))
          .filter(tool => !args.names?.length || args.names.includes(tool.name));
      });
      return { nodeTools };
    }
    if (name === "addNode") {
      assert.ok(ports[args.type], "节点类型来自 availableNodeTypes");
      const id = "node-" + (visits.size + 1);
      const node = { id, type: args.type, data: { label: args.label, handles: ports[args.type] } };
      nodes.set(id, node);
      return { node, nodeTools: [] };
    }
    if (name === "nodeTools") {
      const target = nodes.get(args.nodeId);
      assert.ok(target, "被调用的节点必须真实存在于画布");
      assert.ok(visits.get(args.nodeId) >= 3, "工具必须等组件注册后再执行");
      assert.ok(exposed[target.type].includes(args.name.slice(5)), "仅执行节点注册的函数");
      if (args.name === "node:setPrompt") target.data.prompt = args.args.prompt;
      if (args.name === "node:setImage") target.data.image = args.args.path;
      if (args.name === "node:setText") target.data.text = args.args.text;
      if (args.name === "node:selectRunningHubApplication") target.data.rhUid = args.args.uid;
      if (args.name === "node:getConfig") return {
        config: { providerId: target.data.providerId || "", modelId: target.data.modelId || "" },
        models: [{ providerId: "videoProv", modelId: "video-v1" }]
      };
      if (args.name === "node:setConfig") {
        target.data.providerId = args.args.providerId;
        target.data.modelId = args.args.modelId;
      }
      return { ok: true };
    }
    if (name === "fitCanvas") {
      assert.ok(args.nodeIds.length > 0 && args.nodeIds.every(id => nodes.has(id)));
      return { fitted: true };
    }
    if (name === "connectNodes") {
      for (const edge of args.connections) {
        const s = nodes.get(edge.source), t = nodes.get(edge.target);
        assert.ok(s && t, "连线两端节点真实存在");
        edges.push(edge);
      }
      return { edges: args.connections };
    }
    throw new Error("unexpected command: " + name);
  }};
  return {
    nodes, edges, calls,
    client: createLocalCanvasClient(() => context),
    removeNode(id) {
      nodes.delete(id);
      const remain = edges.filter(edge => edge.source !== id && edge.target !== id);
      edges.splice(0, edges.length, ...remain);
    }
  };
}

test("分镜板放入画布：严格 getCanvas 参数、延迟工具注册、真实创建与重入", async () => {
  const sim = host();
  const asset = { id: "a1", name: "林月", defaultImageId: "im1", images: [{ id: "im1", path: "assets/a.png", mimeType: "image/png" }] };
  const panel = { id: "b1", boardNo: 1, shot: "1-01", selected: true,
    videoPrompt: "林月走进教室", assetIds: ["a1"], canvasBindings: null };
  const opts = { client: sim.client, panels: [panel], assets: [asset],
    project: { aspectRatio: "9:16", generation: { video: { mode: "model" } } }, boardOnly: true };
  const result = await assemblePanels(opts);
  assert.equal(result.imported, 1);
  assert.equal(sim.nodes.size, 2);
  assert.equal(sim.edges.length, 1);
  assert.ok(sim.calls.some(call => call.name === "fitCanvas"), "放入后应自动定位到新节点");
  assert.equal(panel.canvasBindings.completed, true);
  assert.equal(sim.nodes.get(panel.canvasBindings.videoId).data.prompt.includes("林月走进教室"), true);
  assert.equal(sim.nodes.get(panel.canvasBindings.assetNodes.a1).data.image, "assets/a.png");

  await assemblePanels(opts);
  assert.equal(sim.nodes.size, 2, "重复放入不新建");
  assert.equal(sim.edges.length, 1, "重复放入不重复连线");

  sim.removeNode(panel.canvasBindings.videoId);
  await assemblePanels(opts);
  assert.equal(sim.nodes.size, 2, "删除后的绑定能够自愈");
  assert.equal(sim.edges.length, 1, "缺失连线重新创建");
  assert.equal(panel.canvasBindings.completed, true);
});

test("稳定版画布 v3：RH 视频应用与文本提示词节点能够放入并连线", async () => {
  const sim = host();
  const panel = { id: "rh-1", boardNo: 2, shot: "2-01", videoPrompt: "画面中人物回头", assetIds: [], canvasBindings: null };
  const result = await assemblePanels({
    client: sim.client, panels: [panel], assets: [],
    project: { generation: { video: { mode: "rh", rhAppUid: "rh-video-test" } } },
    boardOnly: true
  });
  assert.equal(result.imported, 1);
  assert.equal(sim.nodes.size, 2);
  assert.equal(sim.edges.length, 1);
  assert.equal(sim.nodes.get(panel.canvasBindings.videoId).data.rhUid, "rh-video-test");
  assert.ok(sim.nodes.get(panel.canvasBindings.videoPromptId).data.text.includes("画面中人物回头"));
  assert.equal(panel.canvasBindings.completed, true);
});

test("稳定版画布 v3：默认视频模型的 getConfig/setConfig 可用且写入后校验", async () => {
  const sim = host();
  const panel = { shot: "3-01", videoPrompt: "画面", assetIds: [], canvasBindings: null };
  const cfg = { client: sim.client, panels: [panel], assets: [], boardOnly: true,
    project: { generation: { video: { mode: "model", model: JSON.stringify(["videoProv", "video-v1"]) } } } };
  await assemblePanels(cfg);
  assert.equal(sim.nodes.get(panel.canvasBindings.videoId).data.modelId, "video-v1");
  assert.equal(panel.canvasBindings.completed, true);
  await assemblePanels(cfg);
  assert.equal(sim.nodes.size, 1);
});

test("无法创建节点时不显示装配成功", async () => {
  const sim = host();
  const panel = { shot: "1-01", assetIds: [], videoPrompt: "镜头" };
  const client = { async tool(name, args) {
    if (name === "addNode") throw new Error("宿主拒绝创建节点");
    return sim.client.tool(name, args);
  }};
  await assert.rejects(assemblePanels({
    client, panels: [panel], assets: [], project: {}, boardOnly: true
  }), /宿主拒绝创建节点/);
  assert.equal(panel.canvasBindings.completed, false);
  assert.equal(sim.nodes.size, 0);
});
