import test from "node:test";
import assert from "node:assert/strict";
import { createLocalCanvasClient } from "../src/localCanvas.mjs";
import { assemblePanels } from "../src/mcp.mjs";

function fakeContext() {
  const logs = [];
  const nodes = new Map();
  const edges = [];
  const handles = {
    textNode: [{ id: "text", type: "source", dataType: "STRING" }],
    imageNode: [{ id: "image", type: "source", dataType: "IMAGE" }],
    imageGenerationNode: [{ id: "in", type: "target", dataType: ["IMAGE", "STRING"] },
      { id: "image", type: "source", dataType: "IMAGE" }],
    videoGenerationNode: [{ id: "in", type: "target", dataType: ["IMAGE", "STRING", "VIDEO", "AUDIO"] },
      { id: "video", type: "source", dataType: "VIDEO" }],
    audioNode: [{ id: "audio", type: "source", dataType: "AUDIO" }],
    runninghubWorkflowNode: [{ id: "in", type: "target", dataType: ["IMAGE", "STRING", "VIDEO", "AUDIO"] },
      { id: "image", type: "source", dataType: "IMAGE" },
      { id: "video", type: "source", dataType: "VIDEO" },
      { id: "audio", type: "source", dataType: "AUDIO" }]
  };
  let version = "canvas-A";
  const ctx = {
    get id() { return version; },
    async call({ name, args }) {
      logs.push({ name, args });
      if (name === "getCanvas") return {
        id: version,
        availableNodeTypes: Object.keys(handles).map(type => ({ type: "remote-" + type, label: type })),
        nodes: [...nodes.values()]
      };
      if (name === "addNode") {
        const node = { id: "node-" + (nodes.size + 1), type: args.type,
          data: { label: args.label, handles: handles[args.type.replace(/^remote-/, "")] } };
        nodes.set(node.id, node);
        return { node };
      }
      if (name === "nodeTools") {
        const target=nodes.get(args.nodeId);
        if(args.name==="node:getConfig") {
          const kind=target?.type==="remote-videoGenerationNode"?"video":"image";
          const available=kind==="image" ? [{providerId:"imgProvider",modelId:"image-v1"}] :
            [{providerId:"videoProvider",modelId:"video-v2"}];
          return {config: {providerId:target?.data.providerId||"",modelId:target?.data.modelId||""},models:available};
        }
        if(args.name==="node:setConfig") {
          target.data.providerId=args.args.providerId;
          target.data.modelId=args.args.modelId;
          return {config:{providerId:args.args.providerId,modelId:args.args.modelId}};
        }
        return {ok:true};
      }
      if (name === "connectNodes") {
        edges.push(...args.connections);
        return { count: args.connections.length };
      }
      throw new Error("未模拟能力 " + name);
    }
  };
  return { provider: () => ctx, logs, nodes, edges, changeCanvas(value) { version = value; } };
}
test("插件直接绑定所在画布，不依赖 MCP URL/凭证", async () => {
  const sim = fakeContext();
  const client = createLocalCanvasClient(sim.provider);
  const current = await client.tool("getCanvas", {});
  assert.equal(client.canvasId, "canvas-A");
  assert.equal(current.id, "canvas-A");
  assert.equal(sim.logs[0].name, "getCanvas");
});
test("经所在画布真实操作契约执行：节点建立、图片素材、连线及重入", async () => {
  const sim = fakeContext();
  const client = createLocalCanvasClient(sim.provider);
  const panel = { shot: "1-01", excerpt: "甲走进教室", prompt: "中景", assetIds: ["asset-x"], canvasBindings: null };
  const args = { client, panels: [panel], assets: [{ id: "asset-x", name: "甲", kind: "角色",
    imagePath: "producer-assets/p/asset.png", mimeType: "image/png" }],
    project: { visualManual: "现代写实", directorManual: "连续镜头", aspectRatio: "9:16" }, onSaved: () => {} };
  const result = await assemblePanels(args);
  assert.equal(result.canvasId, "canvas-A");
  assert.equal(result.imported, 1);
  assert.equal(sim.nodes.size, 4);
  assert.ok([...sim.nodes.values()].every(n => n.type.startsWith("remote-")), "节点应使用 ToonFlow 原生 remote-* 类型");
  assert.equal(sim.edges.length, 3);
  assert.ok(sim.logs.some(x => x.name === "nodeTools" && x.args.name === "node:setImage"));
  await assemblePanels(args);
  assert.equal(sim.nodes.size, 4);
  assert.equal(sim.edges.length, 3);
});
test("图片 RH + 视频 RH 直接装配，文本始终是模型文本节点", async () => {
  const sim=fakeContext();
  const client=createLocalCanvasClient(sim.provider);
  const panel={shot:"2-01",excerpt:"林月走进餐厅",prompt:"推镜",assetIds:[],canvasBindings:null};
  const cfg={client,panels:[panel],assets:[],project:{
    aspectRatio:"9:16",visualManual:"现代都市",directorManual:"快节奏",
    generation:{text:{mode:"rh"},image:{mode:"rh",rhAppUid:"rh-img"},video:{mode:"rh",rhAppUid:"rh-vid"}}
  },onSaved(){}};
  const result=await assemblePanels(cfg);
  assert.equal(result.imported,1);
  assert.equal(sim.nodes.size,4,"文本节点、两 RH 节点和独立视频提示词");
  const types=[...sim.nodes.values()].map(n=>n.type);
  assert.equal(types.filter(x=>x==="remote-textNode").length,2);
  assert.equal(types.filter(x=>x==="remote-runninghubWorkflowNode").length,2);
  assert.equal(sim.edges.length,3);
  const selection=sim.logs.filter(x=>x.name==="nodeTools" && x.args.name==="node:selectRunningHubApplication");
  assert.deepEqual(selection.map(x=>x.args.args.uid).sort(),["rh-img","rh-vid"]);
  assert.ok(sim.logs.every(x=>!(x.name==="nodeTools"&&x.args.name==="node:setPrompt")));
  await assemblePanels(cfg);
  assert.equal(sim.nodes.size,4);
  assert.equal(sim.edges.length,3);
});
test("已有模型节点不能静默重用为 RH 节点", async () => {
  const sim=fakeContext(),client=createLocalCanvasClient(sim.provider);
  const panel={shot:"1-01",excerpt:"测试",prompt:"测试",assetIds:[],
    canvasBindings:{canvasId:"canvas-A",imageMode:"model",videoMode:"model",imageId:"existing",connections:[],assetNodes:{}}};
  await assert.rejects(assemblePanels({client,panels:[panel],assets:[],project:{
    aspectRatio:"9:16",generation:{image:{mode:"rh",rhAppUid:"rh-img"},video:{mode:"model"}}
  }}),/生成方式已变化/);
  assert.equal(sim.nodes.size,0);
});
test("项目选择的文本/图片/视频默认模型写入真实节点并验证", async () => {
  const sim=fakeContext();
  const setTextNodeModel=(nodeId,providerId,modelId)=>{
    const node=sim.nodes.get(nodeId);
    assert.equal(node?.type,"remote-textNode");
    node.data.model=JSON.stringify([providerId,modelId]);
    return {nodeId,model:node.data.model};
  };
  const client=createLocalCanvasClient(sim.provider,{setTextNodeModel});
  const cfg={
    text:{mode:"model",model:JSON.stringify(["txtProvider","text-v3"])},
    image:{mode:"model",model:JSON.stringify(["imgProvider","image-v1"])},
    video:{mode:"model",model:JSON.stringify(["videoProvider","video-v2"])}
  };
  const panel={shot:"01",excerpt:"镜头",prompt:"推进",assetIds:[],canvasBindings:null};
  await assemblePanels({client,panels:[panel],assets:[],project:{aspectRatio:"9:16",generation:cfg}});
  const nodes=[...sim.nodes.values()];
  assert.equal(nodes.find(n=>n.type==="remote-textNode")?.data.model,JSON.stringify(["txtProvider","text-v3"]));
  assert.deepEqual(
    nodes.filter(n=>n.type==="remote-imageGenerationNode"||n.type==="remote-videoGenerationNode")
      .map(n=>n.data.modelId).sort(),
    ["image-v1","video-v2"]
  );
  const selected=sim.logs.filter(x=>x.name==="nodeTools"&&x.args.name==="node:setConfig");
  assert.equal(selected.length,2);
  await assemblePanels({client,panels:[panel],assets:[],project:{aspectRatio:"9:16",generation:cfg}});
  assert.equal(sim.nodes.size,3,"重复装配仅更新指定模型，不重复新建节点");
});
test("文本已选择模型但宿主画布不支持写入时显式失败", async()=>{
  const sim=fakeContext(),client=createLocalCanvasClient(sim.provider);
  const panel={shot:"01",excerpt:"文字",prompt:"近景",assetIds:[],canvasBindings:null};
  await assert.rejects(()=>assemblePanels({client,panels:[panel],assets:[],project:{
    generation:{text:{mode:"model",model:JSON.stringify(["p","m"])}}
  }}),/文本模型写入接口不可用/);
});
test("音频默认关闭：旧项目装配无需新增音频节点", async()=>{
  const sim=fakeContext(),client=createLocalCanvasClient(sim.provider);
  await assemblePanels({client,panels:[{shot:"01",excerpt:"旁白",prompt:"",assetIds:[],canvasBindings:null}],assets:[],project:{generation:{}}});
  assert.equal(sim.nodes.size,3);
  assert.equal([...sim.nodes.values()].filter(n=>n.type==="remote-audioNode").length,0);
});
test("音频 RH 装配：独立文案、音频工作流及视频音频连线，重复装配不重复创建", async()=>{
  const sim=fakeContext(),client=createLocalCanvasClient(sim.provider);
  const panel={shot:"03",excerpt:"旁白：今天的故事开始",prompt:"",assetIds:[],canvasBindings:null};
  const args={client,panels:[panel],assets:[],project:{generation:{audio:{mode:"rh",rhAppUid:"rh-audio"}}}};
  await assemblePanels(args);
  assert.equal(sim.nodes.size,5);
  assert.equal(sim.edges.length,4);
  const audioId=panel.canvasBindings.audioId;
  assert.equal(sim.nodes.get(audioId).type,"remote-runninghubWorkflowNode");
  assert.ok(sim.logs.some(x=>x.name==="nodeTools" && x.args.name==="node:selectRunningHubApplication" && x.args.args.uid==="rh-audio"));
  assert.ok(sim.edges.some(x=>x.source===audioId&&x.sourceHandle==="audio"&&x.target===panel.canvasBindings.videoId));
  await assemblePanels(args);
  assert.equal(sim.nodes.size,5);
  assert.equal(sim.edges.length,4);
});
test("没有音频生成节点时，选择音频模型明确阻止装配且不创建任何节点",async()=>{
  const sim=fakeContext(),client=createLocalCanvasClient(sim.provider);
  await assert.rejects(()=>assemblePanels({client,panels:[{shot:"01",excerpt:"",prompt:"",assetIds:[]}],assets:[],project:{
    generation:{audio:{mode:"model"}}
  }}),/只有音频素材节点 audioNode/);
  assert.equal(sim.nodes.size,0);
});
test("音频选择 RH 却没有应用 UID 时不修改画布",async()=>{
  const sim=fakeContext(),client=createLocalCanvasClient(sim.provider);
  await assert.rejects(()=>assemblePanels({client,panels:[],assets:[],project:{
    generation:{audio:{mode:"rh"}}
  }}),/RH 音频应用/);
  assert.equal(sim.nodes.size,0);
});
test("跨画布切换时拒绝继续写入，保护原项目", async () => {
  const sim = fakeContext();
  const client = createLocalCanvasClient(sim.provider);
  sim.changeCanvas("canvas-B");
  await assert.rejects(client.tool("addNode", { type: "textNode" }), /画布已切换/);
  assert.equal(sim.nodes.size, 0);
});
test("没有节点所在画布上下文时给出直接错误，不尝试远程连接", () => {
  assert.throws(() => createLocalCanvasClient(undefined), /未获得画布控制接口/);
  assert.throws(() => createLocalCanvasClient(() => null), /上下文尚未准备好/);
});
