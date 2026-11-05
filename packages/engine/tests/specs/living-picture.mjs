// Guards of the plant, weather and particle pictures: each is swappable through plain .material, and nothing in the module reaches a style table.
// Why a source scan as well as a run: a module that asks engine.look or makeMaterial for its picture still works while those exist, and only a
// second language coming back through a side door would show it. Same format as the other files here.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'modules');
/** Lines of a module folder that reach the old look layer (comments included: a stale pointer teaches the old way) */
const secondLanguage = dir => readdirSync(join(MODULES, dir)).flatMap(f => readFileSync(join(MODULES, dir, f), 'utf8').split('\n')
  .filter(l => /\b(?:engine|e)\.(?:look|style)\b|\bstyle\.\w|makeMaterial|defineLookPart|core\/look\//.test(l)).map(l => `${f}: ${l.trim().slice(0, 100)}`));

export const specs = [
  {
    name: '[guard] vegetation drawing: plain material swaps on planted plants as given, sway and color reach them, nothing asks a style table',
    url: '/tests/terrain-edit/',
    async run({ check, ev }) {
      check('vegetation module names no look layer', secondLanguage('vegetation').length === 0, secondLanguage('vegetation').join(' | '));
      const r = await ev(async () => {
        const { createEngine, vegetation, THREE, applyEffects } = threedogTerrain;
        const wait = () => new Promise(res => setTimeout(res, 5));
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'living-veg' });
        E.use(vegetation({ chunkSize: 16, viewChunks: 2, area: { min: [-20, -20], max: [20, 20] } }));
        const geo = () => new THREE.ConeGeometry(0.5, 1, 5), rule = { perChunk: 20, sink: 0 }, mine = new THREE.MeshBasicMaterial({ color: 0x123456 });
        const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
        E.vegetation.define('bush', { geometry: geo(), wind: 0.1, rule });
        E.vegetation.define('own', { geometry: geo(), wind: 0.2, material: mine, rule });
        await E.start();
        E.focus.set(0, 0, 0);
        for (let i = 0; i < 120 && ![...E.vegetation.host.chunks.values()].some(c => E.vegetationDraw.mesh(c, 'bush')); i++) { E.step(1 / 60); await wait(); }
        const drawn = n => [...new Set([...E.vegetation.host.chunks.values()].map(c => E.vegetationDraw.mesh(c, n)?.material).filter(Boolean))];
        const patchNames = m => { const k = m.customProgramCacheKey(); return k === plainKey ? '' : k; }, plainKey = new THREE.MeshToonMaterial().customProgramCacheKey(), out = {};
        const start = drawn('bush');
        out.neutral = [start.length, start[0]?.isMeshLambertMaterial, start[0]?.vertexColors, start[0]?.color.getHex(), patchNames(start[0]).includes('wind=0.1')];
        E.vegetation.material.color.set(0x445566);
        out.colorReaches = drawn('bush')[0].color.getHex() === 0x445566;
        E.vegetation.material.color.set(0xffffff);
        out.patchList = E.vegetation.patches.map(p => p.name).join();
        const sway = 'void threedogWind(inout vec3 t, vec3 ip, vec3 p){ t.x += 0.1 * THREEDOG_WIND_AMP; }';
        const key0 = patchNames(drawn('bush')[0]);
        E.vegetation.sway(sway);
        out.swayLive = [patchNames(drawn('bush')[0]) !== key0, patchNames(drawn('own')[0]) !== '', E.vegetation.patches.find(p => p.name === 'wind').cacheKey !== 0.05];
        E.vegetation.sway(null);
        out.swayBack = patchNames(drawn('bush')[0]) === key0;
        out.badSway = err(() => E.vegetation.sway('void nope(){}'));
        out.tslOnly = err(() => E.vegetation.sway({ tsl: c => c.position }));
        E.vegetation.color('diffuseColor.rgb = vec3(1.0);');
        out.color = [patchNames(drawn('bush')[0]).includes('vegetationColor'), E.vegetation.patches.at(-1).name];
        E.vegetation.color(null);
        out.colorOff = patchNames(drawn('bush')[0]).includes('vegetationColor');
        const game = new THREE.MeshToonMaterial({ vertexColors: true });
        E.vegetation.material = game;
        const made = E.vegetation.define('late', { geometry: geo(), rule });
        out.swap = [E.vegetation.material === game, drawn('bush').length === 1 && drawn('bush')[0] === game, patchNames(game), E.vegetationDraw.kind('late').material === game, drawn('own')[0] === mine];
        E.vegetation.color('diffuseColor.rgb *= 0.5;'); E.vegetation.sway(sway);
        out.gameUntouched = patchNames(game); E.vegetation.color(null); E.vegetation.sway(null);
        const kept = applyEffects(new THREE.MeshToonMaterial({ vertexColors: true }), { patches: E.vegetation.patches });
        out.keeps = ['wind', 'season'].every(n => patchNames(kept).includes(n + '='));
        E.vegetation.material = null;
        const back = drawn('bush');
        out.back = [back.length, back[0] !== game, back[0]?.isMeshLambertMaterial, patchNames(back[0]).includes('wind=0.1'), made.name];
        out.badMaterial = err(() => { E.vegetation.material = 0xff0000; });
        E.renderer.compile(E.scene, E.camera);
        out.compiled = E.renderer.info.programs.every(p => p.diagnostics?.runnable !== false);
        E.dispose();
        return out;
      });
      check('default: neutral lambert, vertex colors on white, wind patched in', r.neutral.join() === '1,true,true,16777215,true', JSON.stringify(r.neutral));
      check('material.color written on the default reaches the species copies', r.colorReaches);
      check('patches: season and wind', r.patchList === 'season,wind', r.patchList);
      check('sway: live on planted species, patches refreshed, null gives it back', r.swayLive.every(Boolean) && r.swayBack, JSON.stringify([r.swayLive, r.swayBack]));
      check('sway: a wrong function and a missing form throw with the fix', /threedogWind/.test(r.badSway) && /glsl too/.test(r.tslOnly), JSON.stringify([r.badSway, r.tslOnly]));
      check('color: live on planted species and in patches; null takes it off', r.color[0] && r.color[1] === 'vegetationColor' && r.colorOff === false, JSON.stringify([r.color, r.colorOff]));
      check('swap: planted and later species draw the game material as given; a species with its own keeps it', r.swap[0] && r.swap[1] && r.swap[2] === '' && r.swap[3] && r.swap[4], JSON.stringify(r.swap));
      check('swap: sway() and color() leave the game material alone', r.gameUntouched === '', r.gameUntouched);
      check('a game material takes the patches through applyEffects', r.keeps);
      check('null gives the neutral default back', r.back.slice(0, 4).join() === '1,true,true,true', JSON.stringify(r.back));
      check('a wrong value throws', /three\.js material/.test(r.badMaterial), r.badMaterial);
      check('every program compiled', r.compiled);
    },
  },
  {
    name: '[guard] weather drawing: plain material per field, plain writes live, define adds and gives back, multipliers stay on signals, nothing asks a style table',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      check('weather module names no look layer', secondLanguage('weather').length === 0, secondLanguage('weather').join(' | '));
      const r = await ev(() => {
        const { createEngine, sky, weather, THREE } = threedogTest, out = {};
        const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
        const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'living-wx' });
        e.use(sky(), weather({ types: { clear: {}, wet: { rain: 1, snow: 0.5, sun: 0.5, fog: 0.25, grey: 1 }, ashfall: { ash: 1 } }, start: 'wet', particles: 100,
          rain: { speed: 30, color: 0x99aabb }, overcastColor: 0x223344, lightningBrightness: 0.5, lightning: f => f }));
        const P = () => e.weather.particles;
        e.step(0.1, { render: false });
        const rain = P().rain, eng = rain.material;
        out.options = [rain.spec.speed, rain.uniforms.uColor.value.getHex(), e.weather.overcastColor.getHex(), eng.isShaderMaterial];
        // plain writes, live: no rebuild, the same object keeps drawing
        rain.spec.speed = 10; rain.spec.opacity = 0.2; rain.uniforms.uLen.value = 2; e.step(0.1, { render: false });
        out.writes = [P().rain === rain, Math.abs(rain.uniforms.uOpacity.value - 0.2) < 1e-6, rain.uniforms.uLen.value];
        e.weatherDraw.flash = 1; e.weatherDraw.apply(e.camera);   // step(0) advances nothing, so the frame is run by hand
        out.flash = e.stacks.get('sky.flash').holders().find(h => h.owner === 'weatherDraw')?.value;
        // the material swaps as given; the engine still moves the same uniforms
        const mine = new THREE.ShaderMaterial({ uniforms: rain.uniforms, vertexShader: eng.vertexShader, fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }', transparent: true });
        rain.material = mine; e.step(0.1, { render: false });
        out.swap = [rain.object.material === mine, rain.material === mine, mine.uniforms === rain.uniforms, mine.uniforms.uCam === rain.uniforms.uCam];
        rain.material = null;
        out.back = rain.object.material === eng;
        out.badMaterial = err(() => { rain.material = 3; });
        // define: a field of the game's own, then the create form, a built-in in place, then back
        const ash = e.weather.defineField('ash', { shape: 'soft', color: 0x555555 });
        out.ash = [P().ash === ash, ash.object.isPoints, !!ash.material];
        let args = null; const own = new THREE.Group();
        const made = e.weather.defineField('ash', { create: (en, a) => { args = [en === e, a.area, a.count]; return { object: own }; } });
        out.create = [made.object === own, args?.join(), made.material === null, own.parent === e.scene, !ash.object.parent];
        out.ownMaterial = err(() => { made.material = new THREE.MeshBasicMaterial(); });
        e.weather.defineField('ash', null);
        out.ashGone = !('ash' in P()) && !own.parent;
        e.weather.defineField('rain', { shape: 'square', size: 30 });
        out.replaced = P().rain.object.isPoints;
        e.weather.defineField('rain', null);
        out.rainBack = [P().rain.object.isLineSegments, P().rain.spec.speed];
        out.badField = err(() => e.weather.defineField('ahs', {}));
        out.badSpec = err(() => e.weather.defineField('ash', 5));
        // rule: the weather reaches light and fog through signals, never by writing them
        e.lights.sun.intensity = 2.5; e.scene.fog = new THREE.Fog(0x808080, 1, 300);
        e.step(1, { render: false });
        out.signals = [e.uniforms.uWeatherLight.value, e.uniforms.uWeatherFog.value, e.lights.sun.intensity, e.scene.fog.far];
        e.dispose();
        return out;
      });
      check('options set the picture: rain keys, overcast color', r.options.join() === `30,${0x99aabb},${0x223344},true`, JSON.stringify(r.options));
      check('plain writes are live, no rebuild', r.writes.join() === 'true,true,2', JSON.stringify(r.writes));
      check('lightning function and brightness shape the flash', r.flash === 0.5, String(r.flash));
      check('material swaps as given, null gives the engine one back; a wrong value throws', r.swap.every(Boolean) && r.back && /three\.js material/.test(r.badMaterial), JSON.stringify([r.swap, r.back, r.badMaterial]));
      check('define adds a field and its create form replaces it; create objects are the game\'s', r.ash.every(Boolean) && r.create[0] && /^true,\d+,\d+$/.test(r.create[1]) && r.create[2] && r.create[3] && r.create[4] && /create\(\)/.test(r.ownMaterial), JSON.stringify([r.ash, r.create, r.ownMaterial]));
      check('define(field, null) removes a game field and gives rain back to the options', r.ashGone && r.replaced && r.rainBack.join() === 'true,30', JSON.stringify([r.ashGone, r.replaced, r.rainBack]));
      check('a field no type has and a wrong spec throw with the fix', /ashfall: \{ ahs: 1 \}/.test(r.badField) && /spec is an object/.test(r.badSpec), JSON.stringify([r.badField, r.badSpec]));
      check('multipliers are signals: light and fog stay as written', r.signals.join() === '0.5,0.25,2.5,300', JSON.stringify(r.signals));
    },
  },
  {
    name: '[guard] particles picture: effects and default sit under define, a name never defined works, plain material swaps as given, nothing asks a style table',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      check('particles module names no look layer', secondLanguage('particles').length === 0, secondLanguage('particles').join(' | '));
      const r = await ev(() => {
        const { createEngine, particles, THREE } = threedogTest, out = {};
        const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
        const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'living-fx' });
        e.use(particles({ default: { max: 40, color: 0x112233, drag: 2 }, effects: { dust: { size: [2, 3], color: 0x445566 }, leaf: { spin: 3 } } }));
        const P = e.particles, dust = P.define('dust', { max: 10 });
        out.order = [dust.o.max, dust.o.size.join('/'), dust.o.color, dust.o.drag, dust.o.gravity];
        out.before = P.has('leaf');
        P.emit('leaf', [0, 0, 0], { count: 5 });
        out.leaf = [P.has('leaf'), P.count('leaf'), P.effects.get('leaf').o.spin, P.effects.get('leaf').o.max];
        const unknown = P.attach('nothing', new THREE.Object3D());
        out.unknown = [unknown.active, P.has('nothing')];
        const eng = dust.material;
        out.neutral = [eng.isShaderMaterial, dust.points.material === eng, dust.uniforms === eng.uniforms];
        P.emit('dust', [0, 0, 0], { count: 3 });
        e.step(0.1, { render: false });
        dust.uniforms.uScale.value = -1;
        // a plain material has no uniforms: the engine's per-frame write must not go through it
        const mine = new THREE.PointsMaterial({ size: 1 });
        dust.material = mine; e.step(0.1, { render: false });
        out.swap = [dust.points.material === mine, dust.material === mine, !mine.uniforms, dust.uniforms.uScale.value > 0, P.count('dust') === 3];
        dust.material = null;
        out.back = [dust.points.material === eng, dust.material === eng];
        out.badMaterial = err(() => { dust.material = 3; });
        const gone = { mine: 0, eng: 0 };
        mine.addEventListener('dispose', () => gone.mine++); eng.addEventListener('dispose', () => gone.eng++);
        dust.material = mine;
        const again = P.define('dust', { max: 8 });
        out.redefine = [gone.mine, gone.eng, again.material !== mine, again.material.isShaderMaterial];
        out.bad = [err(() => particles({ effects: { x: { sizee: 1 } } })), err(() => particles({ default: { colour: 1 } })), err(() => particles({ effect: {} })), err(() => particles({ effects: { x: 5 } })), err(() => particles({ effects: 5 }))];
        e.dispose();
        return out;
      });
      check('define over effects over default over neutral', r.order.join() === `10,2/3,${0x445566},2,-2`, JSON.stringify(r.order));
      check('a name in effects never define()d is defined on its first emit, over default', !r.before && r.leaf.join() === 'true,5,3,40', JSON.stringify(r.leaf));
      check('a name in neither stays a no-op', r.unknown.join() === 'false,false', JSON.stringify(r.unknown));
      check('default: the engine material, its uniforms plain', r.neutral.every(Boolean), JSON.stringify(r.neutral));
      check('swap: drawn as given, particles keep running, the engine still writes its uniforms', r.swap.every(Boolean), JSON.stringify(r.swap));
      check('null gives the engine one back; a wrong value throws', r.back.every(Boolean) && /three\.js material/.test(r.badMaterial), JSON.stringify([r.back, r.badMaterial]));
      check('define again frees the engine material, not the game\'s', r.redefine.join() === '0,1,true,true', JSON.stringify(r.redefine));
      check('wrong keys and shapes in the options throw at the factory', /sizee/.test(r.bad[0]) && /colour/.test(r.bad[1]) && /effect/.test(r.bad[2]) && /an effect is an object/.test(r.bad[3]) && /effects/.test(r.bad[4]), JSON.stringify(r.bad));
    },
  },
];
