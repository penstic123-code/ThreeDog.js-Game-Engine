// 第三次审查，优先项 1：文档里的 js 块真的跑。R13 只做类型检查，配方 56、66 才实跑；这里跑全部配方、AI.md、THREE.md、两份 README。
// 块互相依赖时靠共享顶层变量（改成 var，块结束写进作用域），和读者一路抄下来一样。用到读者自己东西（boss、car）的块标 ```js fragment：不跑，R13 仍查类型。
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { rewriteImports } from './recipe-56.mjs';

const DOCS = new URL('../../docs/', import.meta.url), ROOT = new URL('../../../../', import.meta.url);
// recipes 56 and 66 run in their own specs: 56 on WebGPU (recipe-56.mjs), 66 with the step / expect of `threedog js --file` (recipe-66.mjs)
const files = [...readdirSync(new URL('recipes/', DOCS)).filter(f => f.endsWith('.md') && !/^(56|66)-/.test(f)).sort().map(f => new URL(`recipes/${f}`, DOCS)), new URL('AI.md', DOCS), new URL('THREE.md', DOCS), new URL('README.md', ROOT), new URL('README.zh-CN.md', ROOT)];
const short = u => decodeURIComponent(u.pathname.split('/').pop());

/** 文档里的块，只取 ```js（fragment 是片段，只查名字，不跑） */
function blocksOf(text) {
  const out = []; let at = -1, buf = [], skip = false, n = 0, pad = 0;
  text.split('\n').forEach((l, i) => {
    const m = at < 0 && /^(\s*)```js(\s+fragment)?\s*$/.exec(l);
    if (m) { at = i + 2; buf = []; n++; skip = !!m[2]; pad = m[1].length; return; }
    if (at >= 0 && /^\s*```\s*$/.test(l)) { if (!skip) out.push({ n, line: at, src: buf.join('\n') }); at = -1; return; }
    if (at >= 0) buf.push(l.slice(pad));   // a block inside a list is indented with it
  });
  return out;
}

/** 让块能当函数体跑：export 去掉，顶层 const/let/class 改成 var，末尾把顶层名字留给后面的块。语法不完整的返回 null */
function prepare(src) {
  const code = rewriteImports(src).replace(/^import\s+(\w+)\s*,\s*\{([^}]*)\}\s+from\s+.*$/gm, 'var $1 = {}, $2;').replace(/^export\s+default\s+/gm, 'var __default = ').replace(/^export\s+\{[^}]*\};?/gm, '').replace(/^export\s+(?=(async\s+)?(const|let|var|function|class)\b)/gm, '').replace(/^import\s+(\w+)\s+from\s+.*$/gm, 'var $1 = {};');
  const sf = ts.createSourceFile('b.js', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  if (sf.parseDiagnostics.length) return null;
  const names = [], edits = [];
  const bind = n => { if (ts.isIdentifier(n)) names.push(n.text); else n.elements?.forEach(el => el.name && bind(el.name)); };
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) { s.declarationList.declarations.forEach(d => bind(d.name)); const st = s.declarationList.getStart(sf); edits.push([st, st + (code.startsWith('const', st) ? 5 : 3), 'var']); }
    else if (ts.isFunctionDeclaration(s) && s.name) names.push(s.name.text);
    else if (ts.isClassDeclaration(s) && s.name) { names.push(s.name.text); edits.push([s.getStart(sf), s.getStart(sf), `var ${s.name.text} = `]); }
  }
  let body = code; for (const [a, b, t] of edits.reverse()) body = body.slice(0, a) + t + body.slice(b);
  return `try {\n${body}\n} finally { __keep({ ${names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} }); }`;
}

const SHARDS = 6;
const shard = i => files.filter((_, k) => k % SHARDS === i);
const OUT = new URL('../../.threedog/review3-docs/', import.meta.url);

const shardSpecs = Array.from({ length: SHARDS }, (_, i) => ({
  name: `review3 docs: every js block runs (shard ${i + 1}/${SHARDS})`,
  url: '/tests/review3-docs/index.html',
  expectErrors: /./,
  software: true,
  timeout: 240000,
  async run({ check, page }) {
    const all = [];
    let total = 0;
    const unparsed = [];
    for (const u of shard(i)) {
      const bs = blocksOf(readFileSync(u, 'utf8')).map(b => ({ ...b, code: prepare(b.src) }));
      unparsed.push(...bs.filter(b => !b.code).map(b => `${short(u)}:${b.line}`));
      const run = bs.filter(b => b.code).map(({ n, line, code }) => ({ n, line, code }));
      total += run.length;
      if (!run.length) continue;
      const res = await page.evaluate(b => window.runDoc(b), run);
      for (const r of res) all.push({ doc: short(u), ...r });
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL(`shard-${i}.json`, OUT), JSON.stringify({ total, partial: unparsed.length, all }));
    const bad = all.filter(r => r.kind !== 'ok');
    check(`ran ${total} blocks`, total > 0);
    check('every ```js block parses (a piece on purpose is fenced ```js fragment)', !unparsed.length, unparsed.join(' | '));
    check('every ```js block runs on a live game, or says it is a fragment', !bad.length, bad.slice(0, 10).map(r => `${r.kind} ${r.doc}:${r.line} ${r.msg}`).join(' | '));
  },
}));

/** 所有块（含 fragment、语法不全的）里 import 的名字；R13 不读 fragment、AI.md、README.zh-CN，R18 又跳过 js 块，这些地方的名字以前没人查 */
function importNames() {
  const out = [];
  for (const u of files) {
    const t = readFileSync(u, 'utf8');
    for (const m of t.matchAll(/^\s*import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/gm)) {
      if (/^\./.test(m[2])) continue;
      for (const n of m[1].split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) out.push({ doc: short(u), src: m[2], name: n });
    }
  }
  return out;
}

/** The first block of a recipe that contains `mark`, run from the page's text: a copy typed into the test would stay green after the doc goes wrong */
async function printed(page, doc, mark) {
  const b = blocksOf(readFileSync(new URL(`recipes/${doc}`, DOCS), 'utf8')).find(x => x.src.includes(mark));
  const [res] = await page.evaluate(x => window.runDoc(x), [{ n: b.n, line: b.line, code: prepare(b.src) }]);
  return res.kind === 'ok' ? 'ok' : res.msg;
}

export const specs = [...shardSpecs,
  {
    name: 'review3 docs: every name imported in a doc block exists in the module it names',
    url: '/tests/review3-docs/index.html',
    async run({ check, page }) {
      const names = importNames();
      const r = await page.evaluate(list => list.filter(x => !window.hasImport(x.src, x.name)), names);
      check(`checked ${names.length} imports`, names.length > 100, String(names.length));
      check('no missing import', !r.length, [...new Set(r.map(x => `${x.doc}: ${x.name} from ${x.src}`))].slice(0, 20).join(' | '));
    },
  },
  {
    name: '[guard] recipe 28: the ground.dig op of section 2 runs as printed',
    url: '/tests/review3-docs/index.html',
    async run({ check, page }) {
      const r = await printed(page, '28-terrain.md', "'ground.dig'");
      check('the block of docs/recipes/28-terrain.md section 2 does not throw', r === 'ok', r);
    },
  },
  {
    name: '[guard] recipe 07: retry from a frozen end screen: nextFixed waits there, the printed retry and newGame both leave it',
    url: '/tests/review3-docs/index.html',
    async run({ check, page }) {
      const play = `
        const out = window.__retry = {};
        engine.flow.go('gameOver');
        let early = false;
        engine.nextFixed(() => { early = true; });
        for (let i = 0; i < 10; i++) engine.step(1 / 60);
        out.waited = !early;
        engine.flow.go('gameOver');
        await retry();
        out.retry = [engine.flow.state, engine.vars.counter('tries')];
        engine.flow.go('gameOver');
        out.fresh = await engine.session.newGame();
        await Promise.resolve();
        out.after = [engine.flow.state, !!engine.frozen];
      `;
      const b = blocksOf(readFileSync(new URL('recipes/07-flow-scenes-pause.md', DOCS), 'utf8')).find(x => x.src.includes('const retry ='));
      const res = await page.evaluate(x => window.runDoc(x), [{ n: 0, line: 0, code: 'engine.use(flow());' }, { n: b.n, line: b.line, code: prepare(b.src) }, { n: 0, line: 0, code: play }]);
      check('the block and the play run', res.every(x => x.kind === 'ok'), JSON.stringify(res));
      const r = await page.evaluate(() => window.__retry);
      check('nextFixed does not fire under freeze: true', r?.waited, JSON.stringify(r));
      check('the printed retry leaves the freeze and resets', r?.retry?.[0] === 'playing' && r.retry[1] === 1, JSON.stringify(r));
      check('newGame from the frozen screen ends in playing, unfrozen', r?.fresh === true && r.after[0] === 'playing' && r.after[1] === false, JSON.stringify(r));
    },
  },
  {
    name: '[guard] recipe 22: buying and selling as printed are one whole trade: a full bag or shelf changes neither side',
    url: '/tests/review3-docs/index.html',
    async run({ check, page }) {
      // the ops come from the page's own text; this second block plays the trades in the same game
      const trades = `
        const I = engine.inventory, bag = I.container('player'), shop = 'shop-trader', args = item => ({ shop, item });
        engine.content.load({ items: { gold: { name: 'Gold', stack: 99999 }, medkit: { name: 'Medkit', price: 5 }, pebble: { name: 'Pebble' }, rock: { name: 'Rock' }, twig: { name: 'Twig' } }, containers: { [shop]: { capacity: 3, items: { medkit: 3 } } } });
        const shelf = I.container(shop);
        const fill = list => engine.ops.allow(() => { for (const e of bag.list()) bag.remove(e.key, e.count); for (const [id, n] of Object.entries(list)) bag.add(id, n, { silent: true }); });
        const state = () => [bag.count('medkit'), bag.count('gold'), shelf.count('medkit'), bag.count('twig')].join();
        const trade = (op, list, item = 'medkit') => { fill(list); const before = state(), r = engine.ops.run(op, args(item)); return { ok: r.ok, code: r.code, before, after: state() }; };
        bag.capacity = 2;
        window.__shop = {
          sellFull: trade('shop.sell', { medkit: 2, rock: 1 }),   // the medkit stack stays, so no slot for gold
          sellLast: trade('shop.sell', { medkit: 1, rock: 1 }),   // the last medkit frees the slot the gold takes
          buyFull: trade('shop.buy', { gold: 7, rock: 1 }),       // gold keeps its slot, no slot for the medkit
          buyLast: trade('shop.buy', { gold: 5, rock: 1 }),       // the last coins free the slot the medkit takes
          cheap: trade('shop.sell', { pebble: 1 }, 'pebble'),     // price 1: a pay of 0 would be refused by add
        };
        engine.ops.allow(() => shelf.add('rock', 1));
        window.__shop.shelfFull = trade('shop.sell', { twig: 1 }, 'twig');   // medkit, pebble and rock take all three shelf slots
      `;
      const b = blocksOf(readFileSync(new URL('recipes/22-shop-gold.md', DOCS), 'utf8')).find(x => x.src.includes("'shop.sell'"));
      const res = await page.evaluate(x => window.runDoc(x), [{ n: b.n, line: b.line, code: prepare(b.src) }, { n: 0, line: 0, code: trades }]);
      check('the ops block and the trades run', res.every(x => x.kind === 'ok'), JSON.stringify(res));
      const s = await page.evaluate(() => window.__shop);
      const refused = (t, code) => t?.ok === false && t.code === code && t.before === t.after;
      check('selling with no slot for the gold is refused and the item stays', refused(s?.sellFull, 'bagFull'), JSON.stringify(s?.sellFull));
      check('selling the last piece pays into the slot it freed', s?.sellLast.ok && /^0,3,/.test(s.sellLast.after), JSON.stringify(s?.sellLast));
      check('buying with no slot for the goods is refused and the gold stays', refused(s?.buyFull, 'bagFull'), JSON.stringify(s?.buyFull));
      check('spending the last coins makes room for the goods', s?.buyLast.ok && /^1,0,/.test(s.buyLast.after), JSON.stringify(s?.buyLast));
      check('an item worth 1 still sells', s?.cheap.ok, JSON.stringify(s?.cheap));
      check('a full shelf refuses before anything moves', refused(s?.shelfFull, 'shelfFull'), JSON.stringify(s?.shelfFull));
    },
  },
  {
    name: '[guard] recipe 33: stream ready means nothing pending: a failed build is left out and teleport still lands',
    url: '/tests/review3-docs/index.html',
    expectErrors: /broken on purpose/,
    async run({ check, page }) {
      const r = await page.evaluate(async () => {
        const e = await window.freshKitchen();
        const h = e.stream.add({ position: [6, 0, 7], radius: 50, build() { throw new Error('broken on purpose'); } });
        for (let i = 0; i < 300 && (i < 5 || !e.stream.ready); i++) { e.step(1 / 60); await new Promise(r => setTimeout(r)); }
        const out = { ready: e.stream.ready, built: h.built, error: e.error };
        let landed = null;
        e.stream.teleport([6, 0, 9]).then(() => { landed = true; }, err => { landed = err.code ?? String(err); });
        for (let i = 0; i < 600 && landed === null; i++) { e.step(1 / 60); await Promise.resolve(); }
        return { ...out, landed, z: e.player.position.z, builtAfter: h.built };
      });
      const s = JSON.stringify(r);
      check('ready is true with the entry not built, and the failure froze nothing', r.ready === true && r.built === false && !r.error, s);
      check('teleport lands all the same', r.landed === true && Math.abs(r.z - 9) < 0.01, s);
      check('handle.built tells the game it is missing', r.builtAfter === false, s);
    },
  },
  {
    name: '[guard] recipe 57: the printed roll hands control back with the calendar stopped',
    url: '/tests/review3-docs/index.html',
    async run({ check, page }) {
      const lines = readFileSync(new URL('recipes/57-control.md', DOCS), 'utf8').split('\n'), at = lines.findIndex(l => l.startsWith('const roll ='));
      const printedRoll = lines.slice(at, at + 2).join('\n');
      const r = await page.evaluate(async code => {
        const engine = await window.freshKitchen();
        engine.mod('clock.rate', { owner: 'test', set: 0 });
        const roll = new Function('engine', `${code.replace('const roll =', 'var roll =').replace(/engine\.clock\.after/, 'var later = () => engine.clock.after')}; return { roll, later };`)(engine);
        let back = 0;
        const end = roll.roll.remove;
        roll.roll.remove = () => { back++; end(); };
        roll.later();
        for (let i = 0; i < 40; i++) engine.step(1 / 60);
        return { back, code };
      }, printedRoll);
      check('the roll ended', r.back === 1, JSON.stringify(r));
    },
  },
  {
    name: '[guard] recipe 55: its first block runs as printed (time.enemies is only there after engine.time.channel)',
    url: '/tests/review3-docs/index.html',
    async run({ check, page }) {
      const r = await printed(page, '55-mods-time-wrap.md', "'time.enemies'");
      check('the first block of docs/recipes/55-mods-time-wrap.md does not throw', r === 'ok', r.slice(0, 120));
    },
  },
];
