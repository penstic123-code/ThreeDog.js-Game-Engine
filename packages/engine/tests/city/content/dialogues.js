// Dialogues: each starts at the start node. Syntax: see packages/engine/examples/world/content/dialogues.js and packages/engine/modules/content/rules.js.
export default {
  shopkeeper: {
    speaker: '店主',
    nodes: {
      start: { text: '欢迎来到小城。这个街区是关卡模块从场景里读出来的，没有地形模块。' },
    },
  },
};
