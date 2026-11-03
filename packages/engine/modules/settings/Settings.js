// Settings menu module: the basic cancel key (Esc / pad B) opens it in game (when the UI focus stack is empty: no window, dialogue or cutscene open; see ui/Focus.js); tabs for graphics,
// audio, keys, language, saves (export / import save files).
// Changes apply at once and autosave to the browser (localStorage), restored on the next launch.
//
//   engine.use(settings());                        // install after other modules (so it sees terrain, audio, etc.)
//   engine.settings.open() / close() / toggle()
//   engine.settings.set('shadows', false)          // change a setting in code (also saved)
//   engine.settings.get('vol.music')               // → 0.5
//   engine.settings.preset('low')                  // graphics preset: 'low' | 'medium' | 'high'
//
// Tabs: default graphics, audio, keys, language, saves. Optional built-ins, off unless asked for: 'game' (resume / load / back to title) and
// 'camera' (mouse sensitivity, invert Y, field of view): settings({ sections: ['game', 'graphics', 'audio', 'controls', 'camera'] }) or addSection('camera').
// The whole menu is replaceable: skip this module and build your own (register it as the Esc root with uiFocus(engine).setRoot(() => myMenu.open())).
//
// A game's own settings page (e.g. "Gameplay"):
//   engine.settings.define('subtitles', true, on => game.subtitles = on);   // custom setting: default value + apply function, autosaved
//   engine.settings.define('volfog', true, { limits: 'look.post.volfog.enabled' });   // off holds the game's own effect off, like the shadows row
//   engine.settings.addSection('gameplay', {
//     title: e => e.t('my.gameplay'),
//     render: (tools, e, s) => tools.row(tools.t('my.subtitles'), tools.toggle('subtitles', s.get('subtitles'))),
//     bind: (el, e, s) => {},                       // optional: called after every redraw, to wire events on custom controls
//     order: 50,
//   });
//
// Look:
//   CSS classes  .threedog-win-settings .threedog-tabs .threedog-tab .threedog-set-row .threedog-set-label .threedog-set-ctl .threedog-seg .threedog-range
//           .threedog-set-val .threedog-key(.is-waiting/.is-conflict) .threedog-set-note .threedog-set-foot .is-active — override with style.ui.css
//   Replace it whole: style.ui.templates.settings({ sections, current, body, values }, { esc, t, icon }) returns HTML;
// controls just carry the attributes data-tab / data-set+data-value / data-range / data-rebind / data-reset / data-locale / data-save-export / data-save-import
// (see sections.js)
import { makeWindow, injectUICSS, uiFocus } from '../../ui/UI.js';
import { BUILTIN_SECTIONS } from './sections.js';
import { STRINGS, CSS } from './strings.js';
import { SettingsView } from './view.js';
import { applySetting, allowed, checkLimits } from './apply.js';
import { readParams, keysSchema } from '../../core/params.js';
import { reportError } from '../../core/errors.js';

// Graphics presets. Values are performance tiers, not art; a game can override with settings({ presets: { low: {...} } })
const PRESETS = {
  low: { pixelRatio: 0.75, shadows: false, antialias: false, bloom: false, ao: false, viewChunks: 3, density: 0.5 },
  medium: { pixelRatio: 1, shadows: true, antialias: true, bloom: false, ao: false, viewChunks: 4, density: 0.75 },
  high: { pixelRatio: 1.5, shadows: true, antialias: true, bloom: true, ao: false, viewChunks: 5, density: 1 },
};
// Settings keys that switch a style post effect of the same name; a key whose effect the style lacks is hidden and ignored
const POST_KEYS = ['bloom', 'ao'];

export class Settings extends SettingsView {
  constructor(engine, { action = 'cancel', storageKey, presets = {}, sections = true, freezeWorld = false } = {}, track) {
    super();
    /** @internal the module's ctx.track: listeners the settings and its sections add leave with the module */ this._track = track;
    this.engine = engine;
    this.action = action;
    this.presets = { ...PRESETS };
    for (const k in presets) this.presets[k] = { ...(this.presets[k] || {}), ...presets[k] };
    // Storage key: shares the game's save prefix ('game-save-' -> 'game-settings') but is kept out of the save list
    const p = engine.saves.prefix;
    this.storageKey = storageKey || p.replace(/save-$/, '') + 'settings';
    this.sections = new Map();
    this.custom = new Map();         // game's custom settings: key -> { def, apply }
    this.capturing = null;           // action name waiting for a key press
    this.current = null;             // current tab
    this.freezeWorld = freezeWorld;

    engine.i18n.add(STRINGS);
    // the default opener is the basic cancel key (the UI focus stack hands it to the menu when nothing else is open); another action is the
    // game's, declared here and bound by the game (settings({ action: 'menu' }) + engine.input.bind('menu', ['Tab']))
    if (action !== 'cancel') track(engine.input.action(action, { label: 'settings.action', owner: 'settings' }));
    injectUICSS(CSS);

    const stored = this._read();
    this.saved = stored;                       // raw data read back
    // the player's saved keys: through input.rebind, the one way to rebind (the settings layer of 'input.keys'). It works before the module that
    // declares an action is installed, so nothing waits for "every action registered"
    for (const [a, k] of Object.entries(stored.bindings || {})) if (Array.isArray(k) && k.length) engine.input.rebind(a, k);
    this.values = { ...this._currentValues(), ...(stored.values || {}) };
    this._applyAll();
    // Tabs: true = the default set; a list picks built-in and optional tabs by name (optional ones register their own settings in setup)
    if (sections === true) for (const [id, s] of Object.entries(BUILTIN_SECTIONS)) this.sections.set(id, s);
    else if (sections) for (const id of sections) this._builtin(id);
    if (stored.locale && engine.i18n.languages.includes(stored.locale) && stored.locale !== engine.i18n.locale) engine.i18n.setLocale(stored.locale);

    this.win = makeWindow(engine, {
      id: 'settings', title: () => engine.t('settings.title'), hintAction: action,
      data: () => this._data(),
      render: (d, tools) => this._render(d, tools),
      onCancel: () => this._cancel(),
    });
    const baseRefresh = this.win.refresh;
    this.win.refresh = () => { baseRefresh(); this._afterRefresh(); };
    this._bindDOM(this.win.el);

    track(this.win);
    // The back key (Esc) has one entry point: with an empty focus stack it opens the menu; while the menu is open the window's onCancel handles it
    this.focus = uiFocus(engine);
    this.focus.setRoot(() => this.open());
    // The close button, the back key and code close() all go through the window's toggle, emitting ui:open / ui:close
    track(engine.events.on('ui:open', id => { if (id === 'settings') this._pause(true); }));
    track(engine.events.on('ui:close', id => { if (id === 'settings') this._pause(false); }));
    track(engine.events.on('i18n:change', () => { if (this._ready) this.save(); }));
  }

  // ---------- reading and writing settings ----------
  get(key) { return this.values[key]; }
  /** Change a setting: applies at once and saves. Changing a graphics setting turns the preset into "custom" */
  set(key, value, { save = true } = {}) {
    if (key === 'quality') return this.preset(value);
    this.values[key] = value;
    this._apply(key, value);
    if (key in (this.presets.low || {})) this.values.quality = this._matchPreset();
    if (save) this.save();
    this.win.refresh();
  }
  /** Graphics preset */
  preset(name) {
    const p = this.presets[name]; if (!p) return;
    for (const k in p) { this.values[k] = p[k]; this._apply(k, p[k]); }
    this.values.quality = name;
    this.save(); this.win.refresh();
  }
  /**
   * A game's custom setting: default value + apply function (called at once with the saved value), or { apply, limits }. limits names the shared
   * value(s) the row restricts on the settings layer, the same way the built-in shadows row does: off holds the value off (a cutscene or the
   * scene cannot turn it back on), on allows what the scene chose; a number row from 0 to 1 is a factor on a number value.
   * @param {string} key @param {any} def
   * @param {((value: any, engine: any) => void) | { apply?: (value: any, engine: any) => void, limits?: string | string[] }} [apply]
   * @example engine.settings.define('volfog', true, { limits: 'look.post.volfog.enabled' });   // after look.post.add(volFog)
   */
  define(key, def, apply) {
    const o = typeof apply === 'function' || apply == null ? { apply } : apply;
    const limits = o.limits == null ? null : [].concat(o.limits);
    if (limits) checkLimits(this, key, def, limits);
    this.custom.set(key, { def, apply: o.apply, limits });
    if (!(key in this.values)) this.values[key] = def;
    this._apply(key, this.values[key]);
    return this;
  }
  /** Add a tab */
  addSection(id, def) {
    if (def === undefined) { this._builtin(id); this.win.refresh(); return this; }
    const { title, render, bind, when, order = 100 } = def;
    this.sections.set(id, { title: typeof title === 'function' ? title : () => title, render, bind, when, order });
    this.win.refresh();
    return this;
  }
  removeSection(id) { this.sections.delete(id); if (this.current === id) this.current = null; this.win.refresh(); }

  get isOpen() { return this.win.open; }
  open() { if (!this.win.open) this.win.toggle(true); }
  close() { this.capturing = null; if (this.win.open) this.win.toggle(false); }
  toggle(on = !this.win.open) { on ? this.open() : this.close(); }

  /** Reset all keys to the game's (takes every player rebinding away) */
  resetBindings() {
    const inp = this.engine.input;
    for (const a of Object.keys(inp.rebound())) inp.rebind(a, null);
    this.save();
  }
  /** Replace an action's first key with code (spare keys are kept) */
  rebind(action, code) {
    const inp = this.engine.input, cur = inp.keysOf(action);
    inp.rebind(action, [code, ...cur.slice(1).filter(k => k !== code)]);
    this.save();
  }

  /** Key list (for the UI): [{ action, name, label, keys, conflict }] */
  actionList() {
    const inp = this.engine.input, all = [...inp.actions];
    const groups = {};
    for (const [, v] of all) groups[v.labelKey] = (groups[v.labelKey] || 0) + 1;
    const seen = {}, owner = {};
    for (const [a] of all) for (const k of inp.keysOf(a)) (owner[k] ||= []).push(a);
    // Conflict: one key shared by several actions because the player rebound one of them (the game's own sharing, W walks and moves the cursor, is not)
    const mine = inp.rebound(), isDefault = (a, k) => !mine[a]?.includes(k);
    const conflict = k => owner[k].length > 1 && !owner[k].every(a => isDefault(a, k));
    return all.map(([action, v]) => {
      let name = this.engine.t(v.labelKey);
      if (groups[v.labelKey] > 1) name += ' ' + (seen[v.labelKey] = (seen[v.labelKey] || 0) + 1);
      const keys = inp.keysOf(action);
      return { action, name, label: inp.label(action), keys, conflict: keys.some(conflict) };
    });
  }

  // ---------- storage ----------
  _read() {
    try { const d = JSON.parse(localStorage.getItem(this.storageKey)); return d && typeof d === 'object' ? d : {}; } catch { return {}; }
  }
  save() {
    const bindings = this.engine.input.rebound();   // only the player's changes; restored through input.rebind on the next launch
    const data = { v: 1, values: this.values, bindings, locale: this.engine.i18n.locale };
    this.saved = data;
    try { localStorage.setItem(this.storageKey, JSON.stringify(data)); } catch { return false; }
    this.engine.events.emit('settings:change', this.values);
    return true;
  }

  // ---------- applying ----------
  /**
   * @internal The chunk table that "view distance" and "vegetation density" drive: the terrain's, or vegetation's own over a level / code-built ground; null
   * without either
   */
  chunkHost() { return this.engine.terrain ?? this.engine.vegetation?.host ?? null; }
  _currentValues() {
    const e = this.engine, v = { pixelRatio: +e.renderer.getPixelRatio().toFixed(2), shadows: allowed(e, 'look.shadow.enabled') };
    v.antialias = e.post.antialias;
    for (const k of POST_KEYS) if (e.post.get(k)) v[k] = allowed(e, `look.post.${k}.enabled`);
    if (e.adaptive) v.adaptive = !!e.adaptive.on;
    const H = this.chunkHost();
    if (H) { v.viewChunks = H.viewChunks ?? 4; v.density = H.density ?? 1; }
    for (const [bus, level] of Object.entries(e.audio.levels)) v['vol.' + bus] = level;   // one slider per bus, the game's own buses too
    this.values = v;
    v.quality = this._matchPreset();
    return v;
  }
  _matchPreset() {
    const v = this.values, e = this.engine;
    for (const [name, p] of Object.entries(this.presets)) {
      const ok = Object.entries(p).every(([k, val]) => {
        if ((k === 'viewChunks' || k === 'density') && !this.chunkHost()) return true;
        if (POST_KEYS.includes(k) && !e.post.get(k)) return true;
        return v[k] === val;
      });
      if (ok) return name;
    }
    return 'custom';
  }
  _applyAll() { for (const k in this.values) this._apply(k, this.values[k]); }
  _apply(key, val) { applySetting(this, key, val); }


  // ---------- module hooks ----------
  init() {
    // At start() every module is installed: terrain settings and key bindings can only be applied fully now
    this._ready = true;
    const stored = this.saved.values || {};
    for (const k of ['viewChunks', 'density']) {
      const H = this.chunkHost(); if (!H) continue;
      if (k in stored) this._apply(k, stored[k]); else this.values[k] = H[k];
    }
    for (const [key, c] of this.custom) if (!(key in this.values)) this.values[key] = c.def;
    this.values.quality = this._matchPreset();
  }
  frame() {
    const inp = this.engine.input;
    if (this.capturing) {
      const code = [...inp.justPressed][0];
      // The back key is routed to _cancel by the UI focus stack (cancels rebinding); nothing to do here
      if (code && !inp.keysOf('cancel').includes(code)) { const a = this.capturing; this.capturing = null; this.rebind(a, code); }
      return;
    }
    // When the menu key and the back key are the same (default Esc) the UI focus stack handles it all; with another key: close if open, open when the focus
    // stack is empty
    if (!inp.pressedRaw(this.action) || inp.pressedRaw('cancel')) return;
    if (this.win.open) this.close();
    else if (this.focus.top === null) this.open();
  }
  /** Back key: cancel rebinding if one is in progress, otherwise close the menu */
  _cancel() {
    if (this.capturing) { this.capturing = null; this.win.refresh(); return; }
    this.close();
  }
  /**
   * freezeWorld: gameplay pauses while the menu is open. Pausing has one entry point: with flow installed it switches to flow's 'paused' state (back to the
   * previous state on close),
   * without flow it calls engine.freeze('settings') directly (rendering continues)
   */
  _pause(on) {
    if (!this.freezeWorld) return;
    const e = this.engine, f = e.flow;
    if (!f) { if (on) this._frozen ??= e.freeze('settings'); else { this._frozen?.remove(); this._frozen = null; } return; }
    if (on) { this._flowBefore = f.state; f.go('paused'); }
    else { if (f.state === 'paused' && this._flowBefore) f.go(this._flowBefore); this._flowBefore = null; }
  }

}


const SETTINGS_PARAMS = keysSchema(['action', 'storageKey', 'presets', 'sections', 'freezeWorld']);

/**
 * Settings menu module. Installs engine.settings. Install it after the other modules.
 * @param opts action the action that opens the menu (default the basic 'cancel'; another one the game binds); storageKey storage key; presets override graphics presets;
 * sections which tabs: true (default) graphics, audio, controls, language, saves; a list picks by name, including the optional 'game' (resume, load, back to
 * title) and 'camera' (sensitivity, invert Y, field of view); false for none;
 * freezeWorld pause gameplay while the menu is open (with flow it switches to flow's 'paused', otherwise engine.freeze; rendering continues), default false
 */
export function settings(opts = {}) {
  readParams('settings', SETTINGS_PARAMS, opts);
  let s = null;
  return {
    name: 'settings', type: 'ui', params: SETTINGS_PARAMS, options: opts, label: 'Settings', optional: ['terrain', 'vegetation'], stage: 'effects',
    install(e, ctx) {
      s = new Settings(e, opts, ctx.track);
      ctx.track(e.ui.titleItem('settings', { label: x => x.t('title.settings'), run: () => s.open() }));   // the title screen's Settings button
      return s;
    },
    init() { s.init(); },
    frame() { s.frame(); },
    // the values the player chose (quality preset, volumes, ...) explain a picture or a sound level; open / tab / capturing say the menu holds the input
    describe() { return { open: s.isOpen, tab: s.current, capturing: s.capturing, values: { ...s.values } }; },
  };
}
