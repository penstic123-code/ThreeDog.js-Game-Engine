// threedog how "<task>": keyword search over AI.md rows, recipe headings and the plain three.js answers (THREE.md, recipe 54), offline, no browser.
// Why a unit test: the ranking must be deterministic and must not match inside other words ("rain" in "terrain"), or the top hit sends an AI to the
// wrong recipe; and a task three.js does on its own (tone mapping, a render target) must answer with the three.js way first, not an engine wrapper.
import { join } from 'node:path';
import { ENGINE } from '../paths.mjs';
import { search } from '../how.mjs';

export const name = 'how: offline doc search is deterministic, matches word starts only, plain three.js first (English task words)';

export async function run({ check }) {
  const docs = join(ENGINE, 'docs');
  const rain = search(docs, 'rain'), again = search(docs, 'rain');
  check('"rain" finds the weather recipe in the top 3 and never terrain', rain.slice(0, 3).some(h => /weather/.test(h.line)) && !rain.some(h => /28-terrain/.test(h.line)), JSON.stringify(rain.map(h => h.line)));
  check('same query twice gives the same list', JSON.stringify(rain) === JSON.stringify(again));
  check('a hit names a recipe path, an AI.md row or THREE.md, at most 5', rain.length <= 5 && rain.every(h => /recipes\/|AI\.md|THREE\.md/.test(h.line)));
  check('English task words find the look rows (brush strokes, colored shadows)', search(docs, 'brush strokes').length > 0 && search(docs, 'colored shadows').length > 0);
  check('nonsense gives no hit', search(docs, 'qqzzxx').length === 0);
  const tone = search(docs, 'tone mapping'), rt = search(docs, 'mirror render target'), bvh = search(docs, 'raycast');
  check('"tone mapping" answers with the plain three.js row first (recipe 54: set renderer.toneMapping)', /^plain three\.js .*toneMapping.*54-three-idioms/.test(tone[0]?.line ?? ''), JSON.stringify(tone.map(h => h.line)));
  check('"mirror render target" answers with the plain three.js row first', /^plain three\.js · Render targets/.test(rt[0]?.line ?? ''), JSON.stringify(rt.map(h => h.line)));
  check('THREE.md is indexed: "raycast" finds the page-wide BVH change', bvh.some(h => /THREE\.md/.test(h.line) && /raycast/i.test(h.line)), JSON.stringify(bvh.map(h => h.line)));
  check('the engine route stays in the list: at most 3 plain hits', [rain, tone, rt, bvh, search(docs, 'fog')].every(r => r.filter(h => h.line.startsWith('plain three.js')).length <= 3));
  // 时间归 calendar、天空只画：第一条是 engine.calendar（06），画天空的 08 紧跟在前三，都在 plain three.js 之前
  const dn = search(docs, 'day night').map(h => h.line), firstPlain = dn.findIndex(l => l.startsWith('plain three.js'));
  check('"day night" answers with the engine route: calendar first (time), the sky recipe in the top 3 (drawing), both before plain three.js',
    /engine\.calendar/.test(dn[0] ?? '') && /06-clock-events/.test(dn[0] ?? '') && dn.slice(0, 3).some(l => /08-weather-sky/.test(l)) && (firstPlain === -1 || firstPlain >= 2), JSON.stringify(dn));
  // [守] 一件事一个入口：常见任务用平常话问，第一条必须是那一个推荐入口（CONVENTIONS.md "One task, which entry"），技巧示例只能排在后面。
  // 不过时改文档关键词（AI.md 行、THREE.md、菜谱标题），不改这里的期望
  const TASKS = [
    ['make windows glow at night', /look\.materials\.glow/],
    ['close a dialogue', /close a dialogue/],
    ['pick a dialogue choice', /Pick a dialogue choice/],
    ['teleport the player in a test', /applyState\(\{ pos \}\)/],
    ['teleport the player far away', /stream\.teleport/],
    ['set the time of day', /engine\.calendar/],
    ['day night cycle', /engine\.calendar/],
    ['seasons', /engine\.calendar/],
    ['speed up time', /engine\.mod\('clock\.rate'/],
    ['timer after 3 seconds', /engine\.clock \(after/],
    ['bullet time on enemies', /engine\.mod/],
    ['add a fixed camera', /fixedCamera/],
    ['switch camera at runtime', /setCamera/],
    ['third person camera', /followCamera/],
    ['soft shadows under props', /ao\.enabled/],
    ['ambient occlusion in a code-built model', /bakeVertexAO/],
    ['wet road after rain', /engine\.weather/],
    ['puddles', /engine\.weather/],
    ['many torches', /lightPool/],
    ['change the sun intensity', /look\.<part>\.set/],
    ['environment lighting reflections', /look\.env/],
    ['baked light probes', /bakeProbes/],
    ['bloom', /post-effects/],
    ['add a post processing pass', /look\.post\.add/],
    ['tone mapping', /toneMapping/],
    ['save game', /saves\.register/],
    ['pathfinding', /findPath/],
    ['pick up items', /engine\.pickups/],
    ['talk to an npc', /npc\.talk/],
    ['bark over an npc head', /channel: 'bubble'/],
    ['pause the game for a menu', /engine\.freeze/],
    ['build on a grid', /engine\.grids/],
    ['inventory', /engine\.inventory/],
  ];
  const wrong = TASKS.map(([q, want]) => [q, search(docs, q)[0]?.line ?? '(none)', want]).filter(([, first, want]) => !want.test(first) || /technique examples/.test(first));
  check(`${TASKS.length} common tasks: the first answer is the one recommended entry, never a technique example`, wrong.length === 0, wrong.map(([q, l]) => `"${q}" -> ${l}`).join('\n'));
}
