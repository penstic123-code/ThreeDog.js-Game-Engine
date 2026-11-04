// Tide: a value that rises and falls on a timer. engine.tide.level is 0..1
import { words } from './text.js';
export function tide({ period = 30 } = {}) {
  let t = 0;
  const api = { level: 0 };
  return {
    name: 'tide', type: 'rules', label: 'Tide', requires: ['world'], stage: 'gameplay',
    install(engine) { engine.i18n.add(words); return api; },
    fixed(dt) { t += dt; api.level = 0.5 + 0.5 * Math.sin(t / period * Math.PI * 2); },
    describe() { return { level: api.level }; },
  };
}
