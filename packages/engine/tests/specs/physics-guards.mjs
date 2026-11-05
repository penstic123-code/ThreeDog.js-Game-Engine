// [guard] Physics / nav / weather / collision leftovers stay fixed. Each check is a way the old code could come back:
//   1. nav and rigid sync the collision module's statics only through engine.collision.mirror (one diff, not two copies that drift)
//   2. rigid rebuilds its physics world once per new game (it rebuilt on session:end and again on world:load)
//   3. removing colliders / interactions keeps insertion order (earlier added wins ties) while being O(1) (a filter per remove was O(n^2) on unload)
//   4. engine code fetches stand-in textures through engine.assets.useTexture (one failure path), never a bare assets.texture().then().catch()
//   5. weather.set takes { seconds }; the positional form throws [module-params] in dev
// Same format as the other files here.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = fileURLToPath(new URL('../../', import.meta.url));
const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
const rel = p => relative(ENGINE, p).replace(/\\/g, '/');

export const specs = [
  {
    name: '[guard] physics leftovers: statics only through collision.mirror, one rigid rebuild per newGame, insertion-ordered O(1) removal, assets.useTexture, weather.set options',
    url: '/?threedog-headless',
    async run({ check, ev }) {
      // static half (node side): what the browser half cannot see
      const src = ['core', 'render', 'modules', 'ui'].flatMap(d => walk(join(ENGINE, d)));
      const own = src.filter(p => /modules[\\/](nav|rigid)[\\/]/.test(p) && readFileSync(p, 'utf8').includes('forEachStatic'));
      check('nav / rigid never walk collision.forEachStatic themselves (they use engine.collision.mirror)', own.length === 0, own.map(rel).join(', '));
      const bare = src.filter(p => !rel(p).startsWith('core/Assets.js') && /assets\.texture\(\s*[^)\s]/.test(readFileSync(p, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')));
      check('engine code calls assets.useTexture, not assets.texture().then().catch()', bare.length === 0, bare.map(rel).join(', '));
      const r = await ev(async () => {
        const out = {}, C = engine.collision, I = engine.interactions;
        const errOf = f => { try { f(); return ''; } catch (e) { return e.message; } };
        // 2. one rebuild per new game
        let rebuilt = 0;
        const off = engine.events.on('rigid:rebuilt', () => { rebuilt++; });
        await engine.session.newGame();
        off.remove();
        out.rebuilt = rebuilt;
        // 1 + 3. a mirror of the statics: built in order, removal seen, order kept after removing from the middle
        const log = [];
        const m = C.mirror({ add: (type, o) => { log.push('+' + o.x); return o.x; }, remove: (p) => { log.push('-' + p); } });
        m.sync(); log.length = 0;
        const hs = [101, 102, 103].map(x => C.addBox([x, 0, 500], { halfWidth: 0.5, halfDepth: 0.5 }));
        out.first = m.sync(); out.again = m.sync();
        hs[1].remove(); hs[1].remove();   // twice: harmless
        m.sync();
        const order = []; C.forEachStatic((t, o) => { if (o.z === 500) order.push(o.x); });
        out.log = log.join(' '); out.order = order.join(',');
        // the rigid world follows the same mirror: one collider per box, gone again on remove (counted at the boxes' spot: terrain streams meanwhile)
        const here = () => { let n = 0; engine.rigid.world.colliders.forEach(c => { const t = c.translation(); if (Math.abs(t.z - 500) < 0.01 && t.x > 100 && t.x < 104) n++; }); return n; };
        engine.step(0.05, { render: false });
        out.rigidAfterAdd = here();
        for (const h of hs) h.remove();
        engine.step(0.05, { render: false });
        out.rigidAfterRemove = here();
        // removing many colliders is not quadratic: 4000 adds then removes in insertion order
        const many = Array.from({ length: 4000 }, (_, i) => C.addCircle([1000 + (i % 60), 0, 1000 + Math.floor(i / 60)], { radius: 0.3 }));
        const t0 = performance.now(); for (const h of many) h.remove(); out.removeMs = performance.now() - t0;
        // interactions: ties go to the earlier added after a middle removal; get(id) and items agree
        if (I) {
          const p = engine.player.position, at = [p.x + 0.3, p.y, p.z];
          const a = I.add(at, { id: 'g-a', radius: 3 }), b = I.add(at, { id: 'g-b', radius: 3 }), c = I.add(at, { id: 'g-c', radius: 3 });
          const mode = I.pickMode; I.pickMode = 'nearest';
          a.remove();
          out.tie = I.pick('player')?.id;
          out.items = I.items.filter(x => x.id.startsWith('g-')).map(x => x.id).join(',');
          out.get = I.get('g-a') === undefined && I.get('g-c')?.id === 'g-c';
          b.remove(); c.remove(); I.pickMode = mode;
        }
        // 4. a failed stand-in texture: one asset-load warning naming where, resolves false, use() never runs
        const { value: ok, warns } = await __t.warns(() => engine.assets.useTexture('/no-such-texture-guard.png', () => { out.used = true; }, { where: 'guard.slot', instead: 'gray stays' }));
        out.useTexture = ok === false && !out.used && warns.some(w => w.includes('asset-load') && w.includes('guard.slot') && w.includes('gray stays'));
        // 5. weather.set options
        if (engine.weather) {
          out.positional = errOf(() => engine.weather.set(engine.weather.name, 3));
          out.options = errOf(() => engine.weather.set(engine.weather.name, { seconds: 3 }));
        }
        return out;
      });
      check('newGame rebuilds the physics world once (was twice: session:end and world:load)', r.rebuilt === 1, JSON.stringify(r));
      check('collision.mirror adds in order, syncs only on change, removes once', r.first === true && r.again === false && r.log === '+101 +102 +103 -102', r.log);
      check('removing from the middle keeps insertion order (forEachStatic)', r.order === '101,103', r.order);
      check('rigid colliders follow collision boxes through the mirror (2 left of 3)', r.rigidAfterAdd === 2 && r.rigidAfterRemove === 0, JSON.stringify(r));
      check('removing 4000 colliders is not quadratic (< 150 ms)', r.removeMs < 150, String(r.removeMs));
      if ('tie' in r) {
        check('interactions: a tie goes to the earlier added after removing another one', r.tie === 'g-b', String(r.tie));
        check('interactions: items keeps insertion order, get(id) finds by id', r.items === 'g-b,g-c' && r.get, JSON.stringify(r));
      }
      check('assets.useTexture: a failed load warns once (asset-load, where, instead) and resolves false', r.useTexture, JSON.stringify(r));
      if ('positional' in r) check("weather.set('x', 3) throws [module-params]; { seconds } works", r.positional.includes('module-params') && r.options === '', JSON.stringify(r));
    },
  },
];
