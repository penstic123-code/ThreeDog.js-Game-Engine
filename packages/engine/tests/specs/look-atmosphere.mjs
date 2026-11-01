// look.fog / look.sky / look.shadow (modules/sky/lookFog.js, lookSky.js, lookShadow.js): 每个部件一条"不许绕开"——
// 走动词改了以后 describe().look 显示 game:<owner>，删掉那一层后回到 style 的值；look.shadow.set 写的是 owner 'game'。
// Same format as specs.mjs; appended at the end of specs.mjs.
export const specs = [
  {
    name: 'look no bypass (atmosphere): fog / sky / shadow set via verb -> game:<owner>; removing that layer restores the style value',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const L = engine.look, info = () => engine.describe().look, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        // fog: far / enabled are live; the sky writes scene.fog every frame from the resolved values
        const far0 = L.fog.value('far'), M = () => engine.sky.modifiers.fog;
        const hf = L.fog.set({ far: 100 }, { owner: 'cave' }); engine.step(0.05);
        out.fog = [info().fog.far.by, engine.scene.fog.far, 100 * M()];
        const hd = L.fog.set({ enabled: false }, { owner: 'cave' }); engine.step(0.05);
        out.fogOff = engine.scene.fog.far > 1e6;
        hd.remove(); hf.remove(); engine.step(0.05);
        out.fogBack = [L.fog.value('far') === far0, info().fog.far.by, engine.scene.fog.far < 1e6];
        out.fogBad = err(() => L.fog.set({ kind: 'cloudy' }));
        out.fogHook = err(() => L.fog.patch('fog', 'not glsl'));
        out.fogCat = [Object.keys(engine.catalog('look.fog').hooks ?? {}), engine.catalog('look.fog').verbs];
        const own = new engine.scene.fog.constructor(0x123456, 5, 50), hr = L.fog.replace(own, { owner: 'cave' }); engine.step(0.05);
        out.fogReplace = [engine.scene.fog === own, info().fog['@replace'].by];
        hr.remove(); engine.step(0.05);
        out.fogReplaceBack = [engine.scene.fog !== own, !!engine.scene.fog];
        // sky: live cloud uniform, a named layer (hook), backdrop
        const c0 = L.sky.value('clouds.coverage'), u = engine.sky.uniforms;
        const hs = L.sky.set({ clouds: { coverage: 0.7 } }, { owner: 'cave' });
        out.sky = [info().sky['clouds.coverage'].by, u.uCloudCover.value];
        hs.remove(); out.skyBack = [u.uCloudCover.value === c0, info().sky['clouds.coverage'].by];
        const glsl = 'vec4 threedogSkyLayer(vec3 d, float t, vec3 s, float n){ return vec4(0.2, 1.0, 0.5, 0.1); }';
        const hl = L.sky.patch('layer:aurora', glsl, { owner: 'cave' });
        out.layer = [info().sky['hook:layer:aurora'].by, engine.sky.dome.material.fragmentShader.includes('threedogSkyLayer0')];
        hl.remove(); out.layerBack = !engine.sky.dome.material.fragmentShader.includes('threedogSkyLayer0');
        out.layerBad = err(() => L.sky.patch('layer:x', 'nope'));
        const hb = L.sky.set({ backdrop: 0x335577 }, { owner: 'cave' }); engine.step(0.05);
        out.backdrop = [info().sky.backdrop.by, engine.sky.dome.visible, engine.scene.background?.getHex?.()];
        hb.remove(); engine.step(0.05); out.backdropBack = engine.sky.dome.visible;
        // shadow: set -> sun.shadow follows; set from the game is owner 'game'
        const r0 = L.shadow.value('radius'), sh = engine.sky.sun.shadow;
        const hh = L.shadow.set({ radius: 3 }, { owner: 'cave' });
        out.shadow = [info().shadow.radius.by, sh.radius, engine.sky.shadow.radius];
        hh.remove(); out.shadowBack = [sh.radius === r0, info().shadow.radius.by];
        engine.look.shadow.set({ bias: -0.001 }); out.alias = [info().shadow.bias.by, sh.bias]; L.shadow.clear('game');
        out.shadowBad = [err(() => L.shadow.set({ cascades: 9 })), err(() => L.shadow.patch('x', 'y')), err(() => L.shadow.replace({}))];
        return out;
      });
      check('fog: set -> game:cave and scene.fog follows (weather scales the distance); enabled false pushes it out of reach; remove restores', r.fog[0] === 'game:cave' && Math.abs(r.fog[1] - r.fog[2]) < 1e-6 && r.fogOff && r.fogBack[0] && r.fogBack[2] && r.fogBack[1] !== 'game:cave', JSON.stringify([r.fog, r.fogOff, r.fogBack]));
      check('fog: bad kind / bad hook throw with the fix; catalog lists the fog hook and the verbs', r.fogBad.includes('look.fog.set()') && r.fogHook.includes('threedogFog') && r.fogCat[0].includes('fog') && r.fogCat[1].length === 3, JSON.stringify([r.fogBad, r.fogHook, r.fogCat]));
      check('fog: replace(THREE.Fog) hands scene.fog to the game (game:cave); remove gives it back to the sky', r.fogReplace[0] && r.fogReplace[1] === 'game:cave' && r.fogReplaceBack.every(Boolean), JSON.stringify([r.fogReplace, r.fogReplaceBack]));
      check('sky: clouds.coverage set -> game:cave on the dome uniform; remove restores the style value', r.sky[0] === 'game:cave' && r.sky[1] === 0.7 && r.skyBack[0] && r.skyBack[1] !== 'game:cave', JSON.stringify([r.sky, r.skyBack]));
      check('sky: patch(layer:<name>) adds a dome layer (game:cave) and the shader text follows; remove takes it out; bad GLSL throws', r.layer[0] === 'game:cave' && r.layer[1] && r.layerBack && r.layerBad.includes('threedogSkyLayer'), JSON.stringify([r.layer, r.layerBack, r.layerBad]));
      check('sky: backdrop set -> game:cave, dome hidden, scene.background is the color; remove brings the dome back', r.backdrop[0] === 'game:cave' && r.backdrop[1] === false && r.backdrop[2] === 0x335577 && r.backdropBack === true, JSON.stringify([r.backdrop, r.backdropBack]));
      check('shadow: set -> game:cave and the sun shadow follows; remove restores; bad cascades / patch / replace throw', r.shadow[0] === 'game:cave' && r.shadow[1] === 3 && r.shadow[2] === 3 && r.shadowBack[0] && r.shadowBack[1] !== 'game:cave'
        && r.alias[0] === 'game' && Math.abs(r.alias[1] + 0.001) < 1e-9 && r.shadowBad[0].includes('1 (one shadow map') && r.shadowBad[1].includes('look-verb') && r.shadowBad[2].includes('look-verb'), JSON.stringify([r.shadow, r.shadowBack, r.alias, r.shadowBad]));
    },
  },
];
