// [guard] The picture is game code: createEngine({ style }) is an unknown option like any other, and nothing in modules/ or render/ may read engine.style. Why a
// guard: a module that reads engine.style again is a second, hidden way into the picture, and an empty engine.style would hide that silently.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// comment lines may name the old key; a read in code may not (engine.style, e.style, this.engine.style, with ?.)
const READ = /\b(?:engine|eng|e)\??\.style\b(?!\.(?:left|top|width|height|cssText))/;
const sources = dir => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? sources(p) : /\.m?js$/.test(n) ? [p] : []; });
const reads = () => ['modules', 'render'].flatMap(d => sources(join(ROOT, d))).flatMap(f => readFileSync(f, 'utf8').split('\n')
  .map((l, i) => (!/^\s*(\/\/|\*|\/\*)/.test(l) && READ.test(l) ? `${relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}` : null)).filter(Boolean));

export const specs = [
  {
    name: '[guard] no style option: createEngine({ style }) throws as an unknown option; modules/ and render/ read no engine.style',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { createEngine } = threedogTest, canvas = () => document.createElement('canvas');
        const err = o => { try { createEngine({ canvas: canvas(), headless: true, ui: { loading: false }, saveKey: 'no-style', ...o }).dispose(); return ''; } catch (x) { return x.message; } };
        return { empty: err({ style: {} }), none: err({}) };
      });
      check('createEngine({ style: {} }) throws: an unknown option', /style/.test(r.empty), r.empty);
      check('no style given: the engine builds', r.none === '', r.none);
      const hits = reads();
      check('no source line in modules/ or render/ reads engine.style', hits.length === 0, hits.join(', '));
    },
  },
];
