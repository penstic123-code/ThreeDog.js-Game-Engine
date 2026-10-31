// Co-op demo page: a host and two guests in one page, joined by fakeNetwork (latency / loss adjustable), each a headless engine.
// Buttons call engine.ops.run exactly as a real game UI would; the lists redraw from state (net:sync), never from run's return value.
// For a real two-machine game swap fakeNetwork for webSocket(url) and run `node packages/tools/net-relay.mjs` (see recipes/27-net.md).
// Tests (tests/net/) reuse coop.js to build their own engines step by step.
import { fakeNetwork } from '../../index.js';
import { makeCoop } from './coop.js';

const root = document.getElementById('panes');
start();

async function start() {
  const wire = fakeNetwork({ latency: 120, jitter: 40, loss: 0 });
  const host = await makeCoop('host', wire.host());
  const guests = [await makeCoop('client', wire.connect()), await makeCoop('client', wire.connect())];
  /** @type {[string, import('threedog').Engine][]} */
  const all = [['Host', host], ['Guest A', guests[0]], ['Guest B', guests[1]]];
  window.engine = host;
  for (const [, e] of all) e.resume();   // headless engines advance only on step(); resume runs them live
  const panes = all.map(([title, e]) => pane(title, e));
  // refresh the debug panes from the host's frame loop (never setInterval in engine code: it ignores pause and step), about 5 times a second
  let since = 0;
  host.onFrame(dt => { if ((since += dt) >= 0.2) { since = 0; panes.forEach(p => p()); } });
  document.getElementById('latency').oninput = ev => { wire.latency = +(/** @type {HTMLInputElement} */ (ev.target)).value; };
  document.getElementById('loss').oninput = ev => { wire.loss = +(/** @type {HTMLInputElement} */ (ev.target)).value / 100; };
}

function pane(title, e) {
  const el = document.createElement('section');
  root.append(el);
  const log = [];
  const act = (name, args) => {
    const r = e.ops.run(name, args);
    log.unshift(`${name} ${args.item ?? args.id ?? ''}: ${r.pending ? 'sent' : r.ok ? 'ok' : r.reason}`);
  };
  e.events.on('net:result', r => log.unshift(`  host: ${r.name} ${r.ok ? 'ok' : r.reason} (tick ${r.tick})`));
  /** @type {[string, string, Record<string, any>][]} */
  const buttons = [
    ['Buy apple', 'shop.buy', { item: 'apple' }], ['Buy bread', 'shop.buy', { item: 'bread' }], ['Sell apple', 'shop.sell', { item: 'apple' }],
    ['Put apple', 'chest.put', { item: 'apple' }], ['Take apple', 'chest.take', { item: 'apple' }],
    ['Claim plot-1', 'plot.claim', { id: 'plot-1' }], ['Water plot-1', 'plot.water', { id: 'plot-1' }], ['Cheat gold', 'cheat.gold', { n: 99 }],
  ];
  const fmt = c => c.list().map(x => `${x.id} ${x.count}`).join(', ') || '-';
  const info = document.createElement('div'), pre = document.createElement('pre');
  el.append(info);
  for (const [label, name, args] of buttons) { const x = document.createElement('button'); x.textContent = label; x.onclick = () => act(name, { ...args }); el.append(x); }
  el.append(pre);
  // buttons are built once (redrawing them would eat clicks); only the state text is redrawn
  return () => {
    const inv = e.inventory, plot = e.world.get('plot-1');
    info.innerHTML = `<h2>${title} <small>${e.net.actor ?? '...'}</small></h2>
      <p>Bag: ${fmt(inv.container('player'))}</p><p>Chest: ${fmt(inv.container('chest'))}</p><p>Shop: ${fmt(inv.container('shop'))}</p>
      <p>plot-1: owner ${plot?.owner ?? 'none'}, water ${plot?.water ?? 0}</p>`;
    pre.textContent = log.slice(0, 8).join('\n');
  };
}
