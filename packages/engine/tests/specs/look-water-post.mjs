// look.water / look.weather / look.post (modules/water/look.js, modules/weather/look.js, render/postLook.js).
// Each part has one "no bypass" test: a change made with a verb shows up in describe().look as game:<owner>, and removing that layer gives the style value back.
// Water and weather get their own small engine (the style decides the start values); post uses the page engine and its style's effects.
// Same format as the other files here.

const MAKE = `
  const { createEngine, water, weather, sky, terrain } = threedogTest;
  const make = (style, mods) => { const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'look-wp', style }); e.use(...mods); return e; };
  const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
`;
const page = fn => new Function(`${MAKE}\nreturn (${fn})();`);

export const specs = [
  {
    name: 'look no bypass: water set / patch / replace -> game:<owner>; removing the layer restores the style value and the material',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {}, e = make({ water: { opacity: 0.7, waveHeight: 1.5 } }, [water({ sea: false })]), W = e.look.water, info = () => e.describe().look.water;
        out.by0 = [info().opacity.writer, info().opacity.value, e.water.material.opacity];
        W.set({ opacity: 0.4, waveHeight: 2 }, { owner: 'cave' });
        out.set = [info().opacity.writer, e.water.material.opacity, info().waveHeight.writer, e.water._u.uWave.value];
        const m0 = e.water.material;
        W.patch('wave', 'float threedogWaterWave(vec3 p, float t) { return sin(p.x + t) * 0.1; }', { owner: 'cave' });
        out.patch = [info()['hook:wave']?.writer, e.water.material !== m0];
        W.set({ foam: { color: 0xffffff } }, { owner: 'cave' });
        out.foam = [info().foam.writer, /threedogWaterSurface/.test(e.water.material.customProgramCacheKey()) || e.water.material !== m0];
        out.badGlsl = err(() => W.patch('wave', 'float nope() { return 1.0; }', { owner: 'cave' }));
        out.badHook = err(() => W.patch('waves', 'x'));
        out.badFoam = err(() => W.set({ depthColor: { by: 'sideways' } }, { owner: 'cave' }));
        out.replaceBad = err(() => W.replace(5));
        W._clear('cave');
        out.back = [info().opacity.writer, info().opacity.value, e.water.material.opacity, info().waveHeight.writer, e.water._u.uWave.value, info()['hook:wave']];
        const cat = e.catalog('look.water');
        out.cat = [cat.verbs.join(), !!cat.hooks.wave, !!cat.replace];
        e.dispose();
        return out;
      }));
      check('water: style layer at start, set -> game:cave and the live material / uniform follow', r.by0.join() === 'style,0.7,0.7' && r.set.join() === 'game:cave,0.4,game:cave,2', JSON.stringify([r.by0, r.set]));
      check('water: patch(wave) and set({foam}) rebuild the material, recorded as game:cave', r.patch.join() === 'game:cave,true' && r.foam[0] === 'game:cave' && r.foam[1], JSON.stringify([r.patch, r.foam]));
      check('water: bad hook / glsl / foam / replace throw with the fix', r.badGlsl.includes('threedogWaterWave') && r.badHook.includes('look-verb') && r.badFoam.length > 0 && r.replaceBad.includes('look.water.replace'), JSON.stringify([r.badGlsl, r.badHook, r.badFoam, r.replaceBad]));
      check('water: clear(owner) restores the style values and the plain material', r.back[0] === 'style' && r.back[1] === 0.7 && r.back[2] === 0.7 && r.back[3] === 'style' && r.back[4] === 1.5 && r.back[5] === undefined, JSON.stringify(r.back));
      check('water: catalog lists set / patch / replace', r.cat.join() === 'set,patch,replace,true,true', JSON.stringify(r.cat));
    },
  },
  {
    name: '[guard] one entry per look value: water / sky / terrain look options throw naming the look call; the moved keys are live look params fed by the style',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        out.moved = [err(() => water({ color: 0x3070a0 })), err(() => water({ normalMap: 'n' })), err(() => sky({ moonSize: 900 })), err(() => sky({ skybox: 'pano' })),
          err(() => sky({ dim: { stars: false } })), err(() => terrain({ normals: 'flat' })), err(() => water({ material: () => null }))];
        out.kept = [err(() => water({ sea: false, level: 1, flat: true, size: 50, segments: 8, uniforms: { uK: 1 } })), err(() => sky({ time: '12:00', fog: false, sun: true, hemisphere: true }))];
        // water: the style layer feeds the new keys; set changes the live material; a normal map set later rebuilds it and tiles the body's UVs
        const e = make({ water: { shininess: 40 } }, [water({ sea: false })]), W = e.look.water, info = () => e.describe().look.water;
        e.addWaterBody({ position: [0, 0, 0], radius: 30, level: 1 });
        const uv0 = e.water.bodies.values().next().value.geometry.attributes.uv.getX(0);
        out.w0 = [info().shininess.writer, W.value('shininess'), e.water.normalMap];
        W.set({ shininess: 10, specular: 0x112233, normalMap: 'water-n', normalScale: 0.8 }, { owner: 'cave' });
        const m = e.water.material, uv1 = e.water.bodies.values().next().value.geometry.attributes.uv.getX(0);
        // shininess / specular reach a Phong water material only (the neutral 'water' role may be another lit kind): read the value in effect too
        const phong = !!m.isMeshPhongMaterial;
        out.w1 = [info().shininess.writer, W.value('shininess'), phong ? m.shininess === 10 && m.specular.getHex() === 0x112233 : true, !!e.water.normalMap && m.normalMap === e.water.normalMap, m.normalScale.x, uv0 !== uv1];
        W._clear('cave');
        out.w2 = [W.value('shininess'), e.water.normalMap];
        e.dispose();
        // sky: style.sky values are the style layer; set writes the dome uniform / the sun path / the dim switch live
        const s = make({ sky: { moonSize: 900, dim: { stars: false } } }, [sky()]), S = s.look.sky, si = () => s.describe().look.sky, U = s.sky.uniforms;
        out.s0 = [si().moonSize.writer, U.uMoonSize.value, si()['dim.stars'].writer, U.uStarCloudDim.value];
        S.set({ moonSize: 500, orbitTilt: 0.1, dim: { stars: true }, gradientCurve: 0.3 }, { owner: 'cave' });
        out.s1 = [si().moonSize.writer, U.uMoonSize.value, s.sky.orbit.tilt, U.uStarCloudDim.value, U.uCurve.value];
        out.sBad = err(() => S.set({ keyframes: [[0.5, 0, 0, 0, 1, 1]] }));
        S._clear('cave');
        out.s2 = [U.uMoonSize.value, U.uStarCloudDim.value];
        s.dispose();
        return out;
      }));
      check('removed look options throw naming the look call (water / sky / terrain; water({ material }) names look.water.replace)', r.moved[0].includes('engine.look.water.set({ color })') && r.moved[1].includes('look.water.set({ normalMap })')
        && r.moved[2].includes('engine.look.sky.set({ moonSize })') && r.moved[3].includes('engine.look.sky.replace(skybox)') && r.moved[4].includes('look.sky.set({ dim })')
        && r.moved[5].includes('engine.look.ground.set({ normals })') && r.moved[6].includes('engine.look.water.replace('), JSON.stringify(r.moved));
      check('structural options stay (water sea / level / flat / size / segments / uniforms; sky time / fog / sun / hemisphere)', r.kept.join('') === '', JSON.stringify(r.kept));
      check('water: style shininess is the style layer; set -> material shininess / specular / normalMap / normalScale and the UVs tile; clear restores', r.w0.join() === 'style,40,'
        && r.w1.join() === 'game:cave,10,true,true,0.8,true' && r.w2[0] === 40 && r.w2[1] === null, JSON.stringify([r.w0, r.w1, r.w2]));
      check('sky: style moonSize / dim.stars are the style layer; set -> uniforms and the sun path; bad keyframes throw; clear restores', r.s0.join() === 'style,900,style,0'
        && r.s1.join() === 'game:cave,500,0.1,1,0.3' && /keyframes/.test(r.sBad) && r.s2.join() === '900,0', JSON.stringify([r.s0, r.s1, r.sBad, r.s2]));
    },
  },
  {
    name: 'look no bypass: weather set / patch / replace -> game:<owner>; removing the layer restores the style look',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {}, types = { clear: {}, rain: { rain: 1 }, ashfall: { ash: 1 } };
        const e = make({ weather: { rain: { speed: 30, color: 0x99aabb } } }, [sky(), weather({ types })]), W = e.look.weather, info = () => e.describe().look.weather, sys = () => e.weatherLook.systems.get('rain');
        out.by0 = [info()['rain.speed'].writer, info()['rain.speed'].value, sys().spec.speed, info()['rain.opacity'].writer];
        W.set({ 'rain.speed': 10, rain: { length: 2 } }, { owner: 'cave' });
        out.set = [info()['rain.speed'].writer, sys().spec.speed, info()['rain.length'].writer, sys().uniforms.uLen.value];
        const FRAG = 'uniform float uOpacity; uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(1.0, 0.0, 1.0, vA * uOpacity); }';
        W.patch('rain.fragment', FRAG, { owner: 'cave' });
        out.patch = [info()['hook:rain.fragment']?.writer, sys().object.material.fragmentShader.includes('1.0, 0.0, 1.0')];
        out.snow = err(() => { W.set({ 'snow.size': 8 }, { owner: 'cave' }); });   // no snow in the table: warns once, does not throw
        out.badKey = err(() => W.set({ 'rain.colour': 1 }, { owner: 'cave' }));
        out.badHook = err(() => W.patch('fog', 'x'));
        out.badReplace = err(() => W.replace([1]));
        W._clear('cave');
        out.back = [info()['rain.speed'].writer, info()['rain.speed'].value, sys().spec.speed, info()['hook:rain.fragment'], sys().object.material.fragmentShader.includes('1.0, 0.0, 1.0')];
        // look.weather.replace({ field: spec }) is one object per owner: a second call must list the earlier fields again
        const ashSpec = { shape: 'soft', color: 0x555555 }; e.look.weather.replace({ ash: ashSpec }); const a = e.weatherLook.systems.get('ash');
        out.define = [info()['@replace']?.writer, e.weatherLook.systems.get('ash') === a, a.object.isPoints];
        e.look.weather.replace({ ash: ashSpec, rain: { create: () => ({ object: new threedogTest.THREE.Group() }) } }); const own = e.weatherLook.systems.get('rain');
        out.rainOwn = [e.weatherLook.systems.get('rain') === own, e.weatherLook.systems.has('ash')];
        W._clear('game');
        out.cleared = [e.weatherLook.systems.has('ash'), e.weatherLook.systems.get('rain').spec?.speed, info()['@replace']];
        out.cat = e.catalog('look.weather').verbs.join();
        e.dispose();
        return out;
      }));
      check('weather: style rain values are the style layer; set -> game:cave rebuilds the system with them', r.by0.join() === 'style,30,30,engine' && r.set.join() === 'game:cave,10,game:cave,2', JSON.stringify([r.by0, r.set]));
      check('weather: patch(rain.fragment) swaps the whole shader text, recorded as game:cave', r.patch.join() === 'game:cave,true', JSON.stringify(r.patch));
      check('weather: a field the table lacks does not throw; unknown key / hook / replace value throw with the fix', r.snow === '' && r.badKey.includes('did you mean') && r.badHook.includes('look-verb') && r.badReplace.includes('look.weather.replace'), JSON.stringify([r.snow, r.badKey, r.badHook, r.badReplace]));
      check('weather: clear(owner) gives the style speed and the default shader back', r.back.join() === 'style,30,30,,false', JSON.stringify(r.back));
      check('weather: replace({ ash }) is the game replace layer, adds fields, and clear gives rain back to the style', r.define.join() === 'game,true,true' && r.rainOwn.join() === 'true,true' && r.cleared.join() === 'false,30,' && r.cat === 'set,patch,replace', JSON.stringify([r.define, r.rainOwn, r.cleared, r.cat]));
    },
  },
  {
    name: 'look no bypass: post set / add / replace -> game:<owner>; removing the layer restores the effect default; the chain reads the records',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { vignette, grain } = threedogTest.postEffects, p = engine.post, L = engine.look.post, out = {};
        const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
        const info = () => engine.describe().look.post, rp = n => engine.describe().render.post.find(x => x.name === n);
        p.setAntialias(false);
        const styleNames = p.list().map(x => x.name);
        L.replace([vignette({ enabled: true, strength: 0.5 })], { owner: 'base' });   // the chain the rest of the test works on (cleared before the restore check)
        out.add = [info()['@replace']?.writer, info()['vignette.strength'].value, rp('vignette').look];
        out.alias = [];
        // verbs
        const h2 = p.get('vignette');
        L.set({ vignette: { strength: 0.9, enabled: true } }, { owner: 'night' });
        out.shorthandBad = err(() => L.set({ nothing: false }));
        out.set = [info()['vignette.strength'].writer, info()['vignette.strength'].value, h2.params.strength, h2.enabled];
        L._clear('night');
        out.back = [info()['vignette.strength'].writer, info()['vignette.strength'].value, h2.params.strength];
        // a pixel snippet is an effect with a fuse, added like every other one (look.post has no patch verb)
        L.add({ name: 'tint', fuse: { glsl: 'color.rgb *= vec3(1.0, 0.9, 0.8);' }, slot: 'ldr', order: 5 }, { owner: 'cave' });
        out.patch = [info()['hook:tint']?.writer, !!p.get('tint'), p.get('tint')?.slot, !!info()['tint.enabled']];
        out.taken = err(() => L.add({ name: 'vignette', fuse: { glsl: 'color.rgb *= 0.5;' } }, { owner: 'cave' }));
        L.set({ tint: false }, { owner: 'cave' }); out.tintOff = [p.get('tint').enabled, info()['tint.enabled'].writer];
        L._clear('cave');
        out.patchGone = [!p.get('tint'), info()['tint.enabled']];
        // replace swaps the whole chain; null gives the style chain back
        // 'base' ends its chain first: two game owners replacing the one chain would be a shared-conflict
        L._clear('base'); L.replace([grain({ enabled: true })], { owner: 'cave' });
        out.replaced = [p.list().map(x => x.name).join(), info()['@replace']?.writer, info()['vignette.enabled']];
        L._clear('cave');
        out.restored = p.list().map(x => x.name).join() === styleNames.join();
        out.badReplace = err(() => L.replace('bloom'));
        out.cat = engine.catalog('look.post').verbs.join();
        // add(): one custom pass for an owner, shown by describe, remove() (twice is fine) takes just that pass out
        const ah = L.add({ name: 'scanx', slot: 'hdr', create: () => ({ enabled: true, needsSwap: false, renderToScreen: false, setSize() {}, render() {}, dispose() {} }) }, { owner: 'cave' });
        out.addOne = [!!p.get('scanx'), engine.catalog('look.post').signatures.add, JSON.stringify(engine.describe().look.post).includes('cave')];
        ah.remove(); ah.remove(); out.addGone = !p.get('scanx');
        out.why = Object.values(engine.catalog('look.post').params).filter(x => x.default === false && x.why).length;
        p.render(0.016);
        return out;
      });
      check('post: replace -> game:base record and the effect follows (describe().render reads the records)', r.add.join() === 'game:base,0.5,look.post.vignette.enabled', JSON.stringify([r.add, r.alias]));
      check('post: set({ effect: params, other: false }) -> game:night; clear(owner) gives the effect default back', r.set.join() === 'game:night,0.9,0.9,true' && r.back.join() === 'engine,0.5,0.5' && r.shorthandBad.includes('unknown key'), JSON.stringify([r.set, r.back, r.shorthandBad]));
      check('post: add({ name, fuse }) adds an effect (game:cave); a taken name throws; clear removes the effect and its keys', r.patch.join() === 'game:cave,true,ldr,true' && r.taken.includes('already added') && r.tintOff.join() === 'false,game:cave' && r.patchGone[0] && r.patchGone[1] === undefined, JSON.stringify([r.patch, r.taken, r.tintOff, r.patchGone]));
      check('post: add(effect, { owner }) adds one pass, catalog lists the call, describe shows the owner, remove() takes only it out', r.addOne[0] && r.addOne[1].startsWith('add(pass | (input, ctx) => node | { name, create | node | fuse }') && r.addOne[2] && r.addGone, JSON.stringify([r.addOne, r.addGone]));
      check('post: replace([...]) swaps the chain, null restores what add() put in; bad impl throws; catalog verbs (add, no patch)', r.replaced[0] === 'grain' && r.replaced[1] === 'game:cave' && r.replaced[2] === undefined && r.restored && r.badReplace.includes('array') && r.cat === 'set,replace,manual,add', JSON.stringify([r.replaced, r.restored, r.badReplace, r.cat]));
    },
  },
];
