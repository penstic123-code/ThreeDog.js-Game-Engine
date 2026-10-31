// AI tools, node side: the error hint table (core/errorHints.js) and the describe snapshot comparison (describe-snapshot.mjs). Run: npm test -- "AI tools"
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ERROR_HINTS, hintFor, withHint } from 'threedog/error-hints';
import { pickGameplay, diffDescribe, saveSnapshot, compareSnapshot } from '../describe-snapshot.mjs';
import { DOCS_REL, ROOT } from '../paths.mjs';

export const name = 'AI tools: error hint table and describe snapshots (node)';

// Real messages as the engine writes them (see the throw / warn sites); each must land on the listed hint id
const SAMPLES = {
  'module-requires': 'module npcs requires module "world", which is not installed',
  'module-cycle': 'module order forms a cycle: a -> b -> a (check before / after on these modules)',
  'module-stage': 'module x has stage "gamplay", which is not a stage; available stages: control, gameplay',
  'module-name': 'module name sky clashes with an existing engine property; pick another name',
  'module-called': 'engine.use received the module function sky itself; call it: sky()',
  'describe-name': "describe.add('range'): this name is already taken; pick another (existing fields, module names and previously registered names cannot be reused)",
  'world-missing': 'characters.createPlayer() needs world() installed first: the player is a record in world',
  'world-plain': 'world data must be plain values (number, string, boolean, array, plain object): x is a function. Put models in world.present()',
  'world-id': 'world.add(): id "crate_1" already exists. Omit id to auto-number',
  'world-record': 'world.get(): no record with id "ghost" (world.query({ kind }) lists what exists)',
  'world-add': 'world.add() needs a kind (what sort of thing this is)',
  'world-present': "build of world.present('crate') returned undefined (record c1): build must return a three.js object",
  'bad-position': 'npcs.add: position is not a valid number (got [null,0,1]). Common cause: a Vector3 used as an array',
  'content-place': 'Place "dock" not found: give its coordinates in the places of content.load, or add this marker to the level',
  'pickup-prop-id': "pickup id 'p1' is already used by other data (prop): use a different id",
  'container': "inventory.transfer: from container 'chest' does not exist: create it first with inventory.container('chest', { capacity })",
  'npc-behavior': 'no NPC behavior named "patrol". Registered: wander. Register a custom behavior first',
  'unknown-option': 'npcs.add(): unknown option "shedule", did you mean `schedule`?',
  'unknown-name': 'action "jupm" does not exist, did you mean `jump`? (available: jump, run)',
  'options-object': 'sky.modify: the second argument must be an options object { … }, got 5',
  'event-typo': 'event "quest:compleet" was never emitted or listened to; did you mean `quest:complete`?',
  'owned-prop': 'sky.sun.intensity is recomputed every frame, so setting it directly gets overwritten',
  'camera-kind': "setCamera() has no camera kind 'topdown'; available: follow, first",
  'movement': 'movement.walk must be a positive number; got undefined',
  'commit-fallback': 'commits.request() needs a fallback: it is computed on the main thread when due',
  'asset-critical': 'Startup blocked: 1 critical item(s) failed to load, the game cannot start:',
  'asset-missing-ref': 'Asset loaded with missing references: model "pig" <- /models/pig.gltf (missing /models/pig.png)',
  'asset-load': 'Asset failed to load: models/pig.glb (404 Not Found)',
  'audio-unsupported': 'Audio is not supported by this browser; check typeof AudioContext before calling',
  'indexeddb': 'indexedDB is unavailable',
  'gameplay-frozen': '[engine] listener of event quest:done threw and gameplay is frozen (in dev / tests a gameplay error fails hard)',
  'module-disabled': '[engine] presentation module particles threw and was disabled (the game continues)',
  'not-installed': "Cannot read properties of undefined (reading 'give')",
  'not-function': 'engine.inventory.giv is not a function',
};

export async function run({ check }) {
  const ids = ERROR_HINTS.map(h => h.id);
  check('hint table: 15-40 classes with unique ids', ids.length >= 15 && ids.length <= 40 && new Set(ids).size === ids.length, String(ids.length));
  const wrong = Object.entries(SAMPLES).filter(([id, msg]) => hintFor(msg)?.id !== id).map(([id, msg]) => `${id} -> ${hintFor(msg)?.id}`);
  check('every sample message lands on its own class', wrong.length === 0, wrong.join('; '));
  check('every class has a sample in this test', ids.every(id => id in SAMPLES), ids.filter(id => !(id in SAMPLES)).join(', '));
  const docs = ERROR_HINTS.flatMap(h => h.docs.map(d => [h.id, d])).filter(([, d]) => !existsSync(join(ROOT, DOCS_REL, d)));
  check('every doc page a hint points at exists (relative to the package docs)', docs.length === 0, docs.map(x => x.join(': ')).join('; '));
  check('withHint: appends the cause and the pages, and is idempotent; unknown messages stay unchanged',
    /\n {2}Possible cause: .*\n {2}Read: recipes\/18-world\.md/.test(withHint(SAMPLES['world-plain'])) && withHint(withHint(SAMPLES['world-plain'])) === withHint(SAMPLES['world-plain']) && withHint('something else') === 'something else');

  const d = { perf: { fps: 60 }, time: { elapsed: 12.3, clock: '12:00' }, player: { x: 10, y: 1, z: 5, state: 'idle' }, nearby: [{ name: 'Hen', dist: 3 }, { name: 'Pig', dist: 8 }], quests: { active: [{ id: 'q1', step: 'talk' }] } };
  const p = pickGameplay(d);
  check('pickGameplay: drops perf and time.elapsed, keeps the rest; only keeps dotted paths', !('perf' in p) && !('elapsed' in p.time) && p.time.clock === '12:00' && JSON.stringify(Object.keys(pickGameplay(d, { only: ['player.x', 'quests'] }))) === '["player","quests"]');
  const cur = JSON.parse(JSON.stringify(d));
  cur.perf.fps = 5; cur.time.elapsed = 99; cur.player.x = 10.3;   // noise only
  check('diff: perf / elapsed / jitter within tolerance are not differences', diffDescribe(pickGameplay(d), pickGameplay(cur)).length === 0);
  cur.player.x = 14; cur.nearby.reverse(); cur.nearby.push({ name: 'Cow', dist: 9 }); cur.quests.active[0].step = 'deliver'; cur.time.clock = '13:00';
  const lines = diffDescribe(pickGameplay(d), pickGameplay(cur));
  check('diff: readable lines for a number, an added item, a changed string; a reordered list is not a change',
    lines.length === 4 && lines.some(l => /^player\.x: 10 -> 14 \(changed 4, tolerance 0\.5\)/.test(l)) && lines.some(l => l.startsWith('nearby[Cow]: added'))
    && lines.some(l => l.includes('quests.active[q1].step: "talk" -> "deliver"')) && lines.some(l => l.includes('time.clock: "12:00" -> "13:00"')), lines.join(' | '));
  check('diff: tolerance per path overrides the default', diffDescribe(pickGameplay(d), pickGameplay(cur), { tolerance: { default: 0.5, player: 5 } }).every(l => !l.startsWith('player.x')));

  const dir = mkdtempSync(join(tmpdir(), 'threedog-snap-'));
  try {
    const miss = compareSnapshot(dir, 'x', d);
    check('compare without a baseline says how to create one', !miss.ok && /snap-describe save x/.test(miss.text), miss.text);
    saveSnapshot(dir, 'x', d, { only: ['player'] });
    check('compare: same state passes, a changed one gives text with the update command',
      compareSnapshot(dir, 'x', d, { only: ['player'] }).ok && /player\.x: 10 -> 14[\s\S]*snap-describe save x/.test(compareSnapshot(dir, 'x', cur, { only: ['player'] }).text));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
