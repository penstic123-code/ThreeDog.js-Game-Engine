// Game flow: states (title, playing, paused, game over...) and scene transitions (fade out → swap scene → fade in).
//   engine.use(flow());                               // built-in 'playing' (default) and 'paused' (freezes gameplay + locks input)
//   engine.flow.define('title', { enter: e => showTitle(), exit: e => hideTitle(), freeze: true, lockInput: true, music: 'title' });
//   engine.flow.go('paused');  engine.flow.state      // 'paused'
//   await engine.flow.transition(async () => engine.level.load('/models/town2.glb'));   // lock input, fade out, load level, wait for ready, fade in
// Pause has one entry point: flow's 'paused' (internally engine.freeze('flow'); rendering continues); settings({ freezeWorld: true }) switches to it when the menu opens.
// Don't use engine.pause() (it stops rendering too; tests only). While frozen: fixed step, module fixed hooks, game clock, quest checks, timeline wait/tween all stop.
// engine.session.newGame / load / quit move flow too: back to the start state when a playthrough ends, then 'playing' when the next starts.
// Esc is not handled here: back goes through the UI focus stack (ui/Focus.js), and opens the settings menu when the stack is empty. Events: flow:change { from, to }, flow:transition { phase: 'start' | 'end' }.
import { checkOptions, warnMissing } from '../../core/validate.js';
import { fadeScreen } from '../../ui/UI.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { Flow, FlowOptions } from '../../types/gameplay' */

const STATE_KEYS = ['enter', 'exit', 'freeze', 'lockInput', 'music'];

/**
 * Game flow and scene transitions → engine.flow
 * @param {FlowOptions} [opts]
 * @returns {ModuleDef<Flow>}
 */
export function flow(opts = {}) {
  let e = null, chain = Promise.resolve(), held = null;
  const states = new Map([['playing', {}], ['paused', { freeze: true, lockInput: true }]]);
  // turn freeze / input lock on or off for one state
  const hold = (def, on) => {
    if (def.freeze) on ? e.freeze('flow') : e.unfreeze('flow');
    if (def.lockInput) { if (on) held ??= e.input.push('flow'); else { held?.remove(); held = null; } }
  };
  // wait until all modules are isReady() (checked per engine frame, so step() advances it too)
  const allReady = () => [...e.modules.values()].every(m => !m.isReady || m.isReady(e));
  const waitReady = () => allReady() ? Promise.resolve() : new Promise(res => { const h = e.onFrame(() => { if (allReady()) { h.remove(); res(); } }); });

  const api = {
    /** Current state name */
    state: 'playing',
    /** True while a scene transition is running */
    transitioning: false,
    /** Define a state: { enter(e, from), exit(e, to), freeze, lockInput, music } */
    define(name, def) { checkOptions(`flow.define('${name}')`, def, STATE_KEYS); states.set(name, def); return api; },
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
      checkOptions('flow.transition()', o, ['fade', 'lockInput', 'music', 'autosave']);
      const { fade = 0.5, lockInput = true, music = 'fade', autosave = false } = o;
      const run = async () => {
        api.transitioning = true;
        e.events.emit('flow:transition', { phase: 'start' });
        const lock = lockInput ? e.input.push('transition') : null;
        let shown = false;
        try {
          await fadeScreen(e, 1, fade);
          const m = music === 'fade' ? e.music : null, prev = m?.current;
          m?.stop(fade);
          if (autosave === 'auto') e.saves.save('auto');
          await e.ops._allowing(async () => { await fn?.(); });   // the scene swap is loading: the ops guard lets its writes through
          await waitReady();
          if (m && prev && !m.current && !m.ruled) m.play(prev);   // no track rule: resume the previous track after the switch
          await fadeScreen(e, 0, fade);
          shown = true;
        } finally {
          if (!shown) fadeScreen(e, 0, 0);   // fn threw: don't leave the screen black, fade back in at once (the error still propagates to the caller)
          lock?.remove();
          api.transitioning = false;
          e.events.emit('flow:transition', { phase: 'end' });
        }
      };
      return (chain = chain.then(run, run));
    },
  };
  return {
    name: 'flow', label: 'Game flow', optional: ['music'],
    install(engine) {
      e = engine;
      checkOptions('flow()', opts, ['start']);
      // initial state (title screen etc.): entered once the world is ready, so the game can define it after use()
      if (opts.start && opts.start !== 'playing') e.events.once('world:ready', () => api.go(opts.start));
      // a playthrough ends (engine.session): back to the start state, so its enter() runs again; a new one starts in 'playing'
      e.events.on('session:end', () => api.go(opts.start ?? 'playing'));
      e.events.on('session:start', () => api.go('playing'));
      return api;
    },
    describe() { return { state: api.state, transitioning: api.transitioning }; },
  };
}
