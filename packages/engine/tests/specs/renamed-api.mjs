// Names renamed in 0.2 now throw renamed-api with the new call in the message (core/errorHints.js RENAMED is the one list; rule R39 keeps the old
// names out of the repo). This spec is where the old names may still be written, on purpose. Same format as specs.mjs.
import { RENAMED } from '../../core/errorHints.js';

export const specs = [
  {
    name: 'renamed-api: every old call throws code renamed-api and the message names the new call',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const now = Object.fromEntries(Object.entries(RENAMED).map(([k, v]) => [k, v.now]));
      const r = await ev((now) => {
        const e = engine, out = {};
        const t = (key, f) => { try { f(); out[key] = 'no throw'; } catch (x) { out[key] = x.code === 'renamed-api' && x.message.includes(now[key]) ? 'ok' : `${x.code}: ${x.message}`; } };
        t('setExposure', () => e.setExposure(1));
        t('setToneMapping', () => e.setToneMapping('agx'));
        t('setEnvironment', () => e.sky.setEnvironment({ source: 'sky' }));
        t('setShadow', () => e.sky.setShadow({ bias: 0 }));
        t('weatherDefine', () => e.weather.define('ash', {}));
        t('postAdd', () => e.post.add({ name: 'x', create: () => ({}) }));
        t('postEnable', () => e.post.enable('bloom', false));
        const h = e.post.get('bloom') ?? e.post.get(e.post.list()[0]?.name);
        t('postHandle', () => h.set({ strength: 1 }));
        t('lookClouds', () => void e.look.clouds);
        t('cameraOverride', () => { e.cameraOverride = { owner: 'x' }; });
        t('viewsPos', () => e.views.define('old', { pos: [1, 2, 3] }));
        const f = e.ops.can('dialogue.advance');
        t('reason', () => void f.reason);
        out.enumerable = Object.keys(f).includes('reason');
        return out;
      }, now);
      for (const key of Object.keys(now)) check(`${key} throws renamed-api naming the new call`, r[key] === 'ok', String(r[key]));
      check('the reason trap is hidden from keys / JSON', r.enumerable === false);
    },
  },
];
