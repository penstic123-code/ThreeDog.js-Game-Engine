// URL parameters of the perf island page. Import this file first in main.js: it rewrites word values into the forms the engine's own
// URL state understands (time=dusk -> 18:30, weather=雪 -> snow) before createEngine reads the URL. Same words as the style test page.
//   time     day | dusk | night (白天 黄昏 夜晚), or HH:MM        weather  clear | snow (晴 雪), or any engine weather name
//   view     overview | flock | field | river | rim   (总览 羊群 麦田 河 边缘)
/** @type {Record<string, string>} */
const TIME = { day: '12:00', 白天: '12:00', dusk: '18:30', 黄昏: '18:30', night: '23:00', 夜晚: '23:00' };
/** @type {Record<string, string>} */
const WEATHER = { 晴: 'clear', 雪: 'snow' };
/** @type {Record<string, string>} */
const VIEWS = { 总览: 'overview', 羊群: 'flock', 麦田: 'field', 河: 'river', 边缘: 'rim' };
export const VIEW_NAMES = ['overview', 'flock', 'field', 'river', 'rim'];

const url = new URL(location.href), q = url.searchParams;
let changed = false;
for (const [key, map] of /** @type {[string, Record<string, string>][]} */ ([['time', TIME], ['weather', WEATHER]])) {
  const v = q.get(key);
  if (v && map[v]) { q.set(key, map[v]); changed = true; }
}
if (changed) history.replaceState(null, '', url);

const view = VIEWS[q.get('view')] ?? q.get('view') ?? 'overview';
export const params = Object.freeze({
  view: VIEW_NAMES.includes(view) ? view : 'overview',
  badView: q.has('view') && !VIEW_NAMES.includes(view) ? q.get('view') : null,
});
