// createServices order guard: no service constructor may read engine.<service> before the line that creates it. The true order is written at the top of
// core/engine/services.js; this makes a new hidden requirement (a constructor that reaches for a service made further down) fail here, in the constructor
// that did it, instead of as `undefined` in a game. Run: threedog test "services order"
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../core/engine/services.js'), 'utf8');
// the names createServices assigns, plus the four Engine.js makes around it (stacks before; post, ui and page after)
const NAMES = [...new Set([...src.matchAll(/^\s*engine\.(\w+) = /gm)].map(m => m[1]).concat(['stacks', 'post', 'ui', 'page']))];

export const specs = [
  {
    name: 'services order: no service is read before it is created while createEngine builds them',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const early = await ev(async names => {
        const T = threedogThreads;
        const proto = Object.getPrototypeOf(T.mk(T.createEngine, 'order-0'));
        const set = new WeakMap(), early = [];
        // accessors on the prototype see every engine.x read and write of the next engine's construction
        for (const n of names) Object.defineProperty(proto, n, { configurable: true,
          get() { const s = set.get(this); if (!s || !(n in s)) early.push(n); return s?.[n]; },
          set(v) { let s = set.get(this); if (!s) set.set(this, s = {}); s[n] = v; } });
        T.mk(T.createEngine, 'order-1');
        return [...new Set(early)];
      }, NAMES);
      check('the scan saw the services (events, saves, stacks, ui)', ['events', 'saves', 'stacks', 'ui'].every(n => NAMES.includes(n)) && NAMES.length > 25, NAMES.length);
      check('no service constructor reads a service that is created later', early.length === 0, early.join(', '));
    },
  },
];
