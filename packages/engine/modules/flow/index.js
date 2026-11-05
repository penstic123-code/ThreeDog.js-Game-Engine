// Game flow: states and scene transitions.
// States: title, playing, paused, game over...; transitions: fade out, swap scene, fade in.
//   engine.use(flow());                               // built-in 'playing' (default) and 'paused' (freezes gameplay + locks input)
//   engine.flow.define('title', { enter: e => showTitle(), exit: e => hideTitle(), freeze: true, lockInput: true, music: 'title' });
//   engine.flow.go('paused');  engine.flow.state      // 'paused'
//   await engine.flow.transition(async () => engine.level.load('/models/town2.glb'));   // lock input, fade out, load level, wait for ready, fade in
// Pause has one entry point: flow's 'paused' (internally engine.freeze('flow'); rendering continues); settings({ freezeWorld: true }) switches to it when the menu opens.
// engine.haltLoop() is another thing: it stops rendering too, for tests only. While frozen: fixed step, module fixed hooks, game clock, quest checks, timeline wait/tween all stop.
// engine.session.newGame / load / quit move flow too: back to the start state when a playthrough ends, then 'playing' when the next starts.
// Esc is not handled here: back goes through the UI focus stack (ui/Focus.js), and opens the settings menu when the stack is empty. Events: flow:change { from, to }, flow:transition { phase: 'start' | 'end' }.
import { warnMissing } from '../../core/base/validate.js';
import { readParams, keysSchema } from '../../core/base/params.js';
import { fadeScreen } from '../../ui/UI.js';
import { unsettled } from '../../core/engine/headlessLoad.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { Flow, FlowOptions } from '../../types/gameplay' */

const STATE_KEYS = ['enter', 'exit', 'freeze', 'lockInput', 'music'];

const FLOW_PARAMS = keysSchema(['start']);

/**
 * Game flow and scene transitions → engine.flow
 * @param {FlowOptions} [opts]
 * @returns {ModuleDef<Flow>}
 */
export function flow(opts = {}) {
  readParams('flow', FLOW_PARAMS, opts);
  let e = null, chain = Promise.resolve(), held = null, frozen = null;
  const states = new Map([['playing', {}], ['paused', { freeze: true, lockInput: true }]]);
  // turn freeze / input lock on or off for one state
  const hold = (def, on) => {
    if (def.freeze) { if (on) frozen ??= e.freeze('flow'); else { frozen?.remove(); frozen = null; } }
    if (def.lockInput) { if (on) held ??= e.input.push('flow'); else { held?.remove(); held = null; } }
  };
  // wait until the modules and the required nearby builds are ready (checked per engine frame, so step() advances it too)
  const settled = () => !unsettled(e).length;
  const waitReady = () => settled() ? Promise.resolve() : new Promise(res => { const h = e.onFrame(() => { if (settled()) { h.remove(); res(); } }); });

  const api = {
    /** Current state name */
    state: 'playing',
    /** True while a scene transition is running */
    transitioning: false,
    /** Define a state: { enter(e, from), exit(e, to), freeze, lockInput, music } */
    define(name, def) { readParams(`flow.define('${name}')`, keysSchema(STATE_KEYS), def); states.set(name, def); return api; },
    /** Switch state */
    go(name) {
      const to = states.get(name);
      if (!to) { warnMissing('flowState', name, [...states.keys()]); return; }
      const from = api.state, def = states.get(from);
      if (from === name) return;
      def.exit?.(e, name);
      hold(def, false);
      api.state = name;
      hold(to, true);
      if (to.music !== undefined) to.music === null ? e.music?.stop() : e.music?.play(to.music);
      to.enter?.(e, from);
      e.events.emit('flow:change', { from, to: name });
    },
    /** Scene transition: lock input → fade out → fade music → (autosave: 'auto' saves slot 'auto') → fn() → wait for modules ready → fade in → unlock. Repeated calls are queued */
    transition(fn, o = {}) {
      readParams('flow.transition()', keysSchema(['fade', 'lockInput', 'music', 'autosave']), o);
      const { fade = 0.5, lockInput = true, music = 'fade', autosave = false } = o;
      const run = async () => {
        api.transitioning = true;
        e.events.emit('flow:transition', { phase: 'start' });
        const lock = lockInput ? e.input.push('transition') : null;
        let shown = false;
        try {
          await fadeScreen(e, 1, { seconds: fade });
          const m = music === 'fade' ? e.music : null, prev = m?.current;
          m?.stop({ fade });
          if (autosave === 'auto') e.saves.save('auto');
          await e.ops.allow(async () => { await fn?.(); });   // the scene swap is loading: the ops guard lets its writes through
          await waitReady();
          if (m && prev && !m.current && !m.ruled) m.play(prev);   // no track rule: resume the previous track after the switch
          await fadeScreen(e, 0, { seconds: fade });
          shown = true;
        } finally {
          if (!shown) fadeScreen(e, 0, { seconds: 0 });   // fn threw: don't leave the screen black, fade back in at once (the error still propagates to the caller)
          lock?.remove();
          api.transitioning = false;
          e.events.emit('flow:transition', { phase: 'end' });
        }
      };
      return (chain = chain.then(run, run));
    },
  };
  return {
    name: 'flow', type: 'rules', provides: ['flow'], params: FLOW_PARAMS, options: opts, label: 'Game flow', optional: ['music'],
    install(engine, ctx) { engine.i18n.add({ 'zh-CN': { 'module.flow': '游戏流程' }, en: { 'module.flow': 'game flow' } });
      e = engine;
      // initial state (title screen etc.): entered once the world is ready, so the game can define it after use()
      if (opts.start && opts.start !== 'playing') ctx.track(e.events.once('engine:ready', () => api.go(opts.start)));
      // a playthrough ends (engine.session): back to the start state, so its enter() runs again; a new one starts in 'playing'
      // a failed replacement keeps the old playthrough: back to the state it was in
      let before = null;
      ctx.track(e.events.on('session:end', () => { before = api.state; api.go(opts.start ?? 'playing'); }));
      ctx.track(e.events.on('session:start', () => api.go('playing')));
      ctx.track(e.events.on('session:failed', () => { if (before) api.go(before); }));
      return api;
    },
    // unloaded (unuse, replaces) in a state that stops the game: nothing else would ever end its freeze or input lock
    dispose() { frozen?.remove(); held?.remove(); frozen = held = null; },
    // ?play / applyState({ play }): leave the start state (a title) the way its Start button does; session:start then goes to 'playing'
    stateKeys: ['play'],
    applyState(e, { play }) { if (play != null && opts.start && opts.start !== 'playing' && api.state === opts.start) return e.session.newGame(); },
    describe() { return { state: api.state, transitioning: api.transitioning }; },
  };
}
