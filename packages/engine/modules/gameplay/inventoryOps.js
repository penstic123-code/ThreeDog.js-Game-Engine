// Inventory ops and the 'inventory' UI part. Everything a player decides to do with items (move, use, drop) is an op, so the default window,
// a game's own window, dialogue, the dev bridge and tests all run the same can / run (recipes/23-ops.md).
// The window is a UI part (recipes/26-ui-parts.md): the engine owns opening / closing (key, Esc, input lock), the part only draws.
//   engine.ui.set('inventory', false)                     no inventory window at all (no DOM is ever built)
//   engine.ui.set('inventory', { drop: true })            default window with a Drop button per row
//   engine.ui.set('inventory', (engine) => ({ show: d => …, update: d => …, hide: () => …, dispose: () => … }))   your own
import { esc, iconHTML as icon, injectUICSS } from '../../ui/UI.js';


/** Texts of the inventory window, the pickup toast and the ops (zh-CN and en) @internal */
export const INVENTORY_STRINGS = {
  'zh-CN': { 'inventory.title': '背包', 'inventory.action': '背包', 'inventory.empty': '背包是空的。', 'inventory.full': '背包满了',
    'inventory.got': '获得 {icon} {name} ×{n}', 'inventory.pickup': '捡起 {name}', 'inventory.use': '使用', 'inventory.drop': '丢下' },
  en: { 'inventory.title': 'Inventory', 'inventory.action': 'Inventory', 'inventory.empty': 'Your bag is empty.', 'inventory.full': 'Inventory full',
    'inventory.got': 'Got {icon} {name} ×{n}', 'inventory.pickup': 'Pick up {name}', 'inventory.use': 'Use', 'inventory.drop': 'Drop' },
};

/** Data the 'inventory' part receives in show / update @internal */
export function windowData(inv) {
  const e = inv.engine, bag = inv.bag;
  return { title: e.t('inventory.title'), hint: e.input.label(inv.action), items: bag.list(), capacity: bag.capacity, used: bag.slotsUsed, weight: bag.weight, maxWeight: bag.maxWeight };
}

/**
 * Default 'inventory' part: the list window. Rows of items with a use function get a Use button; options.drop adds a Drop button. Buttons run ops.
 * The style pack can replace the body with style.ui.templates.inventory(data, { esc, t, icon }).
 * @internal
 */
export function inventoryWindow(e, o = {}) {
  let el = null;
  const tools = { esc, t: (k, p) => e.t(k, p), icon };
  const row = it => {
    const btn = (op, k) => `<button class="threedog-btn" type="button" data-op="${op}" data-key="${esc(it.key)}">${esc(e.t(k))}</button>`;
    const acts = (typeof it.def.use === 'function' ? btn('inventory.use', 'inventory.use') : '') + (o.drop ? btn('inventory.drop', 'inventory.drop') : '');
    return `<div class="threedog-row"><span class="threedog-icon">${icon(it.def)}</span>
      <span class="threedog-row-main"><b>${esc(it.def.name)}</b><div class="threedog-row-sub">${esc(it.def.desc || '')}</div></span>
      <span class="threedog-count">×${it.count}</span>${acts}</div>`;
  };
  const draw = d => {
    const tpl = e.style.ui?.templates?.inventory;
    const body = tpl ? tpl(d, tools) : d.items.length ? `<div class="threedog-list">${d.items.map(row).join('')}</div>` : `<p class="threedog-empty">${esc(e.t('inventory.empty'))}</p>`;
    el.innerHTML = `<div class="threedog-win-head"><span>${esc(d.title)}</span><span><span class="threedog-win-hint">${esc(d.hint)}</span> `
      + `<button class="threedog-btn threedog-close" type="button">${esc(e.t('common.close'))}</button></span></div>${body}`;
  };
  return {
    show(d) {
      if (!el) {   // built on first open: a game that never opens it (or turned it off) has no inventory DOM
        injectUICSS();
        el = document.createElement('div'); el.className = 'threedog-ui threedog-win threedog-win-inventory'; e.uiRoot.appendChild(el);
        el.addEventListener('click', ev => {
          const b = /** @type {HTMLElement} */ (ev.target).closest?.('button'); if (!b) return;
          if (b.classList.contains('threedog-close')) e.ui.close('inventory');
          else if (b.dataset.op) e.ops.run(b.dataset.op, { item: b.dataset.key });
        });
      }
      el.hidden = false; draw(d);
    },
    update(d) { if (el && !el.hidden) draw(d); },
    hide() { if (el) el.hidden = true; },
    dispose() { el?.remove(); el = null; },
  };
}

/** Where an actor stands (engine.actorPosition: the player body, a vehicle, a world record) @internal */
const posOf = (e, actor) => actor === 'player' && !e.player ? null : e.actorPosition(actor);

/** Define inventory.transfer / inventory.use / inventory.drop @internal */
export function defineInventoryOps(e, inv) {
  const box = id => inv._containers.map.get(id);
  // moving items between containers by hand (an inventory / chest window, drag and drop) is a player decision
  e.ops.define('inventory.transfer', {
    desc: 'Move items between containers (player bag is player); item is an item id or an entry key (sword#3)', args: { from: 'string', to: 'string', item: 'string', n: 'int?' },
    can(e, { from, to, item, n = 1 }) {
      const a = box(from), b = box(to);
      if (!a || !b) return 'noContainer';
      if (!a.has(item, n)) return 'notEnough';
      return from !== to && b._accepts(a, item, n) < n ? 'full' : true;
    },
    run: (e, { from, to, item, n = 1 }) => inv.transfer(from, to, item, n),
  });
  // Replace-when-full recipe: one op takes A and gives B, all or nothing. Undo with engine.ops.undo('inventory.trade', args, value).
  //   engine.ops.run('inventory.trade', { take: 'rusty_key', give: 'gold_key' })   // { ok: true, value } or { ok: false, reason: 'full' | 'notEnough' }
  const at = (a, ctx) => box(a.container ?? ctx?.actor ?? 'player');
  e.ops.define('inventory.trade', {
    desc: "Trade in the actor's container: take an item (or entry key) and give another in one all-or-nothing step; works with a full bag when the taken item frees the room",
    args: { take: 'string', give: 'string', takeN: 'int?', giveN: 'int?', container: 'string?' },
    can(e, a, ctx) {
      const c = at(a, ctx);
      return c ? c._canTrade(a.take, a.give, a.takeN ?? 1, a.giveN ?? 1) : 'noContainer';
    },
    run(e, a, ctx) { const { took, gave, giveId, giveN } = at(a, ctx).trade(a.take, a.give, { takeN: a.takeN, giveN: a.giveN }); return { took, gave, giveId, giveN }; },
    undo(e, a, v, ctx) {   // give B back, take A back (with its data); the value of the run is v
      const c = at(a, ctx);
      c.remove(v.gave, v.giveN);
      for (const t of v.took) c.add(t.id, t.count, { ...(t.data && { data: t.data }), silent: true });
    },
    reasons: { noContainer: 'No container with that id (container arg; default the actor)', notEnough: 'The container does not hold the item to give up', full: 'The new item does not fit even after the old one is removed' },
  });
  e.ops.define('inventory.use', {
    desc: "Use an item from the actor's container: runs the item's use(e, info); consume: true removes one first", args: { item: 'string' },
    can(e, { item }, ctx) {
      const en = box(ctx.actor)?._of(item)[0];
      if (!en) return 'notEnough';
      const def = inv.item(en.id);
      if (typeof def.use !== 'function') return 'notUsable';
      return def.canUse ? def.canUse(e, { actor: ctx.actor, item: en.id, key: en.key, data: en.data }) : true;
    },
    run(e, { item }, ctx) {
      const c = box(ctx.actor), en = c._of(item)[0], def = inv.item(en.id), info = { actor: ctx.actor, item: en.id, key: en.key, data: en.data };
      if (def.consume) c.remove(en.key, 1);
      def.use(e, info);
      e.events.emit('item:use', info);
      return en.key;
    },
    reasons: { notEnough: 'The actor does not have it', notUsable: 'The item has no use function' },
  });
  e.ops.define('inventory.drop', {
    desc: "Drop items from the actor's container on the ground as a pickup (keeps their data)", args: { item: 'string', n: 'int?' },
    can(e, { item, n = 1 }, ctx) {
      if (!box(ctx.actor)?.has(item, n)) return 'notEnough';
      if (!e.world) return 'noWorld';
      return posOf(e, ctx.actor) ? true : 'noPosition';
    },
    run(e, { item, n = 1 }, ctx) {
      const c = box(ctx.actor), p = posOf(e, ctx.actor);
      let left = n;
      for (const en of c._of(item)) {
        const k = Math.min(left, en.count), { id, data } = en;
        c.remove(en.key, k);
        inv.spawnPickup(id, [p.x, p.y ?? e.surface(p.x, p.z), p.z], { count: k, ...(data && { data }) });   // y picks the floor the actor stands on (bridge deck, upper storey)
        if (!(left -= k)) break;
      }
      return n;
    },
    reasons: { notEnough: 'The actor does not have that many', noWorld: 'Pickups live in world: install world()', noPosition: 'The actor has no position' },
  });
}
