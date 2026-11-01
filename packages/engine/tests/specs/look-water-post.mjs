// look.water / look.weather / look.post (modules/water/look.js, modules/weather/look.js, render/postLook.js).
// Each part has one "no bypass" test: a change made with a verb shows up in describe().look as game:<owner>, and removing that layer gives the style value back.
// Water and weather get their own small engine (the style decides the start values); post uses the page engine and its style's effects.
// Same format as specs.mjs; appended at the end of specs.mjs.

const MAKE = `
  const { createEngine, water, weather, sky } = threedogTest;
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
        out.by0 = [info().opacity.by, info().opacity.value, e.water.material.opacity];
        W.set({ opacity: 0.4, waveHeight: 2 }, { owner: 'cave' });
        out.set = [info().opacity.by, e.water.material.opacity, info().waveHeight.by, e.water._u.uWave.value];
        const m0 = e.water.material;
        W.patch('wave', 'float threedogWaterWave(vec3 p, float t) { return sin(p.x + t) * 0.1; }', { owner: 'cave' });
        out.patch = [info()['hook:wave']?.by, e.water.material !== m0];
        W.set({ foam: { color: 0xffffff } }, { owner: 'cave' });
        out.foam = [info().foam.by, /threedogWaterSurface/.test(e.water.material.customProgramCacheKey()) || e.water.material !== m0];
        out.badGlsl = err(() => W.patch('wave', 'float nope() { return 1.0; }', { owner: 'cave' }));
        out.badHook = err(() => W.patch('waves', 'x'));
        out.badFoam = err(() => W.set({ depthColor: { by: 'sideways' } }, { owner: 'cave' }));
        out.replaceBad = err(() => W.replace(5));
        W.clear('cave');
        out.back = [info().opacity.by, info().opacity.value, e.water.material.opacity, info().waveHeight.by, e.water._u.uWave.value, info()['hook:wave']];
        const cat = e.catalog('look.water');
        out.cat = [cat.verbs.join(), !!cat.hooks.wave, !!cat.replace];
        // water({ ... }) options are the game's layer
        const e2 = make({}, [water({ sea: false, opacity: 0.5, depthColor: { shallow: 0x88ccdd, deep: 0x003355 } })]);
        out.opts = [e2.describe().look.water.opacity.by, e2.describe().look.water.depthColor.by, e2.water.material.opacity];
        e.dispose(); e2.dispose();
        return out;
      }));
      check('water: style layer at start, set -> game:cave and the live material / uniform follow', r.by0.join() === 'style,0.7,0.7' && r.set.join() === 'game:cave,0.4,game:cave,2', JSON.stringify([r.by0, r.set]));
      check('water: patch(wave) and set({foam}) rebuild the material, recorded as game:cave', r.patch.join() === 'game:cave,true' && r.foam[0] === 'game:cave' && r.foam[1], JSON.stringify([r.patch, r.foam]));
      check('water: bad hook / glsl / foam / replace throw with the fix', r.badGlsl.includes('threedogWaterWave') && r.badHook.includes('look-verb') && r.badFoam.length > 0 && r.replaceBad.includes('look.water.replace'), JSON.stringify([r.badGlsl, r.badHook, r.badFoam, r.replaceBad]));
      check('water: clear(owner) restores the style values and the plain material', r.back[0] === 'style' && r.back[1] === 0.7 && r.back[2] === 0.7 && r.back[3] === 'style' && r.back[4] === 1.5 && r.back[5] === undefined, JSON.stringify(r.back));
      check('water: catalog lists set / patch / replace; water({...}) options are the game layer', r.cat.join() === 'set,patch,replace,true,true' && r.opts.join() === 'game,game,0.5', JSON.stringify([r.cat, r.opts]));
    },
  },
  {
    name: 'look no bypass: weather set / patch / replace -> game:<owner>; removing the layer restores the style look',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {}, types = { clear: {}, rain: { rain: 1 }, ashfall: { ash: 1 } };
        const e = make({ weather: { rain: { speed: 30, color: 0x99aabb } } }, [sky(), weather({ types })]), W = e.look.weather, info = () => e.describe().look.weather, sys = () => e.weather.systems.get('rain');
        out.by0 = [info()['rain.speed'].by, info()['rain.speed'].value, sys().spec.speed, info()['rain.opacity'].by];
        W.set({ 'rain.speed': 10, rain: { length: 2 } }, { owner: 'cave' });
        out.set = [info()['rain.speed'].by, sys().spec.speed, info()['rain.length'].by, sys().uniforms.uLen.value];
        const FRAG = 'uniform float uOpacity; uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(1.0, 0.0, 1.0, vA * uOpacity); }';
        W.patch('rain.fragment', FRAG, { owner: 'cave' });
        out.patch = [info()['hook:rain.fragment']?.by, sys().object.material.fragmentShader.includes('1.0, 0.0, 1.0')];
        out.snow = err(() => { W.set({ 'snow.size': 8 }, { owner: 'cave' }); });   // no snow in the table: warns once, does not throw
        out.badKey = err(() => W.set({ 'rain.colour': 1 }, { owner: 'cave' }));
        out.badHook = err(() => W.patch('fog', 'x'));
        out.badReplace = err(() => W.replace([1]));
        W.clear('cave');
        out.back = [info()['rain.speed'].by, info()['rain.speed'].value, sys().spec.speed, info()['hook:rain.fragment'], sys().object.material.fragmentShader.includes('1.0, 0.0, 1.0')];
        // look.weather.replace({ field: spec }) is one object per owner: a second call must list the earlier fields again
        const ashSpec = { shape: 'soft', color: 0x555555 }; e.look.weather.replace({ ash: ashSpec }); const a = e.weather.systems.get('ash');
        out.define = [info()['@replace']?.by, e.weather.systems.get('ash') === a, a.object.isPoints];
        e.look.weather.replace({ ash: ashSpec, rain: { create: () => ({ object: new threedogTest.THREE.Group() }) } }); const own = e.weather.systems.get('rain');
        out.rainOwn = [e.weather.systems.get('rain') === own, e.weather.systems.has('ash')];
        W.clear('game');
        out.cleared = [e.weather.systems.has('ash'), e.weather.systems.get('rain').spec?.speed, info()['@replace']];
        out.cat = e.catalog('look.weather').verbs.join();
        e.dispose();
        return out;
      }));
      check('weather: style rain values are the style layer; set -> game:cave rebuilds the system with them', r.by0.join() === 'style,30,30,engine' && r.set.join() === 'game:cave,10,game:cave,2', JSON.stringify([r.by0, r.set]));
      check('weather: patch(rain.fragment) swaps the whole shader text, recorded as game:cave', r.patch.join() === 'game:cave,true', JSON.stringify(r.patch));
      check('weather: a field the table lacks does not throw; unknown key / hook / replace value throw with the fix', r.snow === '' && r.badKey.includes('did you mean') && r.badHook.includes('look-verb') && r.badReplace.includes('look.weather.replace'), JSON.stringify([r.snow, r.badKey, r.badHook, r.badReplace]));
      check('weather: clear(owner) gives the style speed and the default shader back', r.back.join() === 'style,30,30,,false', JSON.stringify(r.back));
      check('weather: define() is the game replace layer, adds fields, and clear gives rain back to the style', r.define.join() === 'game,true,true' && r.rainOwn.join() === 'true,true' && r.cleared.join() === 'false,30,' && r.cat === 'set,patch,replace', JSON.stringify([r.define, r.rainOwn, r.cleared, r.cat]));
    },
  },
  {
    name: 'look no bypass: post set / patch / replace -> game:<owner>; removing the layer restores the effect default; the chain reads the records',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { vignette, grain } = threedogTest.postEffects, p = engine.post, L = engine.look.post, out = {};
        const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
        const info = () => engine.describe().look.post, rp = n => engine.describe().render.post.find(x => x.name === n);
        p.setAntialias(false);
        const styleNames = p.list().map(x => x.name);
        L.replace([vignette({ enabled: true, strength: 0.5 })], { owner: 'base' });   // the chain the rest of the test works on (cleared before the restore check)
        out.add = [info()['@replace']?.by, info()['vignette.strength'].value, rp('vignette').by];
        out.alias = [];
        // verbs
        const h2 = p.get('vignette');
        L.set({ vignette: { strength: 0.9, enabled: true } }, { owner: 'night' });
        out.shorthandBad = err(() => L.set({ nothing: false }));
        out.set = [info()['vignette.strength'].by, info()['vignette.strength'].value, h2.params.strength, h2.enabled];
        L.clear('night');
        out.back = [info()['vignette.strength'].by, info()['vignette.strength'].value, h2.params.strength];
        // patch generates a fuse effect
        L.patch('tint', { glsl: 'color.rgb *= vec3(1.0, 0.9, 0.8);', slot: 'ldr', order: 5 }, { owner: 'cave' });
        out.patch = [info()['hook:tint']?.by, !!p.get('tint'), p.get('tint')?.slot, !!info()['tint.enabled']];
        out.taken = err(() => L.patch('vignette', 'color.rgb *= 0.5;', { owner: 'cave' }));
        L.set({ tint: false }, { owner: 'cave' }); out.tintOff = [p.get('tint').enabled, info()['tint.enabled'].by];
        L.clear('cave');
        out.patchGone = [!p.get('tint'), info()['tint.enabled']];
        // replace swaps the whole chain; null gives the style chain back
        L.replace([grain({ enabled: true })], { owner: 'cave' });
        out.replaced = [p.list().map(x => x.name).join(), info()['@replace']?.by, info()['vignette.enabled']];
        L.clear('cave'); L.clear('base');
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
      check('post: patch(name, fuse) generates an effect (game:cave); a taken name throws; clear removes the effect and its keys', r.patch.join() === 'game:cave,true,ldr,true' && r.taken.includes('already exists') && r.tintOff.join() === 'false,game:cave' && r.patchGone[0] && r.patchGone[1] === undefined, JSON.stringify([r.patch, r.taken, r.tintOff, r.patchGone]));
      check('post: add(effect, { owner }) adds one pass, catalog lists the call, describe shows the owner, remove() takes only it out', r.addOne[0] && r.addOne[1] === 'add(effect, { owner })' && r.addOne[2] && r.addGone, JSON.stringify([r.addOne, r.addGone]));
      check('post: replace([...]) swaps the chain, null restores the style chain; bad impl throws; catalog verbs', r.replaced[0] === 'grain' && r.replaced[1] === 'game:cave' && r.replaced[2] === undefined && r.restored && r.badReplace.includes('array') && r.cat === 'set,patch,replace', JSON.stringify([r.replaced, r.restored, r.badReplace, r.cat]));
    },
  },
];
