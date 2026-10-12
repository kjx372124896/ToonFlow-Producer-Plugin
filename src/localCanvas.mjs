// ToonFlow 画布节点内部适配器：优先使用宿主 inject("canvas") 暴露的 CanvasContext。
// 所有操作经过宿主 call：保留其节点验证、连线校验、画布持久化和目标隔离。
// 不需要 MCP、HTTP、Bearer token，也绝不直接编辑画布 JSON。
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createLocalCanvasClient(provider, adapters = {}) {
  if (typeof provider !== "function") throw new Error("当前节点未获得画布控制接口，请确认是在 ToonFlow 无限画布内打开");
  const initial = provider();
  if (!initial?.id || typeof initial.call !== "function") throw new Error("当前画布上下文尚未准备好，请等待加载后重试");
  const canvasId = initial.id;

  function context() {
    const ctx = provider();
    if (!ctx || ctx.id !== canvasId || typeof ctx.call !== "function") {
      throw new Error("制片过程中画布已切换或关闭，为防止写错画布已停止操作");
    }
    return ctx;
  }

  async function call(name, args) {
    return context().call({ name, args });
  }

  async function getNodes(args) {
    const ids = args.nodeIds;
    const needsPorts = args.fields?.includes("ports");
    for (let i = 0; i < (needsPorts ? 35 : 1); i++) {
      const snapshot = await call("getCanvas", {});
      // 兼容当前本地版直接返回 nodes，以及新版只返回概览的分页查询。
      const detail = Array.isArray(snapshot.nodes) ? snapshot.nodes
        : (await call("getCanvasNodes", { canvasId, nodeIds: ids, fields: ["ports"] })).nodes || [];
      const nodes = ids.map(id => detail.find(n => (n.id || n.nodeId) === id)).filter(Boolean)
        .map(n => ({ id: n.id || n.nodeId, type: n.type, label: n.data?.label ?? n.label,
          ports: n.ports || n.data?.handles || n.handles || [] }));
      // 仅查询类型时，允许返回空列表（旧绑定可能已经被用户删除）。
      if (!needsPorts || (nodes.length === ids.length && nodes.every(n => n.ports.length))) {
        return { nodes };
      }
      if (i !== 34) await pause(120);
    }
    throw new Error("画布节点端口尚未就绪，请稍后重试（不会重复创建已记录的节点）");
  }

  async function invokeRegisteredTool(args) {
    // 刚创建的节点可能尚未完成 setup/onMounted 和素材文件初始化；
    // 仅允许重试这一类“未就绪”异常，其他错误立即中止，避免重复执行生成操作。
    for (let i = 0; i < 45; i++) {
      try { return await call("nodeTools", args); }
      catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!/未注册|未就绪|尚未加载|尚未准备|已卸载|not registered|not ready|not loaded/i.test(msg) || i === 44) throw error;
        await pause(120);
      }
    }
  }

  return {
    canvasId,
    async tool(name, args = {}) {
      if (name === "setTextNodeModel") {
        context(); // 强制检查操作绑定在同一个画布上
        if (typeof adapters.setTextNodeModel !== "function") throw new Error("文本模型写入接口不可用，请更新制片节点插件");
        const output=await adapters.setTextNodeModel(args.nodeId, args.providerId, args.modelId);
        context();
        return output;
      }
      if (name === "getCanvasNodes") return getNodes(args);
      if (name === "getNodeTools") {
        const snapshot = await call("getCanvas", {});
        if (Array.isArray(snapshot.nodeTools)) {
          return { nodeTools: snapshot.nodeTools.filter(tool =>
            args.nodeIds.includes(tool.nodeId) && (!args.names || args.names.includes(tool.name))) };
        }
        return call("getNodeTools", args);
      }
      if (name === "getCanvasEdges") {
        const snapshot = await call("getCanvas", {});
        if (Array.isArray(snapshot.edges)) {
          return { edges: snapshot.edges.filter(edge =>
            !args.nodeIds?.length || args.nodeIds.includes(edge.source) || args.nodeIds.includes(edge.target)) };
        }
        return call("getCanvasEdges", args);
      }
      if (name === "nodeTools") return invokeRegisteredTool(args);
      return call(name, args);
    }
  };
}
