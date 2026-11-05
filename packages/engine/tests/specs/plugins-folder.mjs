// [guard] The plugins folder and plain lights (docs/plans/2026-11-03-slot-map.md sections 1 and 6). Page tests/plugins: main.js only creates
// and starts the engine; plugins/ holds a mesh, a three.js Pass and a module. Why a guard: the owner's rule is "files in
// the folder are plugged by what they export, no registration line". If the vite preset stops injecting the folder, a shape stops being
// recognised, describe().slots loses the file, switching off leaves something behind, or a plain PointLight is not counted by the light
// budget, this fails, instead of the AI quietly falling back to hand-written engine calls.
// Same format as the other files here.

export const specs = [
  {
    name: '[guard] plugins folder: mesh, Pass and module plug with nothing in main.js; describe().slots names the files; off() removes each; plain lights counted by the budget',
    url: '/tests/plugins/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE } = window.threedogTest, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const state = () => {
          let crate = null; try { crate = engine.thing('10-crate'); } catch { /* switched off: not registered */ }
          return {
            crate: !!crate?.object?.parent,
            pass: engine.post.object()?.passes?.some(p => p.material?.name === 'CopyShader') ?? false,
            module: engine.modules.has('pluginCounter') && !!engine.pluginCounter,
          };
        };
        out.list = engine.plugins.list();
        out.on = state();
        const s0 = engine.pluginCounter.steps; engine.step(0.05); out.steps = engine.pluginCounter.steps - s0;
        out.slots = engine.describe().slots.filter(x => x.file.startsWith('plugins/')).map(x => ({ slot: x.slot, file: x.file, on: x.on, affects: x.affects.join('; ') }));
        // switch each off: its effect goes, the others stay
        out.off = {};
        for (const n of ['10-crate', '20-copy', '40-counter']) { engine.plugins.off(n); engine.step(0.05); out.off[n] = state(); engine.plugins.on(n); engine.step(0.05); }
        out.back = state();
        out.offRow = (engine.plugins.off('20-copy'), engine.describe().slots.find(x => x.file === 'plugins/20-copy.js'));
        engine.plugins.on('20-copy');
        out.unknown = err(() => engine.plugins.off('99-nope'));
        out.bad = err(() => engine.plugins.add({ './plugins/50-oops.js': { default: 42 } }));
        out.badFn = err(() => engine.plugins.add({ './plugins/51-factory.js': { default: () => ({}) } }));
        out.namedFn = err(() => engine.plugins.add({ './plugins/52-water.js': { makeWater: function makeWater() { return {}; } } }));
        out.noHook = err(() => engine.plugins.add({ './plugins/54-idle.js': { default: { name: 'idle', type: 'rules' } } }));
        out.material = err(() => engine.plugins.add({ './plugins/56-wood.js': { default: new THREE.MeshLambertMaterial() } }));
        out.patch = err(() => engine.plugins.add({ './plugins/57-dim.js': { default: { slot: 'color', glsl: 'diffuseColor.rgb *= 0.5;' } } }));
        out.noName = err(() => engine.plugins.add({ './plugins/55-glow.js': { default: { create: () => null } } }));
        // plain lights: counted by the budget (lights / shadowLights), listed in describe with their slot row
        engine.budget.enable({});
        const v0 = engine.budget.values();
        const lamp = new THREE.PointLight(0xffaa66, 4, 10); lamp.castShadow = true; lamp.position.set(1, 2, 1);
        const spot = new THREE.SpotLight(0xffffff, 2); const holder = new THREE.Group(); holder.add(spot);
        engine.scene.add(lamp, holder); engine.step(0.05);
        const v1 = engine.budget.values();
        out.lights = { added: v1.lights - v0.lights, shadow: v1.shadowLights - v0.shadowLights, limit: engine.budget.limitOf('lights'),
          rows: engine.describe().slots.filter(x => x.slot === 'light').map(x => x.plugged), render: engine.describe().render.lights.filter(l => l.source === 'game').length };
        // idle-shadow rule: a casting light at 0 stops redrawing its shadow map, and redraws when lit again
        lamp.intensity = 0; engine.step(0.05); out.idle = lamp.shadow.autoUpdate;
        lamp.intensity = 3; engine.step(0.05); out.lit = lamp.shadow.autoUpdate;
        engine.scene.remove(lamp, holder); engine.step(0.05);
        out.gone = engine.budget.values().lights - v0.lights;
        return out;
      });
      console.log('  plugins folder:', JSON.stringify(r));
      check('the three files are found and plugged in file-name order, all on', r.list.map(p => `${p.name}:${p.slots.join()}:${p.on}`).join() === '10-crate:scene:true,20-copy:post:true,40-counter:module:true', JSON.stringify(r.list));
      check('each works with nothing in main.js: mesh in the scene, Pass in the chain, module installed and stepping',
        r.on.crate && r.on.pass && r.on.module && r.steps > 0, JSON.stringify({ on: r.on, steps: r.steps }));
      check('describe().slots lists each plugin with its file and what it affects',
        r.slots.length === 3 && r.slots.every(x => x.on && x.affects) && /engine\.thing\('10-crate'\)/.test(r.slots[0].affects) && /post chain/.test(r.slots[1].affects) && /engine\.pluginCounter/.test(r.slots[2].affects), JSON.stringify(r.slots));
      const o = r.off;
      check('switching one off removes only its effect, on() plugs it again',
        !o['10-crate'].crate && o['10-crate'].pass && !o['20-copy'].pass && o['20-copy'].crate && !o['40-counter'].module && o['40-counter'].pass
          && Object.values(r.back).filter(Boolean).length === 3, JSON.stringify({ off: o, back: r.back }));
      check('an off plugin stays in describe().slots as off with no effects', r.offRow?.on === false && r.offRow.affects.length === 0, JSON.stringify(r.offRow));
      check('a wrong shape or name is a coded error naming the file and the accepted shapes',
        /plugins\/50-oops\.js: the default export is a number \(42\).*Fix: export default.*Object3D.*Pass.*module/.test(r.bad) && /plugin-shape/.test(r.bad) && /51-factory\.js: the default export is a function.*Fix: make it a named export.*name: 'glow', node/.test(r.badFn) && /no plugin '99-nope'/.test(r.unknown), [r.bad, r.badFn, r.unknown].join(' | '));
      check('plugin-shape errors name the file, what was found and the exact fix: a named factory, a module with no hook, an effect with no name',
        /plugins\/52-water\.js: the export 'makeWater' is a function.*Fix: .*export default makeWater\(\{ \.\.\. \}\).*lib pull/.test(r.namedFn)
        && /plugins\/54-idle\.js: the default export is a module 'idle' \(type 'rules'\) with no install.*Fix: add the hook/.test(r.noHook)
        && /plugins\/55-glow\.js: the default export looks like a post effect \(keys: create\) but has no name\. Fix: add one/.test(r.noName), [r.namedFn, r.noHook, r.noName].join(' | '));
      check('a Material or a ShaderPatch is no plugin: the error says where each goes', /56-wood\.js: the default export is a Material.*engine\.water\.material = mat/.test(r.material) && /57-dim\.js: the default export is a ShaderPatch.*applyEffects\(material, \{ patches: \[patch\] \}\)/.test(r.patch) && /plugin-shape/.test(r.material), [r.material, r.patch].join(' | '));
      check('plain PointLight / SpotLight (even inside a group) are counted by the light budget and listed as light slots',
        r.lights.added === 2 && r.lights.shadow === 1 && r.lights.limit === 8 && r.lights.rows.length === 2 && r.lights.render === 2 && r.gone === 0, JSON.stringify({ ...r.lights, gone: r.gone }));
      check('a casting plain light at intensity 0 stops redrawing its shadow map and redraws once lit', r.idle === false && r.lit === true, JSON.stringify({ idle: r.idle, lit: r.lit }));
    },
  },
];
