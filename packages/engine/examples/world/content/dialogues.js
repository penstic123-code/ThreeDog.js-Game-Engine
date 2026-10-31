// Dialogues: each starts at the start node. next points to the next node ('end' finishes); choices are the options;
// if is a condition, do is an effect (syntax in packages/engine/modules/content/rules.js; timeAfter is a word this game adds, see its rules.js); text may be several variants, the first whose condition holds is used.
export default {
  fisher: {
    speaker: '老渔夫',
    nodes: {
      start: {
        text: [
          { if: { flag: 'metFisher', timeAfter: '17:00' }, text: '又见面了。这会儿的光最好，快去拍吧。' },
          { if: { flag: 'metFisher' }, text: '又见面了。今天拍到好照片了吗？' },
          { text: '哟，背着相机的年轻人。很少有人走到这边来。' },
        ],
        do: { setFlag: 'metFisher' },
        next: 'ask',
      },
      ask: {
        text: '你想拍什么？',
        choices: [
          { text: '日落', next: 'sunset' },
          { text: '森林', next: 'forest' },
          { text: '有胶卷卖吗？', next: 'film', if: { lacks: { film: 6 } } },
          { text: '用胶卷换点野莓', next: 'barter', if: { can: ['barter.buy', { shop: 'fisher-basket', item: 'berry' }] }, do: { op: ['barter.buy', { shop: 'fisher-basket', item: 'berry' }] } },
          { text: '没想好，随便走走', next: 'walk' },
        ],
      },
      sunset: { text: '傍晚五六点，往高处走，太阳会从树梢后面落下去。', next: 'end' },
      forest: { text: '林子里的光早上最好。起风的时候草会晃，别急着按快门。', next: 'end' },
      film: { text: '拿去吧，我年轻时也拍过。', do: { give: { film: 6 } }, next: 'end' },
      barter: { text: '一卷换一把，刚摘的。', next: 'end' },
      walk: { text: '那也不错。慢慢走，路会告诉你该拍什么。', next: 'end' },
    },
  },
};
