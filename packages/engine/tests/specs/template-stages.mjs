// Saveable placeables have ONE system: content templates. These guards keep it that way (a second registry, a callback interaction or an unsaved
// stage is how two systems come back). Page: tests/placeables (open world + content(), template 'sapling' with stages and an op interaction).
const PAGE = '/tests/placeables/index.html';

export const specs = [
  {
    name: 'Template stages: grows over game time near and far, canGrow holds it, the stage model / scale show, save / load keeps the stage [guard]',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const W = engine.world, P = engine.player, home = P.position.clone(), stages = [];
        const off = engine.events.on('template:stage', d => stages.push(`${d.id}:${d.name}`));
        let allow = false;
        engine.content.load({ templates: { tgrow: {
          model: 'rock', state: { fed: 0 },
          stages: [{ name: 'cold', duration: 1 }, { name: 'warm', duration: 1, scale: 0.5 }, { name: 'armed', model: 'pine' }],
          canGrow: () => allow,
        } } });
        const rec = engine.ops.allow(() => engine.content.spawn('tgrow', { x: home.x + 3, z: home.z }, { id: 'tg-1' }));
        engine.step(3, { render: false });
        const blocked = W.get('tg-1').stage;
        allow = true;
        engine.step(1.2, { render: false });
        const warm = W.get('tg-1').stage;
        engine.world.refresh(); await W.whenReady; engine.step(0.05);
        const scale = W.view('tg-1')?.scale.x;
        // far: no model, still grows (in game seconds), catching up in one pass
        P.placeAt({ x: home.x + 400, z: home.z }); engine.step(3, { render: false });
        const farNoView = W.view('tg-1') === null;
        engine.ops.run('time.skip', { seconds: 30 });
        engine.step(3, { render: false });
        const farStage = W.get('tg-1').stage;
        P.placeAt({ x: home.x, z: home.z }); engine.step(3);
        engine.world.refresh(); await W.whenReady; engine.step(0.1); await W.whenReady; engine.step(0.1);
        const backModel = W.view('tg-1')?.userData.model;
        // save / load: the stage is world data like any state field
        engine.saves.save('tstage');
        const json = JSON.parse(atob(engine.saves.export('tstage')));
        engine.ops.allow(() => W.set('tg-1', { stage: 0 }));
        engine.saves.load('tstage');
        const loaded = W.get('tg-1');
        off.remove();
        return { id: rec.id, kind: rec.kind, auto: engine.ops.allow(() => engine.content.spawn('tgrow', { x: home.x + 5, z: home.z })).id, blocked, warm, scale, farNoView, farStage, backModel,
          saved: json.parts.world.records['tg-1']?.stage, loadedStage: loaded?.stage, loadedAt: Number.isFinite(loaded?.stageAt), stages,
          field: engine.content.fields('tgrow').stage };
      });
      check('canGrow false holds the first stage; true lets it grow', r.blocked === 0 && r.warm === 1, JSON.stringify(r));
      check('a stage scale multiplies the copy scale', Math.abs(r.scale - 0.5) < 1e-6, JSON.stringify(r));
      check('far: no model, still reaches the last stage by game time', r.farNoView && r.farStage === 2, JSON.stringify(r));
      check('back near: the copy is rebuilt with the stage model', r.backModel === '"pine"', JSON.stringify(r));
      check('[guard] save holds the stage and load restores it (stageAt too)', r.saved === 2 && r.loadedStage === 2 && r.loadedAt, JSON.stringify(r));
      check('template:stage fires per change; a spawned id without fields.id is <template>#<n>', r.stages.includes('tg-1:warm') && r.stages.includes('tg-1:armed') && /^tgrow#\d+$/.test(r.auto), JSON.stringify(r));
      check('stage is a described state field (int 0..n-1, default 0) for content.fields / the editor', r.field?.type === 'int' && r.field.min === 0 && r.field.max === 2 && r.field.default === 0, JSON.stringify(r.field));
    },
  },
  {
    name: 'Template update runs on the fixed step (once per step, fixed dt) and its writes stay on the record [guard]',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const p = engine.player.position;
        let calls = 0, dts = 0;
        engine.content.load({ templates: { tturret: { model: 'rock', state: { heat: 0 }, update: (rec, dt) => { calls++; dts += dt; rec.heat += dt; } } } });
        engine.ops.allow(() => engine.content.spawn('tturret', { x: p.x + 2, z: p.z }, { id: 'tt-1' }));
        engine.step(0.05);
        const s0 = engine.world.steps, c0 = calls, d0 = dts;
        engine.step(1, { render: false });
        const steps = engine.world.steps - s0, ran = calls - c0;
        return { steps, ran, heat: engine.world.get('tt-1').heat, dts: dts - d0 };
      });
      check('[guard] update ran once per fixed step and wrote saved state', r.steps > 0 && r.ran === r.steps && Math.abs(r.dts - r.steps / 60) < 0.02 && r.heat > 0.9, JSON.stringify(r));
    },
  },
  {
    name: 'Template interaction runs its op (no onUse callbacks); engine.entities and engine.spawn do not exist [guard]',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const p = engine.player.position, err = f => { try { f(); return null; } catch (e) { return e.message; } };
        engine.ops.allow(() => engine.content.spawn('sapling', { x: p.x + 1, z: p.z }, { id: 'ts-1' }));
        engine.world.refresh(); await engine.world.whenReady; engine.step(0.1);
        const ids = engine.interactions.items.map(i => i.id);
        const use = engine.ops.run('interaction.use', { id: 'ts-1' });
        return {
          listed: ids.includes('ts-1'), ok: use.ok, watered: engine.world.get('ts-1').watered,
          onUse: err(() => engine.content.load({ templates: { tbad: { model: 'rock', interact: { op: 'sapling.water', onUse: () => {} } } } })),
          badStage: err(() => engine.content.load({ templates: { tbad2: { model: 'rock', stages: [{ name: 'a' }, { name: 'b' }] } } })),
          entities: typeof engine.entities, spawn: typeof engine.spawn,
        };
      });
      check('[guard] using an instance runs the template op with its id (interaction id = record id)', r.listed && r.ok && r.watered === true, JSON.stringify(r));
      check('[guard] interact.onUse is refused (interactions are ops)', /onUse/.test(r.onUse ?? ''), String(r.onUse));
      check('a stages list the engine cannot run is refused at load (same rules as content-check)', /stages\[0\] needs duration/.test(r.badStage ?? ''), String(r.badStage));
      check('[guard] no second placement system: engine.entities and engine.spawn are undefined', r.entities === 'undefined' && r.spawn === 'undefined', JSON.stringify(r));
    },
  },
];
