// The first line of an error message, shortened for a one-line summary (the relay's repeat line, `threedog errors`, play / verify / wait results).
// Why elide from the middle instead of truncating the tail: engine errors put the requirement and the code at the end of the sentence ("…ending at 1, no time repeated; got times [0, …, 0.88] [sky-option]"),
// truncating cuts off exactly the "how to fix" (one playtest was left with only "…rows s"). Keep head and tail, replace the middle with …. No imports: the vite relay loads it too.
/** Longest summary line; engine messages are one sentence and fit */
export const ONE_LINE_MAX = 400;
/** First line of text; longer than max keeps the start and the end, joined by " … " */
export function oneLine(text, max = ONE_LINE_MAX) {
  const l = String(text ?? '').split('\n')[0];
  if (l.length <= max) return l;
  const end = Math.floor((max - 3) / 2);
  return l.slice(0, max - 3 - end) + ' … ' + l.slice(-end);
}
