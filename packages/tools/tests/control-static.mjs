// Character control, static half (the browser half is packages/engine/tests/specs/control.mjs): inside the engine, a character's move() is
// called only by the control slot (core/ops/control.js: a holder's step or handle.move) and by NPC behaviours, which run inside control.runAs
// (npcSim.js). Any other engine file calling ch.move( / player.move( is a second driver beside the holder: the bug control exists to remove.
// Why a source scan and not only the runtime control-bypass error: the runtime check fires only in dev and only on the path a test walks.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

const { Control } = await import(pathToFileURL(join(ENGINE, 'core/ops/control.js')).href);

export const name = 'character control: only the control slot and NPC behaviours call a character\'s move() in engine code';

// files allowed to call a character's move(): the slot itself, and the behaviour helpers it runs as the NPC's base holder
const ALLOW = new Set(['core/ops/control.js', 'modules/characters/npcSim.js']);
// receivers that name a character (world.move, mover.move, a touch stick's move are other things)
const CHAR = /(?:^|[^\w$.])((?:e\.|engine\.|this\.)?(?:ch|chr|character|player|rider|npc\.character\??|p))\.move\(/;
const DIRS = ['core', 'modules', 'ui', 'render'];
// strings are messages and fixes (they quote the call): blanked before the scan, so only code counts
const STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;

function files(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) files(f, out); else if (n.endsWith('.js')) out.push(f);
  }
  return out;
}

export async function run({ check }) {
  // this node run is a release build: two owners on one layer stop here too, and the first keeps the character (nothing resolves silently)
  const C = new Control({ events: { on() {} }, session: { captured: false, _untrack() {} } });
  C.take('c', { owner: 'a', layer: 'script' });
  let clash = null;
  try { C.take('c', { owner: 'b', layer: 'script' }); } catch (x) { clash = x; }
  check('[guard] release: two owners on one layer throw control-conflict naming both, the first stays', clash?.code === 'control-conflict' && clash.message.includes("'a'") && clash.message.includes("'b'") && C.has('c', 'a') && !C.has('c', 'b'), String(clash));
  const hits = [];
  for (const d of DIRS) for (const f of files(join(ENGINE, d))) {
    const rel = relative(ENGINE, f).split(sep).join('/');
    if (ALLOW.has(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(STRINGS, "''").replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) return;   // JSDoc lines (examples show game code)
      if (CHAR.test(code)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  check('[guard] no engine file outside core/ops/control.js and npcSim.js calls a character\'s move()', hits.length === 0, hits.join('\n'));
  // the scan itself: it must see a direct call, and must not count world.move, the slot's own handle or a quoted call
  check('the scan catches ch.move( and player.move(, ignores world.move( / ctl.move( / strings', CHAR.test('  ch.move(1, 0, false, dt);') && CHAR.test('e.player.move(0, 0)')
    && !CHAR.test('W.move(id, p)') && !CHAR.test('ctl.move(x, z)') && !CHAR.test('this.mover.move(x)') && !CHAR.test("fix: 'character.move() was called'".replace(STRINGS, "''")));
}
