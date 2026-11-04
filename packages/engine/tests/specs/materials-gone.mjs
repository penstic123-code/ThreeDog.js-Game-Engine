// [guard] The material factory stays gone: a material is plain three.js, effects come through applyEffects. Why a guard: a role table can come back as
// one small helper, and every module would then have a second place its picture hides in.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = fileURLToPath(new URL('../../', import.meta.url));
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.js$/.test(n) ? [p] : []; });

export const specs = [
  {
    name: '[guard] materials: index.js and the engine have no makeMaterial, no look.materials / look.surface, and no engine source names them',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, E = mk(T.createEngine, 'materials-gone');
        const out = { exports: ['makeMaterial', 'MATERIAL_PURPOSES'].filter(n => n in T), engine: 'makeMaterial' in E, look: 'look' in E, kept: ['applyEffects', 'terrainMaterial', 'mergeColored', 'rampTexture'].filter(n => typeof T[n] !== 'function') };
        E.dispose();
        return out;
      });
      check('index.js exports neither makeMaterial nor MATERIAL_PURPOSES', !r.exports.length, r.exports.join());
      check('engine.makeMaterial is gone', !r.engine);
      check('engine.look is gone', !r.look);
      check('the plain entries stay', !r.kept.length, r.kept.join());
      const road = ['index.js', ...['core', 'modules', 'render', 'ui'].flatMap(d => walk(join(ENGINE, d)))].map(f => (f.includes(ENGINE) ? f : join(ENGINE, f)))
        .filter(f => /\bmakeMaterial\s*\(|\.look\??\.(materials|surface)\b/.test(readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')));
      check('no engine source calls makeMaterial or reaches look.materials / look.surface', !road.length, road.join(' | '));
    },
  },
];
