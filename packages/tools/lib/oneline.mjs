// The first line of an error message, shortened for a one-line summary (the relay's repeat line, `threedog errors`, play / verify / wait results).
// 为什么从中间省略而不是截尾：引擎报错把要求和代码写在句尾（"…ending at 1, no time repeated; got times [0, …, 0.88] [sky-option]"），
// 截尾正好把"怎么改"截掉了（一次试玩里只剩 "…rows s"）。保留开头和结尾，中间用 … 代替。No imports: the vite relay loads it too.
/** Longest summary line; engine messages are one sentence and fit */
export const ONE_LINE_MAX = 400;
/** First line of text; longer than max keeps the start and the end, joined by " … " */
export function oneLine(text, max = ONE_LINE_MAX) {
  const l = String(text ?? '').split('\n')[0];
  if (l.length <= max) return l;
  const end = Math.floor((max - 3) / 2);
  return l.slice(0, max - 3 - end) + ' … ' + l.slice(-end);
}
