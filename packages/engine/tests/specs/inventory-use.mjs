// An item's use answers like an interaction's onUse: a failure, or a throw, means it was not used. The item stays, item:use stays quiet, the failure reaches the caller.
// Consume still removes first, so what a use does with the room it frees keeps working. Run: threedog test "Inventory use"
export const specs = [
  {
    name: '[guard] Inventory use: a use that answers a failure or throws keeps the item and what it wrote; a use that goes through consumes first, as before',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine, all: T } = window.threedogThreads, quiet = console.error;
        console.error = () => {};
        const E = mk(createEngine, 'inventory-use-' + Math.random());
        E.use(T.world(), T.inventory({ capacity: 2 }));
        await E.start();
        const I = E.inventory, used = [], out = {};
        E.events.on('item:use', x => used.push(x.item));
        let seen = null;
        I.define('refused', { name: 'R', stack: 1, consume: true, use: e => { e.vars.setFlag('half'); return { ok: false, code: 'tooHealthy', facts: { hp: 100 } }; } });
        I.define('broken', { name: 'B', consume: true, use: () => { throw new Error('use broke'); } });
        I.define('potion', { name: 'P', stack: 1, consume: true, use: (e, { key }) => { seen = I.count('potion'); I.add('bottle', 1); return key; } });
        I.define('filler', { name: 'F', stack: 1 }).define('bottle', { name: 'E', stack: 1 });
        E.ops.allow(() => I.add('refused', 1, { data: { hp: 3 } }));
        const a = E.ops.run('inventory.use', { item: 'refused' });
        out.refused = { ok: a.ok, code: a.code, facts: a.facts, count: I.count('refused'), data: I.bag.list()[0]?.data, flag: E.vars.flag('half') ?? null, used: used.length };
        E.ops.allow(() => { I.remove('refused', 1); I.add('broken', 1); });
        const b = E.ops.run('inventory.use', { item: 'broken' });
        out.broken = { ok: b.ok, code: b.code, count: I.count('broken'), used: used.length };
        E.error = null; E.stacks.get('freeze').release('error');
        // a full bag: drinking frees the slot the empty bottle goes in, the reason consume stays first
        E.ops.allow(() => { I.remove('broken', 1); I.add('potion', 1); I.add('filler', 1); });
        const c = E.ops.run('inventory.use', { item: 'potion' });
        out.swap = { ok: c.ok, seen, potions: I.count('potion'), bottles: I.count('bottle'), used: [...used] };
        out.atomic = E.ops.list().find(o => o.name === 'inventory.use').atomic;
        E.dispose(); console.error = quiet;
        return out;
      });
      const J = JSON.stringify;
      check('the failure reaches the caller with its code and facts', r.refused.ok === false && r.refused.code === 'tooHealthy' && r.refused.facts?.hp === 100, J(r.refused));
      check('the item stays, with its data, and no item:use', r.refused.count === 1 && r.refused.data?.hp === 3 && r.refused.used === 0, J(r.refused));
      check('what the use wrote before it said no goes back too', r.refused.flag === null, J(r.refused));
      check('a throw keeps the item, no item:use, and answers error', r.broken.ok === false && r.broken.code === 'error' && r.broken.count === 1 && r.broken.used === 0, J(r.broken));
      check('consume still removes first: the use sees it gone, and the freed slot takes the bottle', r.swap.ok && r.swap.seen === 0 && r.swap.potions === 0 && r.swap.bottles === 1 && r.swap.used.join() === 'potion', J(r.swap));
      check('the op says it rolls back', r.atomic === true);
    },
  },
];
