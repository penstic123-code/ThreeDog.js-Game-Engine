// look.post: the post-processing chain as a look part (recipes/52-look.md).
//   set({ bloom: { strength: 0.6 }, vignette: false })   keys are '<effect>.<param>' and '<effect>.enabled'; false / true is the same as enabled
//   patch('grain', glsl | { glsl, slot, order, uniforms, values }) generates a fuse effect named 'grain' (PostFuse in PostFX.js); patch('grain', null) removes it
//   add(effect, { owner })  adds ONE custom pass (name, create | fuse, slot, order, params) without replacing the chain; returns { remove() }
//   replace([effect, ...])  swaps the whole chain for these effects; replace(null) gives the style's chain back
// The old engine.post.add / enable and handle set / enable / remove were removed in 0.2 (they throw renamed-api): this part is the one way to change the chain, so describe().look
// and describe().render say who changed what. Style-pack effects (bloom, ao, outline ...) are the style layer; the keys come and go with the
// effects, so the part adds and removes its params as the chain changes (core/look/dynamic.js).
// Why '<effect>.<param>' keys and not one object per effect: layering and owners are per key, so a game can change bloom.strength and leave
// the style's bloom.threshold alone.
import { defineLookPart } from '../core/look/part.js';
import { codedError } from '../core/errorHints.js';

/** @param {any} post PostFX @param {any[]} styleDefs the style pack's effects */
export function definePostLook(post, styleDefs) {
  const e = post.engine, low = e.tier === 'low', generated = new Map(), source = new Map();
  const defaultOn = d => (d.enabled ?? true) && !(d.costly && low);   // a costly effect starts off on low-tier devices unless the game said otherwise
  const decl = h => {
    const d = h._def, n = h.name;
    return { [`${n}.enabled`]: { type: 'bool', default: !!defaultOn(d), cost: d.costly ? 'gpu' : 'uniform',
      why: low && d.costly ? (post._offWhy[n] ?? `costly effect: off on low-tier devices`) : `post effect '${n}'${styleDefs.includes(d) ? ' of the style pack' : ''}`,
      off: `look.post.set({ ${n}: ${defaultOn(d) ? 'false' : 'true'} })` },
    ...Object.fromEntries(Object.entries(d.params ?? {}).map(([k, v]) => [`${n}.${k}`, { type: 'any', default: v, neutral: true, cost: d.fuse ? 'uniform' : 'recompile' }])) };
  };
  const styleValues = () => Object.fromEntries(post._list.filter(h => styleDefs.includes(h._def)).flatMap(h => Object.entries(h.params).map(([k, v]) => [`${h.name}.${k}`, v])));
  /** The game layer records what differs from the default (createEngine({ post }), or an effect the game added) */
  const record = h => { if (!styleDefs.includes(h._def) || h.enabled !== !!defaultOn(h._def)) part.write('game', { [`${h.name}.enabled`]: h.enabled }); };
  const split = k => { const i = k.indexOf('.'); return [k.slice(0, i), k.slice(i + 1)]; };
  const part = defineLookPart(e, {
    id: 'post', group: 'screen', module: 'core', object: () => post.composer, docs: ['recipes/52-look.md'], applyAtStart: false,
    params: Object.assign({}, ...post._list.map(decl)), style: styleValues,
    read: () => ({}),
    normalize(p) {   // post.set({ vignette: false }) -> { 'vignette.enabled': false }
      return Object.fromEntries(Object.entries(p).map(([k, v]) => (typeof v === 'boolean' && part.has(`${k}.enabled`) ? [`${k}.enabled`, v] : [k, v])));
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
    hooks: { '*': { signature: 'GLSL statements that edit `vec4 color` (see PostFuse in render/PostFX.js); spec { glsl, slot: "ldr", order, uniforms, values }', scope: ['vUv', 'tDiffuse', 'uTime', 'uResolution', 'fxHash(vec2)'] } },
    extraSignatures: { add: 'add(effect, { owner })' },
    applyHook(name, impl) {
      if (impl != null && generated.has(name) && source.get(name) === impl) return;   // the same spec again (a rolled-back write re-applies every hook): keep the built effect
      generated.get(name)?._remove();
      source.delete(name);
      if (generated.delete(name)) part.retract(name + '.');
      if (impl == null) return;
      if (post.get(name)) throw new Error(`look.post.patch/add('${name}'): an effect named '${name}' already exists; pick another name, or change it with look.post.set({ '${name}.<param>': value })`);
      const s = typeof impl === 'string' ? { glsl: impl } : impl, { slot, order, params, ...fuse } = s;
      // add(effect) passes a whole effect (create | fuse): it keeps its own slot / order / enabled; patch(name, spec) is a fuse snippet in 'ldr'
      const h = s.create || s.fuse ? post._add({ ...s, name }) : post._add({ name, fuse, slot: slot ?? 'ldr', order, params });
      generated.set(name, h); source.set(name, impl); part.extend(decl(h));
    },
    replace: { accepts: 'an array of post effects ({ name, create | fuse, slot, order, params }); null gives the style\'s chain back',
      loses: ['every effect the style, patch() or a replaced chain brought (their look.post values go with them)'] },
    // checked before the record is written, so a wrong replace never reaches applyReplace (review H1)
    validate: (k, v) => (k === '@replace' && !Array.isArray(v) ? 'is an array of effects like [bloom({ strength: 0.4 }), myGrain]; null gives the style chain back' : null),
    applyReplace(impl) {
      if (impl != null && !Array.isArray(impl)) throw new Error('look.post.replace(effects): effects is an array like [bloom({ strength: 0.4 }), myGrain]; null gives the style chain back');
      post._building = true;
      try {
        for (const h of [...post._list]) { h._remove(); part.retract(h.name + '.'); }
        generated.clear(); source.clear();
        for (const d of impl ?? styleDefs) { const lowOff = impl == null && d.costly && low; const h = post._add(d, { enabled: lowOff ? false : undefined }); part.extend(decl(h)); }
        part.restyle(impl ? {} : styleValues());
      } finally { post._building = false; post._sync(); }
    },
  });
  /** Add one custom pass; it is a patch under the effect's name, so owner layers, describe, remove and rollback work like every look verb */
  part.add = (effect, o) => {
    if (!effect || typeof effect.name !== 'string' || (typeof effect.create !== 'function' && !effect.fuse))
      throw codedError('look-verb', "look.post.add(effect): needs { name: 'myEffect', create: (ctx) => pass } (or a fuse snippet { name, fuse: { glsl } }, see PostEffect)");
    // checked here, before any write: the hook key is the effect name, so a second write under it would replace (and tear down) the first effect
    if (post.get(effect.name)) throw codedError('look-verb', `look.post.add: post effect '${effect.name}' is already added; change it with look.post.set({ '${effect.name}.<param>': value }), or drop it with its handle.remove() / look.post.replace([...])`);
    part.patch(effect.name, effect, o);
    // patch's handle would drop the owner's WHOLE post layer (every other effect this owner added); remove only this effect's hook
    return { remove: () => { part.patch(effect.name, null, o); } };
  };
  for (const h of post._list) record(h);
  return { part };
}
