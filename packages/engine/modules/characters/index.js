// Characters module: player (keyboard/stick control, camera follow, footsteps, enter/exit vehicles) and NPCs (schedule, pathfinding, dialogue).
// The only pathfinding entry is engine.characters.findPath: uses the navmesh if nav is installed and ready, else A* (astar.js is an internal fallback, not exported).
// NPC facts live in engine.world (kind 'npc'), the model is just a presentation when near (see the top of NPC.js): NPCs need world() installed (openWorld already does).
// The player is also a world record (id / kind both 'player'): position, facing, motion state and current vehicle live in the record and are saved with world; world splits near / far by it by default.
// Only the mover changes the player's position (Character.move / placeAt / enter / exit), then writes back to the record; loading places the player back by the record. So install world() before creating the player.
// Vehicles are used through an interface (the { object, speed, drive(), seatPosition(), exitPosition() } returned by rigid.addVehicle); rigid is not imported here.
import { Character, CHARACTER_KEYS } from './Character.js';
import * as THREE from 'three';
import { NPCManager, NPC } from './NPC.js';
import { findPath } from './astar.js';
import { AsyncPaths } from './pathAsync.js';
import { xzOf } from '../../core/math.js';
import { checkOptions, checkOptionsArg } from '../../core/validate.js';
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
const REQ = { x: 0, z: 0, run: false, speed: undefined };   // moveInput() result, reused every step (no allocation)
const DEV_STRINGS = { badControl: 'characters.createPlayer(): control must be true (default keyboard/stick control), false (the game calls player.move() itself in onFixed) or a function (player, input, dt) => ({ x, z, run?, speed? }); got {got}',
  noWorld: 'characters.createPlayer() needs world() installed first: the player is a record in world (position is saved, world splits near/far by it). Use engine.use(world(), …); openWorld() already installs it' };
const STRINGS = { 'zh-CN': { 'npc.talk': '和{name}说话', 'input.jump': '跳跃', 'input.brake': '刹车' }, en: { 'npc.talk': 'Talk to {name}', 'input.jump': 'Jump', 'input.brake': 'Brake' } };

// Procedural footstep fallback (a file from style pack style.sounds.footstep is used if given; style.sounds.synth.footstep can tune the params)
const STEP_SYNTH = { grass: ['bandpass', 900, 0.08, 0.12], sand: ['lowpass', 1400, 0.1, 0.14], rock: ['bandpass', 2400, 0.05, 0.1], snow: ['lowpass', 900, 0.12, 0.16], water: ['bandpass', 600, 0.15, 0.18] };
function footstepSynth(audio, surface, params) {
  const table = { ...STEP_SYNTH, ...(params.surfaces || {}) };
  const p = table[surface] || table[params.default || 'grass'];
  audio.noiseBurst({ type: p[0], freq: p[1] * (0.9 + Math.random() * 0.2), vol: p[2] * (params.volume ?? 1), dur: p[3] });   // presentation: random footstep pitch
}

export function characters(opts = {}) {
  const { npcs = true, brakeKeys = ['KeyB'], brakePadKeys = ['PadLT'] } = opts;
  let mgr = null, paths = null, disposePlayer = null;
  return {
    name: 'characters', label: 'Characters', optional: ['cameraRig', 'sky', 'interactions', 'dialogue', 'nav', 'collision', 'rigid', 'world'],
    install(e) {
      checkOptions('characters()', opts, ['npcs', 'brakeKeys', 'brakePadKeys']);
      e.i18n.add(STRINGS);
      e.audio.register('footstep', footstepSynth);
      if (npcs) { mgr = new NPCManager(e); e.npcs = mgr; }
      paths = new AsyncPaths(e);
      e.events.on('ground:change', b => paths.dropTiles(b));   // dug or raised ground: resample the path rasters there
      e.events.on('level:loaded', () => paths.tiles.clear());   // another level: none of the cached rasters describe it
      const api = {
        /**
         * Find a spawn point: spiral outward from position (default origin) for walkable ground (no obstacles, gentle slope) that is not in water. Returns a Vector3 (y is ground height).
         * Assumes no terrain: height range minH / maxH is unbounded by default (open worlds pass their own to avoid beaches and peaks); waterMargin minimum height above water in meters (default 0.5)
         */
        findSpawn(position = { x: 0, z: 0 }, opts = {}) {
          const [x, z] = xzOf(position);
          checkOptionsArg('characters.findSpawn()', opts, ['minH', 'maxH', 'maxSlope', 'waterMargin']);
          const { minH = -Infinity, maxH = Infinity, maxSlope = 0.3, waterMargin = 0.5 } = opts;
          for (let r = 0; r < 4000; r += 6) {
            const a = r * 0.37, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, h = e.surface(px, pz);
            const dry = h > e.waterAt(px, pz) + waterMargin, walk = !e.collision || e.collision.walkableAt(px, pz);
            if (dry && h > minH && h < maxH && e.slope(px, pz) < maxSlope && walk) return new THREE.Vector3(px, h, pz);
          }
          return new THREE.Vector3(x, e.surface(x, z), z);
        },
        /**
         * Pathfinding (the only entry): navmesh if nav is ready, else A* (needs the collision module). Returns [{ x, z }…], null if unreachable.
         * Pass { detailed: true } to get { status, path }: 'ok' found | 'noPath' unreachable | 'notReady' nav installed but mesh not generated yet (path is the A* fallback, may be inaccurate; null without collision)
         */
        findPath(from, to, o = {}) {
          const { detailed, ...rest } = o;
          let res;
          if (e.nav?.ready) res = e.nav.findPath(from, to, { ...rest, detailed: true });
          else if (!e.collision) res = { status: 'notReady', path: null };
          else {
            const [sx, sz] = xzOf(from), [gx, gz] = xzOf(to), radius = rest.radius ?? e.movement.radius;
            const path = findPath((x, z) => e.collision.walkableAt(x, z, radius), sx, sz, gx, gz, rest);
            res = { status: e.nav ? 'notReady' : path ? 'ok' : 'noPath', path };   // nav installed but not ready: A* is only a stand-in, tell the caller honestly
          }
          return detailed ? res : res.path;
        },
        /**
         * findPath for many callers (NPC crowds, AI squads): solved in engine.threads workers, done(path, status) runs on a fixed step ~4 steps later
         * via engine.commits, so threads on / off give the same paths. Keep findPath for the few that need a path now (click-to-move). Details: recipe 12 section 4.
         * @param {any} from
         * @param {any} to
         * @param {(path: { x: number, z: number }[] | null, status: 'ok' | 'noPath' | 'notReady') => void} done
         * @param {{ radius?: number, step?: number, maxNodes?: number }} [opts]
         * @returns {{ cancel: () => void }}
         * @example const req = engine.characters.findPathAsync(guard.position, target, (path, status) => { guard.path = path; });
         * req.cancel();   // target changed before the answer came
         */
        findPathAsync(from, to, done, opts) { return paths.request(from, to, done, opts); },
        /** How many findPathAsync requests leave per fixed step (default 32); the rest wait for the next steps */
        get pathsPerStep() { return paths.perStep; },
        set pathsPerStep(n) { paths.perStep = Math.max(1, n | 0); },
        /**
         * The default player control as a value: movement keys / stick relative to the camera (world axes, up = -Z, without a camera module), run key, input.autopilot.
         * Returns a reused { x, z, run, speed } (do not keep it). Call it from your own control function to wrap the default instead of rewriting it
         * @example createPlayer({ control: (p, input) => busy ? null : engine.characters.moveInput() })   // no movement while attacking
         */
        moveInput() {
          const inp = e.input, auto = inp.autopilot, a = auto || inp.axis;   // autopilot (stress tests, recordings): input.autopilot = { x, y, speed }
          const f = e.cameraRig ? e.cameraRig.forward() : { x: 0, z: -1 }, rt = e.cameraRig ? e.cameraRig.right() : { x: 1, z: 0 };
          REQ.x = f.x * a.y + rt.x * a.x; REQ.z = f.z * a.y + rt.z * a.x; REQ.run = inp.down('run'); REQ.speed = auto?.speed;
          return REQ;
        },
        /** Remove the current player (exit the vehicle first, stop responding to keys, dispose the model: animation, geometry, materials; the 'player' record in world is removed too) */
        removePlayer() { disposePlayer?.(); disposePlayer = null; },
        /**
         * Create the keyboard/stick-controlled player; with the camera module the camera follows automatically. The player is also the world record with id 'player' (needs the world module).
         * Without spawn and with an existing player record in world (loaded before the player was created) it continues from the record's position; move the player with player.placeAt(position)
         * control (also the plain property player.control, switch it at any time) decides who moves the player each fixed step:
         *   true (default) moveInput(): keys relative to the camera, plus jump key and vehicle driving
         *   function (player, input, dt) => ({ x, z, run?, speed? }) | null: you decide direction and speed (null = stand still); jump key and vehicles stay. Side-scroller: return { x: input.axis.x, z: 0 }
         *   false: the engine never moves the player; call player.move(x, z, run, dt) yourself once per fixed step (rolls, attack lunges, hit stun)
         * The world record, saving and describe().player work the same in all three
         * @example const player = engine.characters.createPlayer({ spawn: engine.characters.findSpawn() })
         * @example const player = engine.characters.createPlayer({ control: false, faceMode: 'manual' }); engine.onFixed(dt => player.move(0, 0, false, dt))
         */
        createPlayer(opts = {}) {
          checkOptions('characters.createPlayer()', opts, [...CHARACTER_KEYS, 'spawn', 'jumpKeys', 'control']);
          const control = opts.control ?? true;
          if (typeof control !== 'boolean' && typeof control !== 'function') throw new Error(DEV_STRINGS.badControl.replace('{got}', String(control)));
          const W = e.world;
          if (!W) throw new Error(DEV_STRINGS.noWorld);
          // vehicle id saved in the player record; a number is a save from before vehicles had ids (the index in rigid.vehicles)
          const vehicleOf = v => v == null ? null : typeof v === 'number' ? (v >= 0 ? e.rigid?.vehicles[v] ?? null : null) : e.rigid?.vehicles.find(c => c.id === v) ?? null;
          disposePlayer?.();   // existing player: dispose the old one first (else two characters respond to keys)
          const p = new Character(e, opts), had = W.get(PLAYER);
          p.control = control;
          if (!had) W.add({ id: PLAYER, kind: PLAYER, position: [0, 0, 0], vehicle: null });
          // place the player by the record (loading, reusing an existing record): do not write back to the record while placing, write once afterwards so record and character agree
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
          p.onStep = type => e.audio.sfx('footstep', type);
          p.onLand = impact => { if (impact > 3) e.audio.sfx('footstep', p.groundType(), { volume: Math.min(2, impact / 6) }); };
          if (p.canJump) { e.input.define('jump', opts.jumpKeys || ['Space'], 'input.jump'); e.input.touchButton('jump', 'input.jump'); }
          // brake: a separate action (default B / gamepad LT, change via characters({ brakeKeys })), does not compete with jump on space. Registered only when driving is possible (rigid installed)
          if (e.rigid) e.input.define('brake', brakeKeys, 'input.brake', { pad: brakePadKeys, context: 'vehicle' });
          e.player = p;
          e.cameraRig?.follow(p.root);
          // gameplay keys are read in the fixed step (input snapshot, frame-rate independent); frame only plays animation
          const fixedHook = e.onFixed(dt => {
            const c = p.control;
            if (c === false) return;   // the game drives the player itself: no key reads, no move
            if (p.vehicle) { if (!e.interactions && e.input.pressed('interact')) p.exit(); }   // when the interactions module is installed, the vehicle's "exit" interaction handles it
            else if (p.canJump && e.input.pressed('jump')) p.jump();
            if (p.vehicle) { const a = e.input.autopilot || e.input.axis; p.vehicle.drive(a.y, a.x, e.input.actions.has('brake') && e.input.down('brake') ? 1 : 0); }
            const m = c === true ? api.moveInput() : c(p, e.input, dt);
            p.move(m?.x ?? 0, m?.z ?? 0, !!m?.run, dt, m?.speed);
          });
          const frameHook = e.onFrame(dt => p.animate(dt));
          // record the stable id of the vehicle the player is in (world.set: world:change fires; it follows an enter / exit that already happened)
          const setCar = id => e.ops._allowing(() => W.set(PLAYER, { vehicle: id }));
          const onCar = e.events.on('vehicle:enter', ({ character }) => { if (character === p) setCar(p.vehicle?.id ?? null); });
          const offCar = e.events.on('vehicle:exit', ({ character }) => { if (character === p) setCar(null); });
          // loading: after world is replaced wholesale, place the player back by the record; if the save has no player record (saved before the player was created), add one from the current state
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
    // NPC simulation and animation are driven by world (simulate / present update); here we only register with world at start; without world, wait for the first npcs.add and then report the error
    init(e) { if (mgr && e.world) mgr.setup(); },
    fixed() { paths.flush(); },
    describe(e, ctx) {
      // with a model report by the model (merged with interaction points and world's own report for the same object into one), without a model report by data position
      for (const r of mgr && e.world ? e.world.query({ kind: 'npc', near: ctx.center, radius: ctx.radius, where: r => e.world.zone == null || r.zone == null || r.zone === e.world.zone }) : []) {
        ctx.near(e.world.view(r.id) ?? r.position, { id: r.id, name: r.name, kind: 'npc', state: r.state });
      }
      if (ctx.out.player) Object.assign(ctx.out.player, { swimming: e.player.swimming, grounded: e.player.grounded, facing: Math.round(e.player.facing * 100) / 100,
        control: typeof e.player.control === 'function' ? 'custom' : e.player.control === false ? 'off' : 'default', faceMode: e.player.faceMode, mover: e.player.mover.name, ...(e.player.anim && { anim: e.player.anim.describe() }), ...(e.player.vehicle && { vehicle: { speed: Math.round(e.player.vehicle.speed * 10) / 10 } }) });
    },
  };
}
