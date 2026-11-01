// Characters module: player (keyboard/stick control, camera follow, footsteps, enter/exit vehicles) and NPCs (schedule, pathfinding, dialogue).
// The only pathfinding entry is engine.characters.findPath: uses the navmesh if nav is installed and ready, else A* (astar.js is an internal fallback, not
// exported).
// NPC facts live in engine.world (kind 'npc'), the model is just a presentation when near (see the top of NPC.js): NPCs need world() installed (openWorld
// already does).
// The player is also a world record (id / kind both 'player'): position, facing, motion state and current vehicle live in the record and are saved with world;
// world splits near / far by it by default.
// Only the mover changes the player's position (Character.move / placeAt / enter / exit), then writes back to the record; loading places the player back by the
// record. So install world() before creating the player.
// Vehicles are used through an interface (the { object, speed, drive(), seatPosition(), exitPosition() } returned by rigid.addVehicle); rigid is not imported
// here.
import { Character, CHARACTER_KEYS } from './Character.js';
import { NPCManager, NPC } from './NPC.js';
import { findPath } from './astar.js';
import { findSpawn, moveInput } from './moveHelpers.js';
import { AsyncPaths } from './pathAsync.js';
import { checkOptions, warnOnce, DEV } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { codedError, coded } from '../../core/errorHints.js';
import { DEV_STRINGS, STRINGS, validControl } from './playerStrings.js';
import { footstepSynth, stepSound } from './footsteps.js';
import { xzOf } from '../../core/math.js';
export { Character, NPC };

/**
 * Characters module. Once installed:
 *   engine.characters.createPlayer({ spawn: {x, z}, colors, model, clips })  → player
 *   engine.npcs.add({ id, name, schedule, talk, ... })                       → NPC handle (needs npcs: true, on by default; data lives in engine.world)
 *   engine.npcs.remove(npc or name); engine.characters.removePlayer()
 *   three.js object of player and NPC: .object (= .root, Group), position .position (Vector3); spawn / position accept a Vector3 directly
 *   When an NPC is far it has no model: npc.root is null, npc.position is the data position
 */
const PLAYER = 'player';



/** Navmesh when ready, else A* (characters.findPath; the one synchronous A* entry, see R20) */
function solvePath(e, from, to, o) {
  const { detailed, ...rest } = o;
  let res;
  if (e.nav?.ready) res = e.nav.findPath(from, to, { ...rest, detailed: true });
  else if (!e.collision) res = { status: 'notReady', path: null };
  else {
    const [sx, sz] = xzOf(from), [gx, gz] = xzOf(to), radius = rest.radius ?? e.movement.radius;
    const path = findPath((x, z) => e.collision.walkableAt(x, z, radius), sx, sz, gx, gz, { ...rest, radius });
    // nav installed but not ready: A* is only a stand-in, tell the caller honestly
    res = { status: e.nav ? 'notReady' : path ? 'ok' : 'noPath', path };
  }
  return detailed ? res : res.path;
}

const CHARACTERS_PARAMS = keysSchema(['npcs', 'brakeKeys', 'brakePad']);

export function characters(opts = {}) {
  readParams('characters', CHARACTERS_PARAMS, opts);
  const { npcs = true, brakeKeys, brakePad } = opts;   // no brake key by default: characters({ ...presets.keys.brake }) or the game's own
  let mgr = null, paths = null, disposePlayer = null;
  return {
    name: 'characters', params: CHARACTERS_PARAMS, options: opts, label: 'Characters', noSkip: 'fixed only flushes path requests; schedules read the sky clock', optional: ['cameraRig', 'sky', 'interactions', 'dialogue', 'nav', 'collision', 'rigid', 'world'],
    install(e) {
      e.i18n.add(STRINGS);
      e.audio.register('footstep', footstepSynth, { builtIn: true });
      if (npcs) { mgr = new NPCManager(e); e.npcs = mgr; }
      paths = new AsyncPaths(e);
      e.events.on('ground:change', b => paths.dropTiles(b));   // dug or raised ground: resample the path rasters there
      e.events.on('level:loaded', () => paths.tiles.clear());   // another level: none of the cached rasters describe it
      const api = {
        /**
         * Find a spawn point: spiral outward from position (default origin) for walkable ground (no obstacles, gentle slope) that is not in water. Returns a
         * Vector3 (y is ground height).
         * Assumes no terrain: height range minH / maxH is unbounded by default (open worlds pass their own to avoid beaches and peaks); waterMargin minimum
         * height above water in meters (default 0.5)
         */
        findSpawn(position = { x: 0, z: 0 }, opts = {}) { return findSpawn(e, position, opts); },
        /**
         * Pathfinding (the only entry): navmesh if nav is ready, else A* (needs the collision module). Returns [{ x, z }…], null if unreachable.
         * Pass { detailed: true } to get { status, path }: 'ok' found | 'noPath' unreachable | 'notReady' nav installed but mesh not generated yet (path is the
         * A* fallback, may be inaccurate; null without collision)
         */
        findPath(from, to, o = {}) { return solvePath(e, from, to, o); },
        /**
         * findPath for many callers (NPC crowds, AI squads): solved in engine.threads workers, done(path, status) runs on a fixed step ~4 steps later
         * via engine.commits, so threads on / off give the same paths. Keep findPath for the few that need a path now (click-to-move). Details: recipe 12
         * section 4.
         * @param {any} from
         * @param {any} to
         * @param {(path: { x: number, z: number }[] | null, status: 'ok' | 'noPath' | 'notReady') => void} done
         * @param {{ radius?: number, step?: number, maxNodes?: number }} [opts]
         * @returns {{ cancel: () => void }}
         * @example const req = engine.characters.findPathAsync(guard.position, target, (path, status) => { guard.path = path; });
         * req.remove();   // target changed before the answer came
         */
        findPathAsync(from, to, done, opts) { return paths.request(from, to, done, opts); },
        /** How many findPathAsync requests leave per fixed step (default 32); the rest wait for the next steps */
        get pathsPerStep() { return paths.perStep; },
        set pathsPerStep(n) { paths.perStep = Math.max(1, n | 0); },
        /**
         * The 'camera' player control as a value: movement keys / stick relative to the camera (world axes, up = -Z, without a camera module), the 'run' action
         * when the game bound one, input.autopilot.
         * Returns a reused { x, z, run, speed } (do not keep it). Call it from your own control function to wrap the default instead of rewriting it
         * @example createPlayer({ ...presets.player.thirdPerson, control: (p, input) => busy ? null : engine.characters.moveInput() }) // no movement while
         * attacking
         */
        moveInput() { return moveInput(e); },
        /**
         * Remove the current player (exit the vehicle first, stop responding to keys, dispose the model: animation, geometry, materials; the 'player' record in
         * world is removed too)
         */
        removePlayer() { disposePlayer?.(); disposePlayer = null; },
        /**
         * Create the player. The engine assumes no feel: control is required, keys and camera follow come only from options (presets.player.* bundle them).
         * The player is also the world record with id 'player' (needs the world module).
         * Without spawn and with an existing player record in world (loaded before the player was created) it continues from the record's position; move the
         * player with player.placeAt(position)
         * control (required; also the plain property player.control, switch it at any time) decides who moves the player each fixed step:
         *   'camera' moveInput(): movement keys relative to the camera, plus the jump key and vehicle driving
         * function (player, input, dt) => ({ x, z, run?, speed? }) | null: you decide direction and speed (null = stand still); jump key and vehicles stay.
         * Side-scroller: return { x: input.axis.x, z: 0 }
         *   'none': the engine never moves the player; call player.move(x, z, run, dt) yourself once per fixed step (rolls, attack lunges, hit stun)
         * runKeys / jumpKeys bind the 'run' / 'jump' actions (no keys are bound otherwise; player.jump() still works); cameraFollow: true points the camera
         * module at the player (and back after a vehicle)
         * The world record, saving and describe().player work the same for every control
         * @example const player = engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: engine.characters.findSpawn() })
         * @example const player = engine.characters.createPlayer({ ...presets.player.none, cameraFollow: true }); engine.onFixed(dt => player.move(0, 0, false,
         * dt))
         */
        createPlayer(opts = {}) {
          checkOptions('characters.createPlayer()', opts, [...CHARACTER_KEYS, 'spawn', 'jumpKeys', 'runKeys', 'control', 'cameraFollow']);
          const control = opts.control;
          if (control === undefined) throw codedError('player-control', DEV_STRINGS.noControl);
          if (!validControl(control)) throw codedError('player-control', DEV_STRINGS.badControl.replace('{got}', JSON.stringify(control) ?? String(control)));
          const W = e.world;
          if (!W) throw new Error(DEV_STRINGS.noWorld);
          // vehicle id saved in the player record; a number is a save from before vehicles had ids (the index in rigid.vehicles)
          const vehicleOf = v => v == null ? null : typeof v === 'number' ? (v >= 0 ? e.rigid?.vehicles[v] ?? null : null) : e.rigid?.vehicles.find(c => c.id === v) ?? null;
          disposePlayer?.();   // existing player: dispose the old one first (else two characters respond to keys)
          const p = new Character(e, opts), had = W.get(PLAYER);
          p.control = control;
          p.cameraFollow = !!opts.cameraFollow;   // read again on vehicle exit and a new session (Character.js, camera/common.js)
          if (DEV && opts.cameraFollow === undefined && e.cameraRig) warnOnce(coded('player-control', DEV_STRINGS.noFollow));
          if (!had) W.add({ id: PLAYER, kind: PLAYER, position: [0, 0, 0], vehicle: null });
          // place the player by the record (loading, reusing an existing record): do not write back to the record while placing, write once afterwards so
          // record and character agree
          const apply = rec => {
            const car = vehicleOf(rec.vehicle), { x, y, z } = rec.position;
            p.recordId = null;
            if (p.vehicle && p.vehicle !== car) p.exit();   // when loading a walking save, exit the vehicle first, else every step pulls it back to the seat
            p.root.position.set(x, y, z); p.loadMotion(rec);
            if (car && p.vehicle !== car) p.enter(car);
            p.recordId = PLAYER; p._store();
          };
          if (had && !opts.spawn) apply(had);
          else { p.recordId = PLAYER; p.placeAt(opts.spawn || api.findSpawn()); }
          p.addTo();
          p.onStep = type => e.audio.sfx(stepSound(e, type));
          p.onLand = impact => { if (impact > 3) e.audio.sfx(stepSound(e, p.groundType()), { volume: Math.min(2, impact / 6) }); };
          // the game's keys only: no Space-to-jump or Shift-to-run unless it (or a preset it picked) asked
          if (p.canJump && opts.jumpKeys) { e.input.define('jump', opts.jumpKeys, 'input.jump'); e.input.touchButton('jump', 'input.jump'); }
          if (opts.runKeys) e.input.define('run', opts.runKeys, 'input.run');
          // brake: a separate action, only when the game gives keys (characters({ brakeKeys, brakePad }) or presets.keys.brake: B / gamepad LT), does not
          // compete with jump on space. Registered only when driving is possible (rigid installed)
          if (e.rigid && (brakeKeys || brakePad)) e.input.define('brake', brakeKeys ?? [], 'input.brake', { pad: brakePad, context: 'vehicle' });
          e.player = p;
          if (p.cameraFollow) e.cameraRig?.follow(p.root);
          // gameplay keys are read in the fixed step (input snapshot, frame-rate independent); frame only plays animation
          const fixedHook = e.onFixed(dt => {
            const c = p.control;
            if (c === 'none') return;   // the game drives the player itself: no key reads, no move
            // player.control set to a bad value at runtime
            if (!validControl(c)) { warnOnce(coded('player-control', DEV_STRINGS.badControl.replace('{got}', JSON.stringify(c) ?? String(c)))); return; }
            const has = a => e.input.actions.has(a);   // keys the game bound; an unbound action is simply not used
            // when the interactions module is installed, the vehicle's "exit" interaction handles it
            if (p.vehicle) { if (!e.interactions && has('interact') && e.input.pressed('interact')) p.exit(); }
            else if (p.canJump && has('jump') && e.input.pressed('jump')) p.jump();
            if (p.vehicle) { const a = e.input.autopilot || e.input.axis; p.vehicle.drive(a.y, a.x, e.input.actions.has('brake') && e.input.down('brake') ? 1 : 0); }
            const m = c === 'camera' ? api.moveInput() : c(p, e.input, dt);
            p.move(m?.x ?? 0, m?.z ?? 0, !!m?.run, dt, m?.speed);
          });
          const frameHook = e.onFrame(dt => p.animate(dt));
          // record the stable id of the vehicle the player is in (world.set: world:change fires; it follows an enter / exit that already happened)
          const setCar = id => e.ops.allow(() => W.set(PLAYER, { vehicle: id }));
          const onCar = e.events.on('vehicle:enter', ({ character }) => { if (character === p) setCar(p.vehicle?.id ?? null); });
          const offCar = e.events.on('vehicle:exit', ({ character }) => { if (character === p) setCar(null); });
          // loading: after world is replaced wholesale, place the player back by the record; if the save has no player record (saved before the player was
          // created), add one from the current state
          const onLoad = e.events.on('world:load', () => {
            const rec = W.get(PLAYER);
            if (rec) apply(rec);
            else { W.add({ id: PLAYER, kind: PLAYER, position: p.position, vehicle: null }); p._store(); }
          });
          disposePlayer = () => {
            fixedHook.remove(); frameHook.remove(); onCar.remove(); offCar.remove(); onLoad.remove();
            p.recordId = null; p.dispose(); W.remove(PLAYER);
            if (e.player === p) e.player = null;
          };
          return p;
        },
      };
      return api;
    },
    // NPC simulation and animation are driven by world (simulate / present update); here we only register with world at start; without world, wait for the
    // first npcs.add and then report the error
    init(e) { if (mgr && e.world) mgr.setup(); },
    fixed() { paths.flush(); },
    describe(e, ctx) {
      // with a model report by the model (merged with interaction points and world's own report for the same object into one), without a model report by data
      // position
      for (const r of mgr && e.world ? e.world.query({ kind: 'npc', near: ctx.center, radius: ctx.radius, where: r => e.world.zone == null || r.zone == null || r.zone === e.world.zone }) : []) {
        ctx.near(e.world.view(r.id) ?? r.position, { id: r.id, name: r.name, kind: 'npc', state: r.state });
      }
      if (ctx.out.player) Object.assign(ctx.out.player, { swimming: e.player.swimming, grounded: e.player.grounded, facing: Math.round(e.player.facing * 100) / 100,
        control: typeof e.player.control === 'function' ? 'custom' : e.player.control, faceMode: e.player.faceMode, mover: e.player.mover.name, ...(e.player.anim && { anim: e.player.anim.describe() }), ...(e.player.vehicle && { vehicle: { speed: Math.round(e.player.vehicle.speed * 10) / 10 } }) });
    },
  };
}
