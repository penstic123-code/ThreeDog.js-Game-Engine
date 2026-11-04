// threedog catalog: the bridge text and the files it locates (tools/threedog/catalog.mjs). engine.catalog() itself: engine tests/specs/catalog.mjs.
import { ROOT } from '../paths.mjs';

export const name = 'catalog: bridge text names op args, defaults and failures, and locates the source / api / recipe files';
export async function run({ check }) {
  const { catalogCommand } = await import('../threedog/catalog.mjs');
  const row = { id: 'sky', kind: 'module', state: 'running', stage: 'environment', runIndex: 3, requires: [], optional: [], time: { hooks: ['fixed', 'skip'], step: 'fixed', skip: true },
    params: null, ops: [{ name: 'sky.set', args: { t: { type: 'number', optional: true, default: 12 } }, failures: ['bad'] }], saves: [{ key: 'sky', version: 1 }],
    queries: { describe: 'describe().sky', extra: [], api: ['timeOfDay'] }, problems: [] };
  const one = catalogCommand({ data: row, ids: ['sky'], ops: [] }, 'sky', {}, ROOT);
  check('Module text: op with default and failures, files located', /sky\.set\(t:number\?=12\) fails: bad/.test(one.text) && /api: .*api\/sky\.md/.test(one.text)
    && /source: .*modules\/sky\//.test(one.text) && one.data.files.api, one.text);
  const none = catalogCommand({ data: null, ids: ['sky'], ops: ['time.skip'] }, 'nope', {}, ROOT);
  check('Unknown id fails and lists what exists', !none.ok && /Modules: sky/.test(none.text), none.text);
  // options: type and sentence come from the api page's Options lines, a key with no sentence shows (no doc) and is counted in problems
  const col = catalogCommand({ data: { id: 'collision', kind: 'module', state: 'running', requires: [], optional: [], ops: [], saves: [],
    params: { maxClimb: { type: 'any', optional: true, default: 1.1 }, noSuchKey: { type: 'any', optional: true } },
    queries: { describe: null, extra: [], api: [] }, problems: [] }, ids: ['collision'], ops: [] }, 'collision', {}, ROOT);
  check('Params: type and desc merged from the api page, missing doc shown', /maxClimb:number\?=1\.1 — Max walkable slope/.test(col.text) && /noSuchKey:any\? — \(no doc\)/.test(col.text)
    && col.data.problems.some(p => /1 param\(s\) without a description.*noSuchKey/.test(p)), col.text);
}
