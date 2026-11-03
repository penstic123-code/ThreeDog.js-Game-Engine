// [guard] One way to add a post effect (docs/plans/done/2026-11-03-one-post-entry.md). engine.look.post.add takes a plain three.js Pass, a node
// function or an effect { name, create, node, fuse }; game code, the plugins folder and a style pack's plugins all go through it, so every
// effect has a name, an owner and on / off through look.post.set. Why a guard: before, there were five entries (engine.post.addPass,
// look.post.add, look.post.patch, style.post / postAdd, plugins) with different on / off rules, a plugin could not hold an effect for both
// renderers, a library factory in plugins/ became a WebGPU post pass, and a pass that draws the scene was stacked after the engine's scene
// render (the scene drawn twice a frame). If a second entry comes back or any of these regresses, this fails.
// Page: perf city (WebGL); the WebGPU half runs on the post-webgpu page. Same format as the other files here.

export const specs = [
  {
    name: '[guard] one post entry (WebGL): Pass, effect and plugin effects all switch with look.post.set; a scene-drawing pass replaces the scene render; function plugins and the old entries fail clearly',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const { ShaderPass, CopyShader, postEffects: E } = window.threedogTest, out = {}, err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const names = () => engine.post.list().map(e => `${e.name}:${e.slot}:${e.enabled}`);
        // 1. one verb for each shape; each is switched by its name with look.post.set
        const copy = new ShaderPass(CopyShader), hp = engine.look.post.add(copy, { name: 'myCopy' });
        const hv = engine.look.post.add(E.vignette({ strength: 0.5 }));
        engine.step(0.05);
        engine.look.post.set({ myCopy: false, vignette: false }); engine.step(0.05);
        out.set = { names: names(), inChain: engine.post.object().passes.includes(copy) };
        hp.remove(); hv.remove(); engine.step(0.05);
        // 2. a plugin file (game folder) exporting an effect description: the same verb, its own name, set switches it, off() removes it
        engine.plugins.add({ './plugins/50-grain.js': { default: E.grain({ animated: false }) } });
        engine.step(0.05);
        out.plugin = { on: names().filter(n => n.startsWith('grain')), slot: engine.describe().slots.find(s => s.file === 'plugins/50-grain.js')?.affects.join() };
        engine.look.post.set({ grain: false });
        out.plugin.setOff = engine.post.get('grain')?.enabled;
        engine.plugins.off('50-grain');
        out.plugin.gone = !engine.post.get('grain');
        // 3. a function export is not a plugin on either renderer (a library factory): plugin-shape, nothing plugged
        out.fnPlugin = err(() => engine.plugins.add({ './plugins/60-sparks.js': { sparks: () => ({}) } }));
        // 4. a pass that draws engine.scene itself goes in the scene slot: the scene is drawn once a frame, not twice
        const Pass = Object.getPrototypeOf(ShaderPass);
        class PixelScene extends Pass {
          constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; }
          render(renderer, writeBuffer) { renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); renderer.clear(); renderer.render(this.scene, this.camera); }
        }
        const pix = new PixelScene(engine.scene, engine.camera), hs = engine.look.post.add(pix);
        engine.step(0.05);
        const R = engine.renderer, real = R.render; let draws = 0;
        R.render = function (s, c) { if (s === engine.scene) draws++; return real.call(this, s, c); };
        engine.step(0.05);
        R.render = real;
        out.scene = { slot: engine.post.get(hs.name)?.slot, draws, second: err(() => engine.look.post.add(new PixelScene(engine.scene, engine.camera))) };
        hs.remove(); engine.step(0.05);
        // 5. the old entries are gone (one way in)
        out.old = { addPass: typeof engine.post.addPass, insertPass: typeof engine.post.insertPass, removePass: typeof engine.post.removePass,
          patch: err(() => engine.look.post.patch('x', 'color.rgb *= 0.5;')) };
        out.stylePost = err(() => window.threedogTest.createEngine({ canvas: document.createElement('canvas'), style: { post: [E.bloom()] } }));
        out.postOption = err(() => window.threedogTest.createEngine({ canvas: document.createElement('canvas'), post: { bloom: true } }));
        return out;
      });
      console.log('  one post entry:', JSON.stringify(r));
      check('look.post.set switches a plain Pass (by its given name) and an effect (by its own name) the same way',
        r.set.names.includes('myCopy:hdr:false') && r.set.names.includes('vignette:ldr:false') && !r.set.inChain, JSON.stringify(r.set));
      check('a plugin file exporting an effect description plugs through look.post.add under the effect name; set switches it; off() removes it',
        r.plugin.on.join() === 'grain:ldr:true' && /post chain/.test(r.plugin.slot ?? '') && r.plugin.setOff === false && r.plugin.gone, JSON.stringify(r.plugin));
      check('a function export is a plugin-shape error that says to export the result or { name, node }', r.fnPlugin.includes('[plugin-shape]') && r.fnPlugin.includes('{ name:') && r.fnPlugin.includes('sparks'), r.fnPlugin);
      check('a pass that draws engine.scene goes in the scene slot and the scene is drawn once per frame', r.scene.slot === 'scene' && r.scene.draws === 1, JSON.stringify(r.scene));
      check('a second scene-drawing pass is refused by name (the scene slot holds one)', r.scene.second.includes("slot 'scene' already holds"), r.scene.second);
      check('engine.post.addPass / insertPass / removePass are gone; look.post.patch points to look.post.add({ fuse })',
        r.old.addPass === 'undefined' && r.old.insertPass === 'undefined' && r.old.removePass === 'undefined' && r.old.patch.includes('look.post.add({'), JSON.stringify(r.old));
      check('style.post fails at createEngine and points to style plugins', r.stylePost.includes('style.post is gone') && r.stylePost.includes('plugins'), r.stylePost);
      check('createEngine({ post: { bloom: true } }) fails and points to look.post.add(bloom()) and look.post.set', r.postOption.includes('look.post.add(bloom())') && r.postOption.includes('look.post.set'), r.postOption);
    },
  },
  {
    name: '[guard] one post entry, post on WebGPU: node function and { create, node } effect through look.post.add; remove() frees the nodes the engine built',
    url: '/tests/post-webgpu/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.postAddPass());
      console.log('  one post entry webgpu:', JSON.stringify({ leak: r.leak, both: r.both }));
      check('WebGPU: remove() of a node effect using ctx.display.bloom disposes its nodes (no leaked mip targets)', r.leak.built && r.leak.freed === 1 && r.leak.gone, JSON.stringify(r.leak));
      for (const k of ['gl', 'gpu'])
        check(`${k}: one { name, create, node } effect darkens the picture, and look.post.set({ dim: false }) gives it back`,
          r.both[k].on < r.both[k].base * 0.5 && Math.abs(r.both[k].off - r.both[k].base) < 1.5, JSON.stringify(r.both[k]));
    },
  },
];
