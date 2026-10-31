// Quests: steps complete in order, done is the completion condition; startOn is the event that starts the quest automatically; reward is the completion reward.
// target is the step's goal (place name, { place, x, z } or { npc: 'id' }); the screen shows a marker and distance.
export default {
  'first-light': {
    title: '第一缕光',
    desc: '老渔夫说傍晚的光最好看。',
    startOn: 'engine:ready',
    steps: [
      { text: '和老渔夫聊聊（靠近按 E）', done: { flag: 'metFisher' }, target: { npc: 'fisher' } },
      { text: '收集 3 个野莓', done: { has: { berry: 3 } } },
      { text: '在 17:00–19:00 之间拍一张照片（按 P）', done: { counter: { sunsetPhotos: 1 } } },  // main.js bumps this counter when a photo is taken
    ],
    reward: { give: { film: 12 } },
  },
};
