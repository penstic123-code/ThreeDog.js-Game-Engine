// threedog how "<task>": keyword search over AI.md rows, recipe headings and the plain three.js answers (THREE.md, recipe 54), offline, no browser.
// Why a unit test: the ranking must be deterministic and must not match inside other words ("rain" in "terrain"), or the top hit sends an AI to the
// wrong recipe; and a task three.js does on its own (tone mapping, a render target) must answer with the three.js way first, not an engine wrapper.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE } from '../paths.mjs';
import { search, tryNext } from '../how.mjs';

export const name = 'how: offline doc search is deterministic, matches word starts only, plain three.js first, weighs rare words, knows synonyms, says when nothing fits';

export async function run({ check }) {
  const docs = join(ENGINE, 'docs');
  const rain = search(docs, 'rain'), again = search(docs, 'rain');
  check('"rain" finds the weather recipe in the top 3 and never terrain', rain.slice(0, 3).some(h => /weather/.test(h.line)) && !rain.some(h => /28-terrain/.test(h.line)), JSON.stringify(rain.map(h => h.line)));
  check('same query twice gives the same list', JSON.stringify(rain) === JSON.stringify(again));
  check('a hit names a recipe path, an AI.md row or THREE.md, at most 5', rain.length <= 5 && rain.every(h => /recipes\/|AI\.md|THREE\.md/.test(h.line)));
  check('English task words find the picture rows (brush strokes, colored shadows)', search(docs, 'brush strokes').length > 0 && search(docs, 'colored shadows').length > 0);
  check('nonsense gives no hit', search(docs, 'qqzzxx').length === 0);
  const tone = search(docs, 'tone mapping'), rt = search(docs, 'mirror render target'), bvh = search(docs, 'raycast');
  check('"tone mapping" answers with the plain three.js row first (recipe 54: set renderer.toneMapping)', /^plain three\.js .*toneMapping.*54-three-idioms/.test(tone[0]?.line ?? ''), JSON.stringify(tone.map(h => h.line)));
  check('"mirror render target" answers with the plain three.js row first', /^plain three\.js · Render targets/.test(rt[0]?.line ?? ''), JSON.stringify(rt.map(h => h.line)));
  check('THREE.md is indexed: "raycast" finds the page-wide BVH change', bvh.some(h => /THREE\.md/.test(h.line) && /raycast/i.test(h.line)), JSON.stringify(bvh.map(h => h.line)));
  const rigid = search(docs, 'rigid bodies').map(h => h.line);
  check('a THREE.md row that names an engine API is labelled engine + three.js, not plain three.js', rigid.some(l => /^engine \+ three\.js · Rigid bodies/.test(l)) && !rigid.some(l => /^plain three\.js · Rigid bodies/.test(l)), JSON.stringify(rigid));
  check('the engine route stays in the list: at most 3 plain hits', [rain, tone, rt, bvh, search(docs, 'fog')].every(r => r.filter(h => h.line.startsWith('plain three.js')).length <= 3));
  // 时间归 calendar、天空只画：第一条是 engine.calendar（06），画天空的 08 紧跟在前三，都在 plain three.js 之前
  const dn = search(docs, 'day night').map(h => h.line), firstPlain = dn.findIndex(l => l.startsWith('plain three.js'));
  check('"day night" answers with the engine route: calendar first (time), the sky recipe in the top 3 (drawing), both before plain three.js',
    /engine\.calendar/.test(dn[0] ?? '') && /06-clock-events/.test(dn[0] ?? '') && dn.slice(0, 3).some(l => /08-weather-sky/.test(l)) && (firstPlain === -1 || firstPlain >= 2), JSON.stringify(dn));
  // [守] 一件事一个入口：常见任务用平常话问，第一条必须是那一个推荐入口（CONVENTIONS.md "One task, which entry"），技巧示例只能排在后面。
  // 不过时改文档关键词（AI.md 行、THREE.md、菜谱标题），不改这里的期望
  const TASKS = [
    ['ride a boat', /57-control/],
    ['choice cursor', /26-ui-parts/],
    ['applyEffects', /54-three-idioms/],
    ['move the player by script', /57-control/],
    ['elevator', /57-control/],
    ['climb', /57-control/],
    ['moving platform', /32-action-game|57-control/],
    ['playthrough script clean start', /16-dev-bridge/],
    ['make windows glow at night', /uNight/],
    ['close a dialogue', /close a dialogue/],
    ['pick a dialogue choice', /Pick a dialogue choice/],
    ['teleport the player in a test', /applyState\(\{ pos \}\)/],
    // 0.5 acceptance: "game test" led to the dev bridge, the spec-file example sat unindexed in COMMANDS.md
    ['game test', /A game test.*tests\/specs\/.*COMMANDS\.md/],
    ['write a test for my game', /A game test.*tests\/specs\//],
    ['teleport the player far away', /stream\.teleport/],
    ['settings turn off my effect', /limits: 'post\./],
    ['quality menu disable custom post effect', /limits: 'post\./],
    ['set the time of day', /engine\.calendar/],
    ['day night cycle', /engine\.calendar/],
    ['seasons', /engine\.calendar/],
    ['speed up time', /engine\.mod\('clock\.rate'/],
    ['timer after 3 seconds', /engine\.clock \(after/],
    ['bullet time on enemies', /engine\.mod/],
    ['add a fixed camera', /fixedCamera/],
    ['switch camera at runtime', /setCamera/],
    ['third person camera', /followCamera/],
    ['soft shadows under props', /engine\.post\.add\(ao\(\)\)/],
    ['ambient occlusion in a code-built model', /bakeVertexAO/],
    ['wet road after rain', /engine\.weather/],
    ['puddles', /engine\.weather/],
    ['many torches', /lightPool/],
    ['change the sun intensity', /sun\.intensity/],
    ['environment lighting reflections', /engine\.sky\.environment/],
    ['baked light probes', /bakeProbes/],
    ['bloom', /post-effects/],
    ['add a post processing pass', /engine\.post\.add/],
    ['tone mapping', /toneMapping/],
    ['save game', /saves\.register/],
    ['pathfinding', /findPath/],
    ['pick up items', /engine\.pickups/],
    ['talk to an npc', /npc\.talk/],
    ['bark over an npc head', /channel: 'bubble'/],
    ['pause the game for a menu', /engine\.freeze/],
    ['build on a grid', /engine\.grids/],
    ['inventory', /engine\.inventory/],
    // WebGPU 路线只有一个入口：recipe 56（开法、TSL 材质、引擎函数都从那里读）
    ['webgpu', /56-webgpu-tsl/],
    ['webgpu renderer', /56-webgpu-tsl/],
    ['tsl', /56-webgpu-tsl/],
    ['tsl shader', /56-webgpu-tsl/],
    ['node material', /56-webgpu-tsl/],
  ];
  // [guard] full sentences, casual and player wording (queries a first-time AI actually typed, which the old version answered wrong first): rarity weighs common words down, how-words.mjs synonym groups,
  // camelCase splitting. The first result must be on target. When it is wrong, first see whether the docs lack the word (an AI.md line, a recipe title) or a synonym group does, and fix that, not the expectation here
  const SPOKEN = [
    ['game is slow, find why fps drops', /15-perf/],
    ['low fps stutter', /15-perf/],
    ['performance', /15-perf/],
    ['custom sky', /engine\.sky\.replace/],
    ['volumetric fog', /59-depth-post-effects/],
    ['god rays', /59-depth-post-effects/],
    ['top-down farm: place on grid, crops grow over days, sell at shop', /18-world\.md §3|29-grid|engine\.grids/],
    ['save', /saves\.register/],
    ['2D side-scroller with sprites and dynamic lights', /sideScroller.*rc2d/],
    ['sprite lighting normal map 2d', /rc2d/],
    ['push boxes with physics puzzle', /engine\.rigid|11-vehicles/],
    ['can the player push rigid bodies', /11-vehicles/],
    ['third person character running and jumping on terrain', /createPlayer|presets\.player/],
    ['my own toon material with color bands and outline', /ShaderMaterial|43-shader/],
    ['rainy night street with wet ground, street lamps and fog', /weather|lightPool/],
    ['sky color for my shader', /uSkyHorizon|Sky color for my shader/],
    ['horizon color', /Sky color for my shader/],
    ['title start continue', /Title -> start -> continue/],
    // the judging map (recipe 60): asked as a wish, not as a knob name
    ['make it look good', /60-judge-the-picture/],
    ['tune the picture', /60-judge-the-picture/],
    ['look prettier', /60-judge-the-picture/],
    ['visual polish', /60-judge-the-picture/],
  ];
  const off = SPOKEN.map(([q, want]) => [q, search(docs, q)[0]?.line ?? '(none)', want]).filter(([, first, want]) => !want.test(first));
  check(`${SPOKEN.length} whole-sentence / spoken queries: the first answer is the right recipe or row`, off.length === 0, off.map(([q, l]) => `"${q}" -> ${l}`).join('\n'));
  // say so when nothing fits: no entry covers enough of the query's weight -> weak, plus the words that appear nowhere in the docs; the CLI then says "not found, try these words / read AI.md line ..."
  const weak = search(docs, 'camera shake boss'), none = search(docs, 'qqzzxx');
  check('a query the docs barely cover is marked weak and names the words the docs never use', weak.weak === true && weak.unknown.includes('boss'), JSON.stringify({ weak: weak.weak, unknown: weak.unknown }));
  check('a word only its synonym appears for is not reported as unknown (rainy, the docs say rain)', !search(docs, 'rainy street').unknown.includes('rainy'), JSON.stringify(search(docs, 'rainy street').unknown));
  check('a good hit is not marked weak (a long sentence with a right first answer)', SPOKEN.every(([q]) => !search(docs, q).weak), SPOKEN.filter(([q]) => search(docs, q).weak).map(([q]) => q).join(', '));
  // [guard] the weak verdict reads the list: a query spread over rows is answered even though no one row holds a third of it (judged on one row, rewording that row flipped the answer to "no match")
  const fake = mkdtempSync(join(tmpdir(), 'how-weak-'));
  writeFileSync(join(fake, 'AI.md'), ['alpha', 'bravo', 'charlie', 'delta'].map(w => `| ${w} task | \`engine.${w}\` | 01-a.md |`).join('\n'));
  const spread = search(fake, 'alpha bravo charlie delta echo foxtrot golf'), thin = search(fake, 'alpha echo foxtrot golf hotel india');
  rmSync(fake, { recursive: true });
  check('[guard] weak reads the whole list: words spread over rows are a match, one word of six is not', spread.weak === false && thin.weak === true, JSON.stringify({ spread: spread.weak, thin: thin.weak }));
  // [guard] a recipe's "In this recipe" list and a section's first bullet do not rank: they name other sections and one item, not this section
  const fake2 = mkdtempSync(join(tmpdir(), 'how-rank-'));
  mkdirSync(join(fake2, 'recipes'));
  writeFileSync(join(fake2, 'recipes', '01-a.md'), '# Top\n\n**In this recipe**: 1. Zebra crossing\n\n## 1. Zebra crossing\nHow to paint one.\n\n## 2. Rules\n- one lamp near a yak\n');
  const zebra = search(fake2, 'zebra crossing'), yak = search(fake2, 'yak');
  rmSync(fake2, { recursive: true });
  check('[guard] the section answers, not the list of sections above it; a bullet word ranks nothing', /Zebra crossing/.test(zebra[0]?.line) && zebra.length === 1 && yak.length === 0, JSON.stringify([zebra, yak]));
  check('the "nothing found" hint says what to try and where to read', /2-4 English task words/.test(tryNext(none)) && /AI\.md/.test(tryNext(none)) && /qqzzxx/.test(tryNext(none)), tryNext(none));
  // [guard] the MCP how tool gives the same hint as the CLI (it once answered a bare "No match" with no words to try)
  const { STATIC_TOOLS } = await import('../threedog/mcp-extra.mjs');
  const mNone = await STATIC_TOOLS.how.run(ENGINE, { task: 'qqzzxx' }), mWeak = await STATIC_TOOLS.how.run(ENGINE, { task: 'camera shake boss' });
  check('[guard] MCP how: no match and a weak match carry the CLI hint (words the docs never use, 2-4 task words)',
    /2-4 English task words/.test(mNone.text) && /qqzzxx/.test(mNone.text) && /No good match/.test(mWeak.text) && /boss/.test(mWeak.text), mNone.text + ' | ' + mWeak.text.slice(0, 200));
  const wrong = TASKS.map(([q, want]) => [q, search(docs, q)[0]?.line ?? '(none)', want]).filter(([, first, want]) => !want.test(first) || /technique examples/.test(first));
  check(`${TASKS.length} common tasks: the first answer is the one recommended entry, never a technique example`, wrong.length === 0, wrong.map(([q, l]) => `"${q}" -> ${l}`).join('\n'));
}
