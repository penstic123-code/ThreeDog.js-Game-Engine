// The player: createPlayer and the parts it is made of. What the player is and how it is saved: the top of index.js.
import { Character, CHARACTER_KEYS } from './Character.js';
import { warnOnce, DEV, fmt } from '../../core/base/validate.js';
import { engineOwned } from '../../core/scene/things.js';
import { readParams, keysSchema } from '../../core/base/params.js';
import { codedError, coded } from '../../core/base/errorHints.js';
import { DEV_STRINGS, validControl } from './playerStrings.js';

/** The player's world record: its id and its kind */
export const PLAYER = 'player';

/** vehicle id saved in the player record; a number is a save from before vehicles had ids (the index in rigid.vehicles) */
const vehicleOf = (e, v) => v == null ? null : typeof v === 'number' ? (v >= 0 ? e.rigid?.vehicles[v] ?? null : null) : e.rigid?.vehicles.find(c => c.id === v) ?? null;

/** Everything createPlayer refuses, before it touches the old player */
function checkOptions(e, opts) {
  readParams('characters.createPlayer()', keysSchema([...CHARACTER_KEYS, 'spawn', 'control', 'cameraFollow']), opts);
  const control = opts.control;
  if (control === undefined) throw codedError('player-control', DEV_STRINGS.noControl);
  if (!validControl(control)) throw codedError('player-control', fmt(DEV_STRINGS.badControl, { got: JSON.stringify(control) ?? String(control) }));
  if (!e.world) throw codedError('module-needs', DEV_STRINGS.noWorld);
}

/** Place the player by the record (loading, reusing an existing record): do not write back to the record while placing, write once afterwards so record and
 * character agree */
function placeByRecord(e, p, rec) {
  const car = vehicleOf(e, rec.vehicle), { x, y, z } = rec.position;
  p.recordId = null;
  if (p.vehicle && p.vehicle !== car) p.exit();   // when loading a walking save, exit the vehicle first, else every step pulls it back to the seat
  p.root.position.set(x, y, z); p.loadMotion(rec);
  if (car && p.vehicle !== car) p.enter(car);
  p.recordId = PLAYER; p._store();
}

/**
 * The step of the player's control slot. Gameplay keys are read in the fixed step (input snapshot, frame-rate independent); frame only plays animation.
 * The input is the base holder of the slot: engine.control runs this step (characters fixed, index.js) only while it is in charge, so a walkTo, a game script
 * or a cutscene pauses keys, jump and driving alike, and nothing else moves the player in that step.
 * dt is the player's channel (bullet time on 'player', time.local on 'player').
 */
function inputStep(e, api, p, control) {
  let autoSpeed = null;   // the autopilot speed the move.speed entry holds now (null: no entry)
  return dt => {
    const has = a => e.input.actions.has(a);   // 'interact' exists only with a module or binding that declares it
    // when the interactions module is installed, the vehicle's "exit" interaction handles it
    if (p.vehicle) { if (!e.interactions && has('interact') && e.input.pressed('interact')) p.exit(); }
    else if (p.canJump && e.input.pressed('jump')) p.jump();
    if (p.vehicle && p.seat === 0) { const a = e.input.autopilot || e.input.axis; p.vehicle.drive(a.y, a.x, e.input.down('brake') ? 1 : 0); }
    // autopilot { speed } (benchmarks, recordings) is a move.speed entry like any other modifier, not a second way to set the speed
    const ap = e.input.autopilot?.speed;
    // taken again only when the speed changed (or the entry was cleared): a take every step changed the stack each step, so every
    // speed read recomputed instead of using the stack's memo (core/ops/stacks.js)
    if (ap != null) { if (ap !== autoSpeed || !e.stacks.get('move.speed').has('autopilot', PLAYER)) e.mod('move.speed', { owner: 'autopilot', id: PLAYER, set: ap, layer: 'debug' }); }
    else if (autoSpeed != null) e.stacks.get('move.speed').release('autopilot', { id: PLAYER });
    autoSpeed = ap ?? null;
    return control === 'camera' ? api.moveInput() : control(p, e.input, dt);
  };
}

/** The listeners that keep the record and the player together; returns their handles */
function watchRecord(e, W, p) {
  // record the stable id of the vehicle the player is in (world.set: world:change fires; it follows an enter / exit that already happened)
  const setCar = id => e.ops.allow(() => W.set(PLAYER, { vehicle: id }));
  return [
    e.events.on('vehicle:enter', ({ character }) => { if (character === p) setCar(p.vehicle?.id ?? null); }),
    e.events.on('vehicle:exit', ({ character }) => { if (character === p) setCar(null); }),
    // loading: after world is replaced wholesale, place the player back by the record; if the save has no player record (saved before the player was
    // created), add one from the current state
    e.events.on('world:load', () => {
      const rec = W.get(PLAYER);
      if (rec) placeByRecord(e, p, rec);
      else { W.add({ id: PLAYER, kind: PLAYER, position: p.position, vehicle: null }); p._store(); }
    }),
  ];
}

/**
 * engine.characters.createPlayer, documented there
 * @param {any} e engine
 * @param {any} api engine.characters
 * @param {any} st the module's state: gets the new player's animatePlayer and disposePlayer
 * @param {any} opts
 */
export function createPlayer(e, api, st, opts) {
  checkOptions(e, opts);
  const W = e.world;
  api.removePlayer();   // existing player: dispose the old one first (else two characters respond to keys)
  const p = new Character(e, { channel: 'player', ...opts }), had = W.get(PLAYER);
  p.cameraFollow = !!opts.cameraFollow;   // read again on vehicle exit and a new session (Character.js, camera/common.js)
  if (DEV && opts.cameraFollow === undefined && e.cameraRig) warnOnce(coded('player-control', DEV_STRINGS.noFollow));
  if (!had) W.add({ id: PLAYER, kind: PLAYER, position: [0, 0, 0], vehicle: null });
  if (had && !opts.spawn) { e.player = p; placeByRecord(e, p, had); }   // a record in a vehicle enters it here, and enter() gives the driving keys and camera only to engine.player
  else { p.recordId = PLAYER; p.placeAt(opts.spawn || api.findSpawn()); }
  e.scene.add(engineOwned('characters', p.root));
  // a touch jump button only when the game bound jump (a game without jumping gets no button)
  if (p.canJump && e.input.keysOf('jump').length) e.input.touchButton('jump', 'input.jump');
  e.player = p;
  if (p.cameraFollow && !p.vehicle) e.cameraRig?.follow(p.root);
  const held = e.control.take(p, { owner: 'player-input', layer: 'base', step: inputStep(e, api, p, opts.control) });
  st.animatePlayer = dt => p.animate(dt);
  const watching = watchRecord(e, W, p);
  st.disposePlayer = () => {
    st.animatePlayer = null; held.remove(); for (const h of watching) h.remove();
    p.recordId = null; p.dispose(); W.remove(PLAYER);
    if (e.player === p) e.player = null;
  };
  return p;
}
