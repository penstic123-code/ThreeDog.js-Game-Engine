// look.post: the post chain as a look part. See recipes/52-look.md and docs/plans/done/2026-11-03-one-post-entry.md.
//   add(x, { name, slot, order, owner })   THE one way an effect gets into the chain. x is a plain three.js Pass (WebGL), a TSL node function
//                                           (input, ctx) => node (WebGPU), or an effect { name, create | node | fuse, slot, order, params } (both,
//                                           when it gives create and node, or a fuse). Returns { name, remove() }.
//   set({ bloom: { strength: 0.6 }, vignette: false })   keys are '<effect>.<param>' and '<effect>.enabled'; false / true is the same as enabled
//   replace([effect, ...])                 swaps the whole chain for these effects; replace(null) gives back what add() put in
// Why one verb: game code, the plugins folder (core/plugins.js) and a style pack's plugins all call add, so every effect has a name,
// an owner, on / off through set, a describe row and a rollback, whoever added it. A style pack's plugins add on the style layer (owner
// 'style:<pack>'), so the game's set and its own effects still win. Each effect is stored as the hook 'hook:<name>' of its owner's layer.
// Why '<effect>.<param>' keys and not one object per effect: layering and owners are per key, so a game can change bloom.strength and leave
// the style's bloom.threshold alone.
import { defineLookPart } from '../core/look/part.js';
import { codedError } from '../core/errorHints.js';
import { warnOnce } from '../core/validate.js';

const HOOK = 'hook:';

/** @param {any} post PostFX */
export function definePostLook(post) {
  const e = post.engine, low = e.tier === 'low', generated = new Map(), source = new Map();
  /** names a style pack's plugins added: the low-tier rule (a costly effect starts off) is the style's default, not something a game add gets */
  const fromStyle = new Set();
  const lowOff = (n, d) => low && !!d.costly && fromStyle.has(n) && (d.enabled ?? true);
  const decl = h => {
    const d = h._def, n = h.name, on = h.enabled, dev = lowOff(n, d);
    return { [`${n}.enabled`]: { type: 'bool', default: on, cost: d.costly ? 'gpu' : 'uniform',
      why: dev ? (post._offWhy[n] ?? 'costly effect: off on low-tier devices') : `post effect '${n}'${fromStyle.has(n) ? ' of the style' : ''}`,
      // the tier rule is the engine's own decision: it stays on the engine layer (the default above) and says so in describe().look
      ...(dev ? { device: post._offWhy[n] ?? 'costly effect: off on low-tier devices' } : {}),
      off: `look.post.set({ ${n}: ${on ? 'false' : 'true'} })` },
    ...Object.fromEntries(Object.entries(d.params ?? {}).map(([k, v]) => [`${n}.${k}`, { type: 'any', default: v, neutral: true, cost: d.fuse ? 'uniform' : 'recompile' }])) };
  };
  const split = k => { const i = k.indexOf('.'); return [k.slice(0, i), k.slice(i + 1)]; };
  /** Build one stored effect into the chain (called for every hook write, and again by replace(null)) */
  const plug = (name, def) => {
    if (post.get(name)) throw codedError('post-effect', `look.post.add('${name}'): an effect named '${name}' already exists; pick another name ({ name }), or change it with look.post.set({ '${name}.<param>': value })`);
    const off = lowOff(name, def);
    if (off) {
      post._offWhy[name] = `starts off: costly effect on a low-tier device (${e.headless ? 'this headless page runs at the low tier: shot --tier high renders it' : 'weak GPU or software rendering'}); turn it on with engine.look.post.set({ ${name}: true })`;
      warnOnce(`post: ${name} is off by default here. ${post._offWhy[name]}`);
    }
    const h = post._add(def, { enabled: off ? false : undefined });
    generated.set(name, h); source.set(name, def); part.author.extend(decl(h));
  };
  const part = defineLookPart(e, {
    id: 'post', group: 'screen', module: 'core', object: () => post.composer, docs: ['recipes/52-look.md'], applyAtStart: false,
    params: {}, read: () => ({}),
    normalize(p) {   // post.set({ vignette: false }) -> { 'vignette.enabled': false }
      return Object.fromEntries(Object.entries(p).map(([k, v]) => (typeof v === 'boolean' && part.author.has(`${k}.enabled`) ? [`${k}.enabled`, v] : [k, v])));
    },
    apply(v, changed) {
      const sets = new Map();
      for (const k of changed) {
        const [n, p] = split(k), h = post.get(n);
        if (!h) continue;
        if (p === 'enabled') { if (h.enabled !== !!v[k]) h._enable(!!v[k]); } else if (h.params[p] !== v[k]) (sets.get(h) ?? sets.set(h, {}).get(h))[p] = v[k];
      }
      for (const [h, p] of sets) h._set(p);
    },
    // no patch verb: a pixel snippet is an effect with a fuse, added like every other one
    noPatch: "Add a pixel snippet as an effect: look.post.add({ name: 'grain', fuse: { glsl: 'color.rgb *= 0.9;' }, slot: 'ldr' })",
    extraSignatures: { add: 'add(pass | (input, ctx) => node | { name, create | node | fuse }, { name, slot, order, owner })' },
    applyHook(name, impl) {
      if (impl != null && generated.has(name) && source.get(name) === impl) return;   // the same effect again (a rolled-back write re-applies every hook): keep the built one
      generated.get(name)?._remove();
      source.delete(name);
      if (generated.delete(name)) part.author.retract(name + '.');
      if (impl != null) plug(name, impl);
    },
    replace: { accepts: 'an array of post effects ({ name, create | node | fuse, slot, order, params }); null gives back what look.post.add put in',
      loses: ['every effect look.post.add brought (style plugins, the plugins folder, game code) while replaced; their look.post values go with them'] },
    // checked before the record is written, so a wrong replace never reaches applyReplace (review H1)
    validate: (k, v) => (k === '@replace' && !Array.isArray(v) ? 'is an array of effects like [bloom({ strength: 0.4 }), myGrain]; null gives the added effects back' : null),
    applyReplace(impl) {
      if (impl != null && !Array.isArray(impl)) throw codedError('post-effect', 'look.post.replace(effects): effects is an array like [bloom({ strength: 0.4 }), myGrain]; null gives the added effects back');
      post._building = true;
      try {
        for (const h of [...post._list]) { h._remove(); part.author.retract(h.name + '.'); }
        generated.clear(); source.clear();
        if (impl) for (const d of impl) { const h = post._add(d); part.author.extend(decl(h)); }
        // replace(null): every effect added with add() is still stored on its owner's layer; build those again
        else for (const [k, v] of part.author.resolved(HOOK)) if (v != null) plug(k.slice(HOOK.length), v);
      } finally { post._building = false; post._sync(); }
    },
  });
  /**
   * The one way to add a post effect (doc at the top). The value is turned into an effect here, before anything is written, so a wrong shape
   * throws with nothing added; the effect is then the hook '<name>' of the owner's layer.
   * @param {any} x @param {{ name?: string, slot?: string, order?: number, owner?: string, layer?: string }} [o]
   */
  part.add = (x, { name, slot, order, owner = 'game', layer = 'game' } = {}) => {
    const def = effectOf(post, x, { name, slot, order });
    if (!def) return { name: null, remove() {} };   // a RenderPass of engine.scene: the engine's own, skipped, said once
    // the add order of plain passes and the game's OutputPass markers: a pass after an OutputPass runs on display color (reslot)
    const plain = post._plain ??= [];
    if (def.output) {   // OutputPass: only marks where display color starts; removing it puts the later passes back before tone mapping
      const m = { output: true }; plain.push(m); reslot(post);
      return { name: null, remove() { const i = plain.indexOf(m); if (i >= 0) { plain.splice(i, 1); reslot(post); } } };
    }
    // checked here, before any write: the hook key is the effect name, so a second write under it would replace (and tear down) the first effect
    if (post.get(def.name)) throw codedError('look-verb', `look.post.add: post effect '${def.name}' is already added; change it with look.post.set({ '${def.name}.<param>': value }), give this one another name (add(x, { name })), or drop the first with its handle.remove()`);
    if (layer === 'style') fromStyle.add(def.name);
    try { part.author.write(owner, { [HOOK + def.name]: def }, { layer }); } catch (err) { fromStyle.delete(def.name); throw err; }
    const entry = def._auto ? { def } : null;
    if (entry) plain.push(entry);
    // removing only this effect's hook: dropping the owner's layer would take every other effect this owner added too
    return { name: def.name, remove: () => {
      part.author.write(owner, { [HOOK + def.name]: null }, { layer }); fromStyle.delete(def.name);
      if (!post._kept.has(def.name)) post._seq.delete(def.name);   // removed for good: a later effect of that name starts at the end (plugins keep theirs)
      const i = entry ? plain.indexOf(entry) : -1; if (i >= 0) plain.splice(i, 1);
    } };
  };
  return { part };
}

/** hdr or ldr for each plain pass by its place among the game's OutputPass markers, as in the game's hand-built composer */
function reslot(post) {
  let after = false, changed = false;
  for (const e of post._plain ?? []) {
    if (e.output) { after = true; continue; }
    const h = post._list.find(x => x._def === e.def), s = after ? 'ldr' : 'hdr';
    if (h && h.slot !== s) { h.slot = s; changed = true; }
  }
  if (changed) post._sync();
}

/** A three.js Pass that draws the scene itself (RenderPixelatedPass, SSAARenderPass, TAARenderPass, a RenderPass): it replaces the scene render */
const drawsScene = (eng, p) => p.scene === eng.scene && !!p.camera;

/**
 * look.post.add's value as a post effect; null for a RenderPass of engine.scene and { output: true } for an OutputPass (the engine's own stages). The three accepted shapes and where a plain Pass goes:
 * a pass that renders engine.scene itself goes in the 'scene' slot (it replaces the engine's scene render: stacked after it, the scene was
 * drawn twice a frame), FXAA / SMAA / TAA in 'final', any other pass in 'hdr' after the style's effects (order 1000+), where it would sit in
 * a hand-built composer.
 * @param {any} post @param {any} x @param {{ name?: string, slot?: string, order?: number }} o
 */
function effectOf(post, x, { name, slot, order }) {
  const eng = post.engine, pick = d => ({ ...d, ...(name != null ? { name } : {}), ...(slot != null ? { slot } : {}), ...(order != null ? { order } : {}) });
  // game passes go after the style's effects in their slot, in add order; the same counter numbers their names
  const next = () => (post._autoN = (post._autoN ?? 0) + 1);
  if (typeof x === 'function') { const n = next(); return pick({ name: `nodePass#${n}`, node: x, order: 1000 + n }); }
  if (x && typeof x === 'object' && typeof x.render === 'function') {
    if (x.isRenderPass && x.scene === eng.scene) {
      warnOnce('look.post.add(RenderPass): the engine already renders engine.scene first in its chain; this pass was skipped (add the passes that come after it)');
      return null;
    }
    if (x.isOutputPass) {
      // the engine's own output stage stands in for it, and where the game put it still counts: plain passes added after it run on display
      // color ('ldr'), as in its hand-built composer (bloom -> OutputPass -> LUT keeps the LUT after tone mapping); its remove() ends that
      warnOnce('look.post.add(OutputPass): the engine chain already tone maps and converts to the output color space once; this pass was skipped, and plain passes added after it run after tone mapping (slot ldr)');
      return { output: true };
    }
    // a readable name that survives minified class names: the pass's own name, else a ShaderPass's shader name (CopyShader, FXAAShader)
    const mn = x.material?.name, cls = (typeof x.name === 'string' && x.name) || (mn && mn !== 'unspecified' ? mn : 'pass'), n = next();
    const s = drawsScene(eng, x) ? 'scene' : /FXAA|SMAA|TAA/i.test(cls) || x._edgesRT ? 'final' : (post._plain ?? []).some(e => e.output) ? 'ldr' : 'hdr';
    // _pass: the game's own object, not disposed when the effect is removed (three's removePass habit; render/PostFX.js _remove).
    // _auto: hdr / ldr follows where the game's OutputPass sits (reslot below), unless the game named the slot
    return pick({ name: `${cls}#${n}`, slot: s, order: 1000 + n, create: () => x, _pass: x, _auto: slot == null && (s === 'hdr' || s === 'ldr') });
  }
  if (x && typeof x === 'object' && typeof x.name === 'string' && (typeof x.create === 'function' || typeof x.node === 'function' || (x.fuse && typeof x.fuse === 'object')))
    return name != null || slot != null || order != null ? pick(x) : x;
  throw codedError('look-verb', 'look.post.add(x): x is a three.js Pass (has render(); WebGL), a node function (input, ctx) => node (WebGPU), ' +
    "or an effect { name: 'myEffect', create: ctx => pass, node: (input, ctx) => node } / { name, fuse: { glsl } } (both renderers, see PostEffect)");
}
