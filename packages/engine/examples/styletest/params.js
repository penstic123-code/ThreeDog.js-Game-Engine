// URL parameters of the style test page. Import this file first in main.js: it rewrites word values into the forms the engine's own
// URL state understands (time=dusk -> 18:30, weather=雨 -> rain) before createEngine reads the URL.
//   time     day | dusk | night, or HH:MM         weather  clear | rain | snow (晴 雨 雪), or any engine weather name
//   env      1 = environment lighting from the sky (default 0)
//   view     overview | character | water | room | path | ui   (总览 角色特写 水面 室内 移动镜头路径 界面)
//   panel    1 = the dev panel, @threedog/tools/panel (needs the tweakpane dev package)
/** @type {Record<string, string>} */
const TIME = { day: '12:00', 白天: '12:00', dusk: '18:30', 黄昏: '18:30', night: '23:00', 夜晚: '23:00' };
/** @type {Record<string, string>} */
const WEATHER = { 晴: 'clear', 雨: 'rain', 雪: 'snow' };
/** @type {Record<string, string>} */
export const VIEWS = { 总览: 'overview', 角色特写: 'character', 水面: 'water', 室内: 'room', 移动镜头路径: 'path', 界面: 'ui' };
export const VIEW_NAMES = ['overview', 'character', 'water', 'room', 'path', 'ui'];

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
  env: q.get('env') === '1',
  panel: q.get('panel') === '1',
  badView: q.has('view') && !VIEW_NAMES.includes(view) ? q.get('view') : null,
});
