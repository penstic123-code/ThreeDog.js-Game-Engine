// [guard] The look API a game sees is small and the same on every part (docs/plans/2026-11-03-look-api.md): set / patch / add / replace /
// manual / value, plus a part's own named verb (post.add, materials.add / glow, shadow.include). patch only swaps a named hook; adding a thing
// is add; a fog of your own is plain scene.fog; module plumbing (write, extend, drive, tick ...) lives on part.author.
// Why a guard: before, patch meant three things (swap a hook, add a material patch, make a post effect), fog had three "do it yourself" routes
// and every part showed twenty-odd methods in autocomplete. If a verb comes back on the public object, or a removed verb stops pointing at
// the new one, this fails.
// Same format as the other files here.
export const specs = [
  {
    software: false,   // reads no pixels
    name: '[guard] look api: one small verb set on every part; removed verbs point to the new call; plumbing only on part.author',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const L = engine.look, out = {}, err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const GAME = ['id', 'object', 'set', 'patch', 'add', 'replace', 'manual', 'value'];
        // a part's own named verbs (listed in its signatures, so the catalog shows them too)
        const OWN = { post: ['add'], materials: ['glow'], shadow: ['include'] };
        out.extra = {};
        for (const [id, p] of Object.entries(L)) {
          if (typeof p !== 'object' || !p) continue;
          const names = new Set([...Object.getOwnPropertyNames(Object.getPrototypeOf(p)), ...Object.keys(p)].filter(n => n !== 'constructor' && !n.startsWith('_')));
          const extra = [...names].filter(n => !GAME.includes(n) && !(OWN[id] ?? []).includes(n));
          if (extra.length) out.extra[id] = extra;
          if (!p.author || Object.keys(p).includes('author')) out.extra[id] = [...(out.extra[id] ?? []), 'author missing or enumerable'];
        }
        // the plumbing is reachable for module code, on author only
        out.author = ['write', 'extend', 'retract', 'drive', 'feed', 'tick', 'batch', 'resolved', 'values', 'top', 'point', 'remove'].filter(m => typeof L.fog.author[m] !== 'function');
        // removed verbs point to the new call
        out.matPatch = err(() => L.materials.patch('tint', { slot: 'color', glsl: 'diffuseColor.rgb *= 0.9;' }));
        out.fogReplace = err(() => L.fog.replace(new engine.scene.fog.constructor(0x123456, 1, 10)));
        out.postPatch = err(() => L.post.patch('grain', { glsl: 'color.rgb *= 0.9;' }));
        out.toneAdd = err(() => L.tone.add({}));
        // add on materials works like any add: a handle whose remove() takes it out
        const h = L.materials.add('tint', { slot: 'color', glsl: 'diffuseColor.rgb *= 0.9;' }, { roles: ['prop'], owner: 'api' });
        out.added = !!engine.describe().look.materials?.['hook:tint'];
        h.remove(); out.addedBack = !engine.describe().look.materials?.['hook:tint'];
        out.cat = engine.catalog('look.materials').verbs;
        return out;
      });
      check('every part shows only set / patch / add / replace / manual / value / id / object (plus its own named verb); author is there, not enumerable', !Object.keys(r.extra).length, JSON.stringify(r.extra));
      check('part.author has the module plumbing', !r.author.length, JSON.stringify(r.author));
      check('look.materials.patch throws naming look.materials.add', r.matPatch.includes('look.materials.add('), r.matPatch);
      check('look.fog.replace throws naming scene.fog = new THREE.Fog and look.fog.manual()', r.fogReplace.includes('scene.fog = new THREE.Fog') && r.fogReplace.includes('look.fog.manual()'), r.fogReplace);
      check('look.post.patch throws naming look.post.add; a part with nothing to add says so and lists its verbs', r.postPatch.includes('look.post.add(') && r.toneAdd.includes('nothing to add') && r.toneAdd.includes('Verbs it has'), JSON.stringify([r.postPatch, r.toneAdd]));
      check("look.materials.add(name, patch, { roles }) writes hook:<name>, remove() takes it out; catalog verbs are set / add / replace / glow", r.added && r.addedBack && r.cat.join() === 'set,add,replace,glow', JSON.stringify([r.added, r.addedBack, r.cat]));
    },
  },
];
