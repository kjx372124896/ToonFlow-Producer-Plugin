import Studio from "./Studio.vue";
export default {
  id: "ext-producerStudio",
  displayName: "短剧制片中心",
  extensions: ["tfprod"],
  resourceKind: "file",
  text: true,
  load: async () => ({ default: Studio })
};
