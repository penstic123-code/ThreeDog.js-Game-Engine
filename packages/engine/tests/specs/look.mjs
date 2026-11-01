// engine.look（core/look/part.js）：分层（engine < style < game(owner) < debug）、owner 记录、不支持的动词报错指路、catalog / describe().look。
// 每个部件一条"不许绕开"：走动词改了以后 describe().look 显示 game:<owner>，删掉那一层后回到 style 的值。
// Same format as specs.mjs; appended at the end of specs.mjs.
export const specs = [
  {
    name: 'look: layers, owners, verbs that a part lacks, debug.override layer, catalog and describe().look',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const T = engine.look.tone, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        out.patch = err(() => T.patch('curve', 'x'));
        out.replace = err(() => T.replace({}));
        out.typo = err(() => T.set({ exposre: 1 }));
        out.bad = err(() => T.set({ exposure: 'bright' }));
        const a = T.set({ exposure: 0.7 }, { owner: 'a' }), b = T.set({ exposure: 0.8 }, { owner: 'b' });
        out.last = T.value('exposure');                                     // the last one written wins
        out.under = engine.describe().look.tone.exposure.under;
        b.remove(); out.afterB = T.value('exposure');                       // the next owner shows again
        const d = engine.debug.override('probe', 'look.tone', { exposure: 3 });
        out.debug = engine.describe().look.tone.exposure.by;
        out.overrides = engine.describe().scene.overrides.some(o => o.target === 'look.tone' && o.owner === 'probe');
        out.cleared = engine.debug.clear('probe'); out.afterDebug = T.value('exposure');
        a.remove(); d.remove();
        out.at = (T.set({ exposure: 0.9 }, { owner: 'at' }), engine.describe().look.tone.exposure.at); T.clear('at');
        const cat = engine.catalog('look.lights'), list = engine.catalog();
        out.why = cat.params['sun.intensity'].why; out.off = cat.params['sun.intensity'].off; out.verbs = engine.catalog('look.env').verbs;
        out.row = list.some(x => x.id === 'look.tone' && x.kind === 'look');
        out.text = engine.describeText?.() ?? '';
        return out;
      });
      check('verbs a part lacks throw look-verb and name the verb to use', r.patch.includes('look-verb') && r.patch.includes('set(') && r.replace.includes('renderer'), JSON.stringify([r.patch, r.replace]));
      check('unknown key / wrong value throw look-param with the fix', r.typo.includes('did you mean exposure') && r.bad.includes('exposure must be'), JSON.stringify([r.typo, r.bad]));
      check('two game owners: the last one written wins, the covered layers are listed, removing one shows the next', r.last === 0.8 && r.under?.[0] === 'game:a' && r.afterB === 0.7, JSON.stringify([r.last, r.under, r.afterB]));
      check('debug.override(owner, look.tone) beats every game owner, is listed in scene.overrides, clear(owner) removes it', r.debug === 'debug:probe' && r.overrides && r.cleared === 1 && r.afterDebug === 0.7, JSON.stringify(r));
      check('the change record names the caller file:line (dev)', /look\.mjs:\d+|\.js:\d+/.test(r.at ?? ''), String(r.at));
      check('catalog: look parts listed, params carry why / off, verbs per part', r.row && r.why && r.off && JSON.stringify(r.verbs) === '["set","replace"]', JSON.stringify([r.row, r.why, r.verbs]));
    },
  },
  {
    name: 'look no bypass: tone / lights / env / clouds set via verb -> game:<owner>; removing that layer restores the style value',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const L = engine.look, info = () => engine.describe().look, out = {};
        // tone
        const s0 = L.tone.value('exposure'), by0 = info().tone.exposure.by;
        const ht = L.tone.set({ exposure: 0.55 }, { owner: 'cave' }); engine.step(0.05);
        out.tone = [info().tone.exposure.by, engine.renderer.toneMappingExposure, engine.describe().render.exposure.by];
        ht.remove(); engine.step(0.05);
        out.toneBack = [L.tone.value('exposure') === s0, info().tone.exposure.by === by0];
        try { engine.setExposure(0.6); } catch (e) { out.alias = e.code; } L.tone.clear('game');
        const m0 = engine.renderer.toneMapping; engine.renderer.toneMapping = m0 === 0 ? 4 : 0;   // straight to three.js
        out.three = info().tone.mapping.by; engine.renderer.toneMapping = m0;
        // lights (sky drives them from the keyframes)
        out.lightBy0 = [info().lights['sun.intensity'].by, info().lights['sun.intensity'].driver];
        const hl = L.lights.set({ sun: { intensity: 5 } }, { owner: 'cave' }); engine.step(0.1);
        out.lights = [info().lights['sun.intensity'].by, engine.lights.sun.intensity, engine.describe().render.lights.find(l => l.name === 'sun').by];
        hl.remove(); engine.step(0.1);
        out.lightsBack = [info().lights['sun.intensity'].by, engine.lights.sun.intensity !== 5];
        // env
        const e0 = L.env.value('@replace') ?? null;
        const he = L.env.replace('sky', { owner: 'cave' }), hi = L.env.set({ intensity: 0.4 }, { owner: 'cave' }); engine.step(0.1);
        out.env = [info().env['@replace'].by, info().env.intensity.by, !!engine.scene.environment, engine.scene.environmentIntensity];
        he.remove(); hi.remove(); engine.step(0.1);
        out.envBack = [(L.env.value('@replace') ?? null) === e0, !!engine.scene.environment === !!e0, info().env.intensity.by];
        engine.look.env.replace('sky'); engine.look.env.set({ intensity: 0.8 }); out.envAlias = info().env['@replace'].by; engine.look.env.replace(false); L.env.clear('game');
        // clouds
        const c0 = L.cloudShadow.value('shadow'); let ce = ''; try { void L.clouds; } catch (e) { ce = e.code; } out.cAlias = [ce, Object.keys(L).includes('clouds')];
        const hc = L.cloudShadow.set({ shadow: 0.5 }, { owner: 'cave' });
        out.clouds = [info().cloudShadow.shadow.by, engine.uniforms.uCloudShadow.value];
        hc.remove(); out.cloudsBack = [engine.uniforms.uCloudShadow.value === c0, info().cloudShadow.shadow.by];
        return out;
      });
      check('tone: set -> game:cave on describe().look and describe().render, renderer follows', r.tone[0] === 'game:cave' && r.tone[1] === 0.55 && r.tone[2] === 'look.tone.exposure', JSON.stringify(r.tone));
      check('tone: removing the layer restores the style value; the old setExposure throws renamed-api; a direct three.js change is tagged three', r.toneBack.every(Boolean) && r.alias === 'renamed-api' && r.three === 'three', JSON.stringify([r.toneBack, r.alias, r.three]));
      check('lights: driven by sky = style; set wins over the keyframes each frame (game:cave); remove hands back to the sky', r.lightBy0[0] === 'style' && r.lightBy0[1] === 'sky' && r.lights[0] === 'game:cave' && r.lights[1] === 5 && r.lights[2] === 'look.lights.sun.intensity' && r.lightsBack[0] === 'style' && r.lightsBack[1], JSON.stringify([r.lightBy0, r.lights, r.lightsBack]));
      check('env: replace / set -> game:cave and the scene environment follows; remove restores the style; set through look.env is owner game', r.env[0] === 'game:cave' && r.env[1] === 'game:cave' && r.env[2] && r.env[3] === 0.4 && r.envBack[0] && r.envBack[1] && r.envAlias === 'game', JSON.stringify([r.env, r.envBack, r.envAlias]));
      check('look.clouds throws renamed-api (the part is look.cloudShadow); it is not listed', r.cAlias[0] === 'renamed-api' && !r.cAlias[1], JSON.stringify(r.cAlias));
      check('cloudShadow (set through look.cloudShadow): set -> game:cave on the uniform; remove restores the style value', r.clouds[0] === 'game:cave' && r.clouds[1] === 0.5 && r.cloudsBack[0] && ['style', 'engine'].includes(r.cloudsBack[1]), JSON.stringify([r.clouds, r.cloudsBack]));
    },
  },
  {
    // 审查 r2：apply 抛错时整层回滚（H1）、set 与 debug.override 同一条校验（M8）、材质只认已知键（M7）、安装失败收走部件（M9）、动词签名（#13）
    name: 'look guards: a throwing apply leaves no layer, debug.override checks like set, materials reject unknown keys, failed install drops its part, verb signatures',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const { defineLookPart } = threedogTest, out = {}, seen = [];
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const p = defineLookPart(engine, { id: 'probeLook', module: 'probe', params: { n: { type: 'number', default: 1, neutral: true } },
          validate: (k, v) => (k === '@replace' && typeof v !== 'string' ? 'must be a name' : null), replace: { accepts: 'a name' },
          apply(v) { if (v.n === 13) throw new Error('apply refused 13'); seen.push(v.n); } });
        p.set({ n: 2 }, { owner: 'a' });
        out.throwMsg = err(() => p.set({ n: 13 }, { owner: 'b' }));
        out.after = [p.value('n'), seen.at(-1), Object.keys(engine.describe().look.probeLook.n.under ?? {}).length, engine.describe().look.probeLook.n.by];
        out.validate = err(() => p.replace(5));
        out.noReplaceRecord = engine.describe().look.probeLook['@replace'];
        out.debugTypo = err(() => engine.debug.override('t', 'look.tone', { exposre: 2 }));
        out.debugFlat = (engine.debug.override('t', 'look.lights', { sun: { intensity: 2 } }), engine.describe().look.lights['sun.intensity'].by); engine.debug.clear('t');
        out.matTypo = err(() => engine.look.materials.set({ wool: { roughnes: 0.3 } }));
        out.matOk = err(() => engine.look.materials.set({ wool: { roughness: 0.3 } }, { owner: 'm' })); engine.look.materials.clear('m');
        out.sig = engine.catalog('look.materials').signatures?.replace ?? '';
        out.sigErr = err(() => engine.look.materials.replace(3));
        out.applies = engine.catalog('look.materials').appliesTo;
        out.install = err(() => engine.use({ name: 'boom', install(e) { defineLookPart(e, { id: 'boomLook', module: 'boom', params: { k: { type: 'number', default: 0, neutral: true } } }); throw new Error('boom'); } }));
        out.gone = engine.look.boomLook === undefined;
        p.dispose();
        return out;
      });
      check('apply throws -> the error reaches the caller, the layer is gone, the old value is applied again', r.throwMsg.includes('13') && r.after[0] === 2 && r.after[1] === 2 && r.after[3] === 'game:a', JSON.stringify([r.throwMsg, r.after]));
      check('spec.validate stops a bad replace value before anything is written', r.validate.includes('must be a name') && r.noReplaceRecord === undefined, JSON.stringify([r.validate, r.noReplaceRecord]));
      check('debug.override goes through set()\'s checks: a typo throws with the fix, nested keys flatten', r.debugTypo.includes('did you mean exposure') && r.debugFlat === 'debug:t', JSON.stringify([r.debugTypo, r.debugFlat]));
      check('materials.set: an unknown spec key throws, a three.js property is accepted', r.matTypo.includes('not a material spec key') && r.matOk === '', JSON.stringify([r.matTypo, r.matOk]));
      check('materials: catalog lists the replace signature and appliesTo; a wrong call quotes the signature', r.sig.startsWith('replace(role') && r.sigErr.includes('replace(role') && /after/.test(r.applies ?? ''), JSON.stringify([r.sig, r.sigErr, r.applies]));
      check('a module whose install throws leaves no look part behind', r.install.includes('boom') && r.gone, JSON.stringify([r.install, r.gone]));
    },
  },
  {
    // 审查 r2 #14：每帧 100 次 set 的耗时（_refresh 每次只取一遍键表；at 只在 owner 第一次写时抓调用栈）
    name: 'look timing: 100 sets per frame on look.materials stay cheap',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev, log }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const M = engine.look.materials, T = engine.look.tone, runs = [];
        for (let rep = 0; rep < 5; rep++) {
          const t0 = performance.now();
          for (let i = 0; i < 100; i++) M.set({ default: { roughness: 0.5 + (i % 10) / 100 } }, { owner: `o${i % 4}` });
          const t1 = performance.now();
          for (let i = 0; i < 100; i++) T.set({ exposure: 0.9 + (i % 10) / 100 }, { owner: `o${i % 4}` });
          runs.push([t1 - t0, performance.now() - t1]);
        }
        for (let i = 0; i < 4; i++) { M.clear(`o${i}`); T.clear(`o${i}`); }
        const best = k => Math.min(...runs.map(x => x[k]));
        return { materials: +best(0).toFixed(2), tone: +best(1).toFixed(2), keys: Object.keys(engine.describe().look.materials).length };
      });
      log?.(`100 sets: materials ${r.materials} ms (${r.keys} keys), tone ${r.tone} ms`);
      check(`100 sets per frame cost under 8 ms (materials ${r.materials} ms with ${r.keys} keys, tone ${r.tone} ms)`, r.materials < 8 && r.tone < 8, JSON.stringify(r));
    },
  },
];
