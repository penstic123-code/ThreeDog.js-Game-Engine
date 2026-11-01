// threedog how "<effect or task>": which API / recipe answers a task, from the docs alone (works offline) plus the live catalog when a dev page runs.
// Why plain token scoring and no fuzzy library: the result must be the same every run and explainable ("matched rain in the AI.md row"); an AI reads
// the top few hits and opens the recipe. Sources: the AI.md entry table (one row per task: the best hit), recipe headings with their first sentence.
// Chinese words are matched by their characters (bigrams) and a small word list adds the English words the docs use.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE, pickWorkspace } from './paths.mjs';
import { devServerInfo } from './devinfo.mjs';

/** Chinese task word -> the English words the docs use (extra tokens, weight 1) */
const ZH = { 下雨: 'rain weather', 天气: 'weather', 雨: 'rain', 雪: 'snow weather', 雾: 'fog', 存档: 'save', 读档: 'save load', 对话: 'dialogue', 天空: 'sky', 水: 'water',
  相机: 'camera', 镜头: 'camera', 音效: 'audio sound', 音乐: 'audio music', 任务: 'quest', 背包: 'inventory item', 物品: 'item', 地形: 'terrain', 植被: 'vegetation tree',
  树: 'tree vegetation', 光: 'light', 灯: 'light', 阴影: 'shadow', 粒子: 'particle', 动画: 'animation', 敌人: 'enemy', 战斗: 'combat', 碰撞: 'collision',
  联机: 'net multiplayer', 网络: 'net', 拍照: 'photo camera', 材质: 'material', 颜色: 'color', 风格: 'style', 模型: 'model', 界面: 'ui', 菜单: 'menu ui', 地图: 'map',
  移动: 'move', 跳: 'jump', 放置: 'place add', 删除: 'remove', 修改: 'set edit', 后期: 'post effects', 昼夜: 'sky time', 时间: 'time clock', 商店: 'shop', 导航: 'nav path', 寻路: 'nav path' };

/** Lower-case tokens of a text: words/numbers, plus every Chinese character pair (a single Chinese character alone counts as one token) */
export function tokens(s) {
  const out = [];
  for (const m of s.toLowerCase().matchAll(/[a-z0-9_.]{2,}|[一-鿿]+/g)) {
    const w = m[0];
    if (/[一-鿿]/.test(w)) { if (w.length === 1) out.push(w); for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2)); } else out.push(w);
  }
  return out;
}
const STOP = new Set(['the', 'a', 'to', 'of', 'in', 'on', 'for', 'and', 'how', 'do', 'is', 'an', 'make', 'with', 'my']);

/** { main: tokens typed (weight 3), extra: translated words (weight 1) } */
export function queryTokens(q) {
  const main = [...new Set(tokens(q).filter(t => !STOP.has(t)))], extra = new Set();
  for (const [zh, en] of Object.entries(ZH)) if (q.includes(zh)) for (const w of en.split(' ')) if (!main.includes(w)) extra.add(w);
  return { main, extra: [...extra] };
}

/** ASCII words match at a word start (so "rain" does not hit "terrain", "open" still hits "openWorld"); Chinese tokens match anywhere */
const has = (t, w) => /^[a-z0-9_.]/.test(w) ? new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t) : t.includes(w);
const score = (text, { main, extra }) => { const t = text.toLowerCase(); let s = 0; for (const w of main) if (has(t, w)) s += 3; for (const w of extra) if (has(t, w)) s += 1; return s; };
const clip = (s, n = 110) => { s = s.replace(/`/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** All candidates from the docs: AI.md rows and recipe sections */
export function docEntries(docsDir) {
  const out = [], ai = join(docsDir, 'AI.md');
  if (existsSync(ai)) {
    for (const line of readFileSync(ai, 'utf8').split('\n')) {
      if (!line.startsWith('|') || /^\|[\s|:-]+\|?$/.test(line) || /^\|\s*To do\s*\|/i.test(line)) continue;
      const c = line.split('|').slice(1, -1).map(x => x.trim());
      if (c.length < 2) continue;
      out.push({ src: 'AI.md', title: c[0], use: c.length > 2 ? c[1] : '', where: c.length > 2 ? c[c.length - 1].replace(/`/g, '') : '', text: c.join(' ') });
    }
  }
  const rdir = join(docsDir, 'recipes');
  if (existsSync(rdir)) for (const f of readdirSync(rdir).filter(x => x.endsWith('.md')).sort()) {
    const lines = readFileSync(join(rdir, f), 'utf8').split('\n');
    let h1 = '';
    lines.forEach((l, i) => {
      const m = /^(#{1,3})\s+(.*)/.exec(l);
      if (!m) return;
      if (m[1] === '#') h1 = m[2];
      let snip = ''; for (let j = i + 1; j < lines.length && !/^#/.test(lines[j]); j++) if (lines[j].trim() && !lines[j].startsWith('```') && !lines[j].startsWith('|')) { snip = lines[j]; break; }
      const sec = /^(\d+)\./.exec(m[2]);
      out.push({ src: 'recipe', title: m[2], h1, where: `recipes/${f}${m[1] === '#' ? '' : sec ? ` §${sec[1]}` : ` "${m[2]}"`}`, snip, name: m[2].replace(/^\d+\.\s*/, ''), text: m[2] + ' ' + snip, head: m[1] === '#' ? '' : h1 });
    });
  }
  return out;
}

/** The best `max` hits for a query: [{ score, line }] (ties keep document order, so the output is stable) */
export function search(docsDir, q, max = 5) {
  const qt = queryTokens(q), hits = [];
  docEntries(docsDir).forEach((e, order) => {
    const s = score(e.text, qt) * (e.src === 'AI.md' ? 1.2 : 1) + (e.head ? score(e.head, qt) * 0.5 : 0);
    if (s > 0) hits.push({ s, order, e });
  });
  hits.sort((a, b) => b.s - a.s || a.order - b.order);
  const seen = new Set(), out = [];
  for (const { s, e } of hits) {
    if (seen.has(e.where + e.title)) continue;
    seen.add(e.where + e.title);
    out.push({ score: Math.round(s * 10) / 10, line: e.src === 'AI.md' ? `AI.md · ${e.title} → ${clip(e.use, 90)} → ${e.where || 'AI.md'}` : `${e.where} · ${clip(e.name, 60)} — ${clip(e.snip)}` });
    if (out.length >= max) break;
  }
  return out;
}

/** CLI body: threedog how "<task>" [-w game] */
export async function main(argv) {
  let dir, args;
  try { ({ dir, args } = pickWorkspace(argv)); } catch (e) { console.log('✗ ' + e.message); return 1; }
  const q = args.join(' ').trim();
  if (!q) { console.log('Usage: threedog how "<effect or task>"   (e.g. how "rain", how 存档)'); return 1; }
  const res = search(join(ENGINE, 'docs'), q);
  // live catalog (modules / ops whose name matches a typed word) when a dev page is running; any failure just means "no page", docs answer alone
  let live = [];
  // only when a page is already attached: execute() would otherwise make the dev server open a headless Chromium just to answer a docs search
  const dev = devServerInfo(dir), attached = dev.state === 'live' && await fetch(`http://localhost:${dev.port}/__threedog/cmd`, { method: 'POST',
    headers: { 'x-threedog-token': dev.token }, body: '{"op":"ping"}', signal: AbortSignal.timeout(1500) }).then(r => r.json()).then(j => j.value?.live || j.value?.headless, () => false);
  if (attached) {
    try {
      const { execute } = await import('./threedog/dispatch.mjs'), word = queryTokens(q).main.find(w => /^[a-z]/.test(w));
      const r = word && await Promise.race([execute(dir, 'catalog', ['--find', word]), new Promise(res2 => setTimeout(res2, 4000, null))]);
      if (r?.ok && Array.isArray(r.data)) live = r.data.slice(0, 3).map(m => `live catalog · ${m.id} (${m.kind}${m.ops?.length ? ', ops: ' + m.ops.slice(0, 4).map(o => o.name ?? o).join(', ') : ''}) → threedog catalog ${m.id}`);
    } catch { /* no page */ }
  }
  if (!res.length && !live.length) { console.log(`No match for "${q}". Try another word, or read packages/engine/docs/AI.md (the task index).`); return 0; }
  [...live, ...res.map(r => r.line)].forEach((l, i) => console.log(`${i + 1}. ${l}`));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(await main(process.argv.slice(2)));
