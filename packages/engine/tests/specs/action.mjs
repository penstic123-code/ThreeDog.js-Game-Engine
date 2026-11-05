// Action example (examples/action, page /action.html): the combat rules are the example's ops, driven here by real input and by ops.
// Guard: walking with W reaches the slime, Mouse0 swings (through a real pointer lock: setPointerCapture once threw InvalidStateError while locked),
// the slime loses hp, dies, leaves a drop that E picks up into the bag; save / load restores hp, bag and the slime; every death mode works;
// the rules run with no picture code (?picture=none); the picture is the page's own lights, the engine's stay out of the scene.
const READY = { timeout: 60000 };
const open = async (page, q = '') => { await page.goto(new URL('/action.html' + q, page.url()).href); await page.waitForFunction(() => window.engine?.stateApplied && engine.world.ready, null, READY); };
const state = () => {
  const a = engine.describe().action, p = engine.player.position, s = engine.world.get('slime-1');
  return { ...a, px: p.x, pz: p.z, slime: s ? { hp: s.hp, d: Math.hypot(s.position.x - p.x, s.position.z - p.z) } : null,
    drop: !!engine.world.get('slime-1-drop'), gems: engine.inventory.count('gem') };
};
const swings = () => engine.ops.recent('player.attack').filter(r => r.source === 'player' && r.ok).reduce((n, r) => n + (r.count ?? 1), 0);

export const specs = [
  {
    name: 'Action example: walk to the slime, Mouse0 attack under pointer lock, kill, drop, pick up, save / load',
    url: '/action.html',
    async run({ page, check, ev, frames }) {
      await page.waitForFunction(() => engine.world.ready, null, READY);
      let s = await ev(state);
      check('the room is content: one slime with 3 hp, player at full hp', s.slime?.hp === 3 && s.hp === 5 && s.slimes.length === 1, JSON.stringify(s));
      check('templates built the room (floor, walls, slime have models)', await ev(() => ['floor', 'wall-n', 'slime-1'].every(id => !!engine.world.view(id))));
      check('the picture is picture/: its own sun lights the room, the engine placeholder is out of the scene', await ev(() => { const { sun, hemi } = actionTest.picture; return sun.parent === engine.scene && sun.intensity > 0 && hemi.intensity > 0 && !engine.lights.sun.parent; }));

      // Walk with the real keyboard until the slime is in reach (it also comes closer once the player is within its aggro radius)
      const d0 = s.slime.d;
      await page.keyboard.down('KeyW');
      await ev(() => __t.until(() => { const r = engine.world.get('slime-1'), p = engine.player.position; return Math.hypot(r.position.x - p.x, r.position.z - p.z) < 1.5; }, 30000).catch(() => false));
      await page.keyboard.up('KeyW');
      s = await ev(state);
      check('W walks the player to the slime', s.slime.d < 1.6 && s.slime.d < d0, `distance ${d0.toFixed(2)} -> ${s.slime.d.toFixed(2)}`);

      // Real pointer lock: the first click locks the mouse (followCamera overShoulder has pointerLock), later clicks are Mouse0 while locked
      const box = await page.locator('#view').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const swings0 = await ev(swings);
      await page.mouse.click(cx, cy);
      const locked = await ev(() => __t.until(() => document.pointerLockElement === engine.renderer.domElement, 5000).then(() => true, () => false));
      check('a real click locks the pointer on the canvas', locked, 'headless Chromium did not grant pointer lock');
      // the click that locked the pointer is swallowed: it must not swing
      await frames(4);
      check('the click that locks the pointer is not a Mouse0 press (no swing)', await ev(swings) === swings0, `swings ${swings0} -> ${await ev(swings)}`);
      const before = await ev(swings), hp0 = (await ev(state)).slime.hp;
      await page.mouse.down(); await frames(4); await page.mouse.up(); await frames(2);
      s = await ev(state);
      check('Mouse0 (real mouse, pointer locked) reached the attack action and ran player.attack', await ev(swings) > before, `swings ${before} -> ${await ev(swings)}`);
      check('the swing took 1 hp off the slime', s.slime?.hp === hp0 - 1, JSON.stringify(s.slime));

      // Save mid-fight, then finish it by ops (the same rule the mouse runs)
      check('save mid-fight', await ev(() => engine.saves.save('fight')));
      const mid = await ev(state);
      await ev(async () => { for (let i = 0; i < 6 && engine.world.get('slime-1'); i++) { await __t.until(() => engine.ops.can('player.attack').ok, 5000); engine.ops.run('player.attack'); } });
      s = await ev(state);
      check('the slime dies at 0 hp and leaves its drop', !s.slime && s.drop && s.slimes.length === 0, JSON.stringify(s));
      check('a kill is counted in vars', await ev(() => engine.vars.counter('kills')) === 1);

      // Pick up the drop with the real E key (presets.interactions.nearest)
      await ev(() => __t.until(() => engine.world.view('slime-1-drop'), 5000).catch(() => false));   // its prompt exists once the model is built
      await page.keyboard.press('KeyE');
      await ev(() => __t.until(() => engine.inventory.count('gem') === 1, 5000).catch(() => false));
      s = await ev(state);
      check('E picks the drop into the bag', s.gems === 1 && !s.drop, JSON.stringify(s));
      check('save after the pickup', await ev(() => engine.saves.save('after')));
      const after = await ev(state);

      check('load mid-fight', await ev(() => engine.saves.load('fight')));
      s = await ev(state);
      check('load brings back the slime with its hp, the player hp and an empty bag', s.slime?.hp === mid.slime.hp && s.hp === mid.hp && s.gems === 0 && !s.drop,
        `${JSON.stringify(mid.slime)} hp ${mid.hp} -> ${JSON.stringify(s.slime)} hp ${s.hp} gems ${s.gems}`);
      check('load after the pickup', await ev(() => engine.saves.load('after')));
      s = await ev(state);
      check('the slime stays dead and the gem stays in the bag', !s.slime && s.gems === 1 && s.hp === after.hp, JSON.stringify(s));

      // Death by the slime's own AI (fixed steps only): stand still mid-fight until hp runs out; default mode respawns at the spawn point
      await ev(() => engine.saves.load('fight'));
      s = await ev(() => { engine.haltLoop(); engine.step(12, { render: false }); const r = { ...engine.describe().action, p: engine.player.position.clone() }; engine._unhalt(); return r; });
      check('the slime attacks on its own and the player dies, then respawns at full hp', s.deaths >= 1 && !s.over && s.hp > 0, JSON.stringify(s));
      check('enemy.attack ran with the slime as actor', await ev(() => engine.ops.recent('enemy.attack').some(r => r.ok && r.actor === 'slime-1')));
    },
  },
  {
    name: 'Action example: death modes gameover (R retries) and restart (room reset), and no picture code',
    url: '/action.html?death=gameover',
    async run({ page, check, ev, frames }) {
      await page.waitForFunction(() => engine.world.ready, null, READY);
      await ev(() => { engine.ops.run('enemy.damage', { id: 'slime-1', amount: 1 }); engine.ops.run('player.die'); });
      check('gameover: dying stops the game', await ev(() => engine.describe().action.over && engine.ops.run('player.attack').code === 'dead'));
      await page.keyboard.press('KeyR');
      const back = await ev(() => __t.until(() => !engine.describe().action.over, 10000).then(() => ({ ...engine.describe().action }), () => null));
      check('R starts a new game: hp full, the slime back at 3 hp', back?.hp === 5 && back.slimes[0]?.hp === 3 && back.deaths === 0, JSON.stringify(back));

      await open(page, '?death=restart');
      await ev(() => { for (let i = 0; i < 3; i++) engine.ops.run('enemy.damage', { id: 'slime-1', amount: 1 }); });
      check('restart: the slime is dead before dying', await ev(() => !engine.world.get('slime-1')));
      await ev(() => engine.ops.run('player.die'));
      const reset = await ev(() => __t.until(() => engine.world.get('slime-1') && !engine.describe().action.over, 10000).then(() => engine.describe().action, () => null));
      check('restart: dying resets the room (slime back, hp full)', reset?.slimes[0]?.hp === 3 && reset.hp === 5, JSON.stringify(reset));

      await open(page, '?picture=none');
      await frames(3);
      check('no picture code: the room and the slime still build, under the engine placeholder lights', await ev(() => !actionTest.picture && !!engine.lights.sun.parent && ['floor', 'slime-1'].every(id => !!engine.world.view(id))));
      check('no picture code: attacking still works', await ev(() => { engine.player.placeAt({ x: 0, z: 1.6 }); return __t.until(() => engine.ops.can('player.attack').ok).then(() => engine.ops.run('player.attack').ok); }));
    },
  },
];
