// External-game friction fixes: inventory pauseGame, atomic trade + undo, pickup failure reason through interaction.use, teleport-then-lookAt, static model without Animator warnings.

export const specs = [
  {
    name: 'Friction: inventory pauseGame freezes while open; trade is all-or-nothing and undoable',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const I = engine.inventory;
        I.define('key1', { name: 'rusty key', stack: 1 }).define('key2', { name: 'gold key', stack: 1 }).define('gem', { name: 'gem', stack: 1 });
        const out = {};
        I.pauseGame = true; engine.ui.open('inventory'); out.frozenOpen = engine.frozen; engine.ui.close('inventory'); out.frozenClosed = engine.frozen;
        I.pauseGame = false; engine.ui.open('inventory'); out.frozenOff = engine.frozen; engine.ui.close('inventory');
        const bag = I.bag, cap0 = bag.capacity; bag.capacity = bag.slotsUsed + 2;   // the bag may already hold starting items
        engine.ops.allow(() => { I.add('key1', 1, { silent: true, data: { rust: 3 } }); I.add('gem', 1, { silent: true }); });
        out.fullAdd = I.add('key2', 1, { silent: true });   // bag full: a plain add fails
        const args = { take: 'key1', give: 'key2' };
        out.can = engine.ops.can('inventory.trade', args);
        const t = engine.ops.run('inventory.trade', args);
        out.trade = { ok: t.ok, key1: I.count('key1'), key2: I.count('key2'), gem: I.count('gem') };
        out.badReason = engine.ops.run('inventory.trade', { take: 'key1', give: 'gem' }).reason;   // key1 is gone now
        const u = engine.ops.undo('inventory.trade', args, t.value);
        out.undo = { ok: u.ok, key1: I.count('key1'), key2: I.count('key2'), data: I.list().find(x => x.id === 'key1')?.data };
        const full = engine.ops.run('inventory.trade', { take: 'gem', give: 'key2', giveN: 2 });   // two keys cannot fit after removing one gem
        out.fullReason = full.reason; out.afterFull = { key1: I.count('key1'), gem: I.count('gem'), key2: I.count('key2') };
        bag.capacity = cap0;
        return out;
      });
      check('pauseGame: true freezes while open and unfreezes on close; false does not freeze', r.frozenOpen === true && r.frozenClosed === false && r.frozenOff === false, JSON.stringify(r));
      check('trade works in a full bag, and fails with notEnough when A is missing', r.fullAdd === false && r.can.ok && r.trade.ok && r.trade.key1 === 0 && r.trade.key2 === 1 && r.trade.gem === 1 && r.badReason === 'notEnough', JSON.stringify(r));
      check('trade undo gives A back with its data and takes B away', r.undo.ok && r.undo.key1 === 1 && r.undo.key2 === 0 && r.undo.data?.rust === 3, JSON.stringify(r.undo));
      check('failed trade (does not fit) changes nothing and says full', r.fullReason === 'full' && r.afterFull.gem === 1 && r.afterFull.key1 === 1 && r.afterFull.key2 === 0, JSON.stringify(r.afterFull));
    },
  },
  {
    name: 'Friction: pickup in a full bag, interaction.use passes { ok: false, reason: full } as value',
    url: '/?cutscene=skip',
    async run({ check, ev, frames }) {
      await ev(() => {
        const I = engine.inventory; I.define('gem', { name: 'gem', stack: 1 }).define('ring', { name: 'ring', stack: 1 });
        engine.ops.allow(() => I.add('gem', 1, { silent: true })); I.bag.capacity = 1;
        const p = engine.actorPosition();
        I.spawnPickup('ring', [p.x + 0.3, p.y ?? 0, p.z], { id: 'p-full' });
      });
      await frames(10);
      const r = await ev(() => ({ res: engine.ops.run('interaction.use', { id: 'p-full' }), still: !!engine.world.get('p-full') }));
      check('full bag: value carries { ok:false, reason:"full" } and the pickup stays on the ground', r.res.ok && r.res.value?.ok === false && r.res.value.reason === 'full' && r.still, JSON.stringify(r));
    },
  },
  {
    name: 'Friction: first person teleport then lookAt uses the new position; a clip-less model gets no Animator warning',
    url: '/tests/cameras/index.html?cam=follow',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        engine.setCamera('firstPerson', { height: 1.6 });
        const P = engine.player; P.placeAt([60, 0, 80]);
        const eyeY = P.root.position.y + 1.6;
        engine.cameraRig.lookAt([60, eyeY, 70]);   // 10 m straight ahead (-z), level with the new eye
        const out = { yaw: engine.cameraRig.yaw, pitch: engine.cameraRig.pitch };
        const warns = [], w = console.warn; console.warn = (...a) => { warns.push(String(a[0])); w(...a); };
        const g = new THREE.Group(), a = engine.assets.animate(g, { states: { idle: { clip: 'Idle' } } });
        out.got = a.go('idle'); a.action('wave'); a.dispose();
        console.warn = w;
        out.warns = warns.filter(x => /idle|Idle|clip|animState/.test(x)); out.has = a.hasClips;
        return out;
      });
      check('lookAt right after placeAt aims from the new eye (yaw 0, level)', Math.abs(r.yaw) < 0.01 && Math.abs(r.pitch) < 0.01, JSON.stringify(r));
      check('animate() on a model without clips: no warning, go() returns null', r.got === null && r.warns.length === 0 && r.has === false, JSON.stringify(r));
    },
  },
];
