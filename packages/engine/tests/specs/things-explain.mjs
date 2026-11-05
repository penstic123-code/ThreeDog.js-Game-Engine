// engine.thing(id).explain() and engine.debug.override (recipes/40-scene.md): one id answers definition, materials, rules, related ops and
// save status; diagnostic overrides belong to an owner, show in describe().scene.overrides, are never saved and clear without a trace.
export const specs = [
  {
    name: 'Thing explain + debug overrides: one id links definition / materials / ops / rules; override with owner, handle.remove, clear(owner), describe lists them',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        'use strict';
        engine.haltLoop();
        const T = __threedogThree, p = engine.player.position, x = Math.round(p.x) + 6, z = Math.round(p.z);
        const mesh = new T.Mesh(new T.BoxGeometry(1, 2, 1), Object.assign(new T.MeshLambertMaterial({ color: 0xaa3322 }), { userData: { purpose: 'prop' } }));
        mesh.position.set(x, engine.surface(x, z), z);
        engine._things.setup = true; engine.add(mesh, { id: 'probe-box' }); engine._things.setup = false;
        engine.content.load({ templates: { probe: { model: 'rock', collide: 'box' } }, props: [{ template: 'probe', id: 'probe-rec', x: x + 4, z }] });
        for (let i = 0; i < 40 && !engine.world.view('probe-rec'); i++) { engine.step(0.1); await new Promise(res => setTimeout(res, 0)); }
        engine.ops.define('probe.poke', { desc: 'poke the probe', targets: 'probe', args: { id: 'string' }, run: () => {} });
        const err = f => { try { f(); return null; } catch (e) { return e.message; } };
        const a = engine.thing('probe-box').explain(), b = engine.thing('probe-rec').explain();
        const col0 = mesh.material.color.getHex(), mat0 = mesh.material;
        const h = engine.debug.override('ai', 'probe-box', { material: 'flat' }), h2 = engine.debug.override('ai', 'probe-box', { visible: false });
        const other = engine.debug.override('view', mesh, { material: 'wire' });
        const during = { mat: mesh.material.type, vis: mesh.visible, ov: engine.describe().scene.overrides, again: engine.thing('probe-box').explain().overrides, saved: JSON.stringify(engine._things.save()) };
        const removed = engine.debug.clear('ai');
        const mid = { vis: mesh.visible, wire: mesh.material.wireframe, ov: engine.describe().scene.overrides.length };
        h.remove();
        other.remove();
        const after = { same: mesh.material === mat0, col: mesh.material.color.getHex() === col0, vis: mesh.visible, ov: engine.describe().scene.overrides };
        return { a, b, during, removed, mid, after, h2: typeof h2.remove, bad: [err(() => engine.debug.override('', 'probe-box', {})), err(() => engine.debug.override('x', 'probe-box', { colour: 1 })),
          err(() => engine.debug.override('x', 'probe-box', { material: 'glossy' }))] };
      });
      const { a, b } = r;
      check('plain object: definition (at is null for page-evaluated code), materials with role, ops thing.set, save tier code, permanent edit names the id', 'at' in a.definition && a.materials[0]?.role === 'prop'
        && a.ops.some(o => o.op === 'thing.set') && a.saved.tier === 'code' && a.change.permanent.includes('probe-box'), JSON.stringify(a).slice(0, 600));
      check('template record: template + model, collide box -> blocksMovement, height, related op via targets, save tier record', b.definition.template === 'probe' && b.model != null
        && b.rules.blocksMovement === 'box' && b.rules.height > 0 && b.ops.some(o => o.op === 'probe.poke') && b.saved.tier === 'record', JSON.stringify(b).slice(0, 600));
      check('override: flat material + hidden, listed by describe and thing.explain (owners ai / view), never in the save', r.during.mat === 'MeshBasicMaterial' && r.during.vis === false
        && r.during.ov.length === 3 && r.during.again.length === 3 && !r.during.saved.includes('"visible":false'), JSON.stringify(r.during).slice(0, 500));
      check('clear(owner) removes only that owner (3 -> 1 left: view wire), a later handle.remove is harmless', r.removed === 2 && r.mid.vis === true && r.mid.wire === true && r.mid.ov === 1, JSON.stringify(r.mid));
      check('everything restored: original material object, colour, visibility, no overrides listed', r.after.same && r.after.col && r.after.vis && r.after.ov === undefined, JSON.stringify(r.after));
      check('bad calls throw with the fix (owner, unknown field, material)', r.bad.every(m => m && m.length > 30), JSON.stringify(r.bad));
    },
  },
];
