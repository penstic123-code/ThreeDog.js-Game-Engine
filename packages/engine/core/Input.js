// Input: read by "action", not by "key". Games and modules ask "did the player press interact", not "did they press E".
// Why: keys can be rebound in settings, and on-screen key hints follow automatically.
//
// engine.input.define('jump', ['Space'], 'Jump'); // a module/game registers its own action. Redefining: the later one overrides keys and label (warns once in
// dev); keys the player rebound are kept
// engine.input.define('inventory', ['KeyI'], 'inv.open', { pad: 'PadY' }) // the module that registers an action supplies its default gamepad key (or write
// 'PadY' straight into the key array)
// engine.input.down('run')      held
// engine.input.pressed('jump')  just pressed; engine.input.released('jump') just released
// Gameplay (onFixed, module fixed) reads a snapshot taken at the start of each fixed step: reads within one step agree, and "just pressed" counts exactly once,
// never lost, whatever the frame rate.
// UI keys and camera (onFrame, module frame) read this frame's latest state. Gameplay keys (jump, attack, fire, interact) are always read in fixed
// Contexts: engine.input.push('vehicle') groups/shadows actions (inputContext.js); menus, dialogue and cutscenes push an opaque one. Window blur / tab hide
// (page:blur from core/page.js) releases every held key
// engine.input.label('interact') -> "E" (for UI hints; 'interact' exists only once the game bound it)
// engine.input.rebind('interact', ['KeyF']) rebind a key (this session only; with the settings module installed it saves to the browser and restores next time)
// engine.input.axis -> { x, y }  movement direction (moveLeft/Right/Forward/Back + mobile stick)
//
// Mouse buttons are keys too: 'Mouse0' left / 'Mouse1' middle / 'Mouse2' right (real mouse only; touch taps do not count). Bind them in actions and read in
// fixed steps, independent of frame rate:
//   engine.input.define('attack', ['KeyJ', 'Mouse0'], 'Attack');  engine.onFixed(() => { if (engine.input.pressed('attack')) … });
// input.pointer = { x, y, ndcX, ndcY, down, clicked } (x / y pixels and ndc -1..1 relative to the canvas box, not the window): for UI and ground picking
// (click-to-move via screenToGround); clicked is true only on this frame and a drag does not count,
//   gameplay (fire, attack) must not read it; bind a Mouse0 action instead

/** @import { Pointer, Autopilot } from '../types/core' */
import { coded, codedError } from './errorHints.js';
import { warnMissing, warnOnce, missingText } from './validate.js';
import { touchButton } from './inputTouch.js';
import { bindPointer } from './inputPointer.js';
import { pollPad, keyLabel } from './inputPad.js';
import { DEFAULT_ACTIONS, BOUND_LABELS, PAD_DEFAULTS, fmtRedefine } from './inputDefaults.js';
import { initContexts, pushContext, readableMap, applyContexts } from './inputContext.js';


/** Input: read by "action", not by "key". Key names are the browser's KeyboardEvent.code, e.g. 'KeyE', 'Space', 'ShiftLeft'; gamepad keys are 'PadA' etc. */
export class Input {
  /** @internal */
  constructor(engine, canvas, { joystick = 'auto', bindings = {}, padBindings = {}, padDeadzone = 0.18, padLookSpeed = 9 } = {}) {
    /** @internal */ this.engine = engine;
    /** @internal */ this.canvas = canvas;
    /** @internal */ this.keys = new Set();
    /** @internal */ this.justPressed = new Set();    // pressed / released this frame (read in frame, cleared by endFrame)
    /** @internal */ this.justReleased = new Set();
    /** @internal */ this._accP = new Set();          // pressed / released since the last snapshot (accumulated until the start of the next fixed step)
    /** @internal */ this._accR = new Set();
    /** @internal */ this._fx = { keys: new Set(), pressed: new Set(), released: new Set(), x: 0, y: 0 };   // this fixed step's snapshot
    /** @internal */ this._live = { keys: this.keys, pressed: this.justPressed, released: this.justReleased };
    /** @internal */ this._inFixed = false;
    /** This frame's look-drag amount (pixels) and wheel notches */
    this.look = { dx: 0, dy: 0, zoom: 0 };
    /** Mouse/touch pointer @type {Pointer} */
    this.pointer = { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, clicked: false, button: 0 };
    /** Set by a camera that locks the mouse on click: true while the next mouse press would only lock it, so that press is not delivered as Mouse0 / a click @internal */
    this.swallowLockClick = /** @type {null | (() => boolean)} */ (null);
    /** On-screen stick (touch) */
    this.stick = { x: 0, y: 0 };
    /** Auto movement (stress tests, test scripts) @type {Autopilot | null} */
    this.autopilot = null;
    /** action name -> { keys = key list, labelKey = string-table key } @type {Map<string, { keys: string[], labelKey: string }>} */
    this.actions = new Map();
    initContexts(this);
    /** @internal */ this.padDefaults = { ...PAD_DEFAULTS, ...padBindings };
    /** @internal */ this.padDeadzone = padDeadzone;
    /** @internal */ this.padLookSpeed = padLookSpeed;
    /** @internal */ this.padStick = { x: 0, y: 0 };
    /** Most recently used device: UI key hints follow it @type {'keyboard' | 'pad' | 'touch'} */
    this.lastDevice = 'keyboard';
    /** Is this a touch device? */
    this.touch = matchMedia('(pointer: coarse)').matches;
    /** @internal touch buttons the game asked for [{ action, labelKey }]; drawn by the UI part 'touch' (inputTouch.js) */ this._touch = [];
    for (const [a, [keys, label]] of Object.entries(DEFAULT_ACTIONS)) this.actions.set(a, { keys: this._withPad(a, bindings[a] || keys), labelKey: label });
    // bindings may also name actions outside the neutral table (createEngine({ bindings: { interact: ['KeyF'] } })): they exist from the start, and a module's
    // later define() keeps the game's keys (the game chose them; the module's keys are only its fallback)
    /** @internal */ this._bound = bindings;
    for (const [a, keys] of Object.entries(bindings)) if (!DEFAULT_ACTIONS[a]) this.actions.set(a, { keys: this._withPad(a, [].concat(keys)), labelKey: BOUND_LABELS[a] || a });

    const { signal } = engine;   // engine.dispose() cancels all listeners at once
    addEventListener('keydown', e => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this._keyDown(e.code, 'keyboard');
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    }, { signal });
    addEventListener('keyup', e => this._keyUp(e.code), { signal });
    // Losing focus swallows the keyup events, so release everything when the page goes away (window blur or tab hidden; core/page.js owns those listeners)
    engine.events.on('page:blur', () => { for (const k of [...this.keys]) this._keyUp(k); });

    bindPointer(this, canvas, signal);

    /** @internal */ this.joystick = joystick;
  }

  // ---------- actions ----------
  /**
   * Register an action. keys is a key name or array (gamepad keys such as 'PadY' can go in directly); labelKey is the display name (a string-table key or
   * text).
   * opts.pad: the default gamepad key for this action (gameplay-specific actions get it from the registering module; createEngine({ padBindings }) takes
   * precedence).
   * If the action exists, the later definition overrides (warns once in dev when the keys differ); keys the player rebound in settings are kept
   * @param {string} action
   * @param {string | string[]} keys
   * @param {string} [labelKey]
   * opts.context: the input context the action belongs to (default 'gameplay'); it is readable only while that context is on the stack and not shadowed, see
   * push().
   * @param {{ pad?: string | string[], context?: string }} [opts]
   * @returns {this}
   * @example engine.input.define('openMap', 'KeyM', 'input.openMap', { pad: 'PadY' });
   * @example engine.input.define('brake', 'KeyB', 'Brake', { context: 'vehicle' });   // only readable while input.push('vehicle') is on the stack
   * @example engine.input.define('attack', ['KeyJ', 'Mouse0'], 'Attack');   // mouse buttons can be bound too: Mouse0 left / Mouse1 middle / Mouse2 right
  */
  define(action, keys, labelKey, opts = {}) {
    const { pad, context } = opts;
    this._readable = null;
    keys = [].concat(this._bound[action] ?? keys);   // createEngine({ bindings }) wins over the keys a module passes
    // a createEngine({ padBindings }) entry takes precedence
    if (pad && !this.padDefaults[action]) keys = [...keys, ...[].concat(pad).filter(p => !keys.includes(p))];
    const cur = this.actions.get(action), want = this._withPad(action, keys);
    if (!cur) { this.actions.set(action, { keys: want, labelKey: labelKey || action, custom: false, defined: true, context }); return this; }
    if (labelKey) cur.labelKey = labelKey;
    if (context) cur.context = context;
    if (cur.custom) return this;
    const same = want.length === cur.keys.filter(k => !k.startsWith('Touch:')).length && want.every(k => cur.keys.includes(k));
    if (!same) {
      if (cur.defined) warnOnce(coded('input-binding', fmtRedefine(action, cur.keys, want)));
      cur.keys = [...want, ...cur.keys.filter(k => k.startsWith('Touch:'))];   // keep the touch button keys
    }
    cur.defined = true;
    return this;
  }
  /** @internal */
  _withPad(action, keys) { const p = this.padDefaults[action]; return p && !keys.includes(p) ? [...keys, p] : keys; }

  /**
   * Touch button (appears only on touch devices); pressing it triggers the action. labelKey is the string-table key of the button text (updates when the
   * language changes) @param {string} action @param {string} labelKey
   */
  touchButton(action, labelKey) { touchButton(this, action, labelKey); }

  /**
   * Press (down true) or release an action from code, through the same path as a real key: tests, AI drivers, replays. Presses the action's first bound key
   * and holds it until simulate(action, false), so the player walks like with a held key. Takes action names (moveForward, moveLeft, run, interact, ...;
   * engine.input.actions lists them), not keys; an unknown name throws unknown-name with the closest one
   * @param {string} action @param {boolean} [down]
   * @example engine.input.simulate('moveForward'); engine.step(1); engine.input.simulate('moveForward', false)
   */
  simulate(action, down = true) {
    // throws (reading only warns): a driver pressing a wrong name would otherwise "succeed" with nothing moving, and a script rarely shows warnings
    if (!this.actions.has(action)) throw codedError('unknown-name', `engine.input.simulate('${action}'): ${missingText('action', action, [...this.actions.keys()])}`);
    const k = this.keysOf(action)[0]; if (k) { if (down) this._keyDown(k, this.lastDevice); else this._keyUp(k); }
  }
  _keyDown(code, device) {
    if (this.keys.has(code) || this._muted.has(code)) return;
    this.keys.add(code); this.justPressed.add(code); this._accP.add(code); this.lastDevice = device;
  }
  /** @internal */
  _keyUp(code) { this._muted.delete(code); if (this.keys.delete(code)) { this.justReleased.add(code); this._accR.add(code); } }
  /** @internal Called at the start of each frame: read the gamepad (runs every frame, allocates nothing) */
  poll(dt) { pollPad(this, dt); }
  /** Rebind a key @param {string} action @param {string | string[]} keys */
  rebind(action, keys) {
    const a = this.actions.get(action); if (!a) return;
    a.keys = [].concat(keys); a.custom = true; this._readable = null;
    this.engine.events.emit('input:rebind', { action, keys: a.keys });
  }
  /** All keys bound to an action @param {string} action @returns {string[]} */
  keysOf(action) { return this.actions.get(action)?.keys || []; }
  // Reading an unregistered action: most likely a misspelled name
  /** @internal */
  _known(action) { if (!this.actions.has(action)) warnMissing('action', action, [...this.actions.keys()]); }
  /** Key name shown in the UI, e.g. "E" @param {string} action @returns {string} */
  label(action) { return keyLabel(this, action); }
  /** Which copy to read: the snapshot inside fixed steps, this frame's latest state elsewhere @internal */
  _has(action, set) { this._known(action); if (!readableMap(this).get(action) || this._gated(action)) return false; const S = (this._inFixed ? this._fx : this._live)[set]; return this.keysOf(action).some(k => S.has(k)); }
  /** Held (a snapshot of this step in fixed, the latest state in frame) @param {string} action @returns {boolean} */
  down(action) { return this._has(action, 'keys'); }
  /**
   * Just pressed. Read in onFixed / module fixed: pressed since the previous fixed step, true only for this step (counted once however the frame rate varies,
   * never lost);
   * read in onFrame / module frame: pressed this frame (UI keys only). Read gameplay keys in fixed
   * @param {string} action @returns {boolean}
   * @example engine.onFixed(() => { if (engine.input.pressed('jump')) player.jump(); });
  */
  pressed(action) { return this._has(action, 'pressed'); }
  /**
   * Just released (which copy is read is the same as pressed; for things like release-to-fire after charging) @param {string} action @returns {boolean}
   * @example if (engine.input.released('fire')) shoot(charge);
   */
  released(action) { return this._has(action, 'released'); }
  /**
   * Just pressed, ignoring input contexts (for menus and dialogue themselves, which run while a context blocks the game) @param {string} action @returns
   * {boolean}
   */
  pressedRaw(action) { this._known(action); const S = (this._inFixed ? this._fx : this._live).pressed; return this.keysOf(action).some(k => S.has(k)); }

  /**
   * Push an input context (an action group, like a Unity Action Map). The top context shadows lower actions bound to the same key.
   * Opaque by default (nothing below is readable: menus, dialogue, cutscenes); { pass: true } lets unrelated lower actions keep working (vehicle, build mode).
   * Applies at the start of the next fixed step; actions it blocks lose their held state (no stuck keys after a menu closes). Join a context with define(..., {
   * context }); menu keys: pressedRaw.
   * @param {string} name e.g. 'vehicle', 'menu', 'build' (the base context is 'gameplay')
   * owner (default the name) is who pushed it, listed in describe().holds.input
   * @param {{ pass?: boolean, owner?: string }} [opts]
   * @returns {{ name: string, remove(): void }} remove() pops it (safe to call twice)
   * @example const h = engine.input.push('vehicle', { pass: true });   // vehicle-context actions (brake) work, and shadow gameplay actions on the same key
   *   h.remove();
   */
  push(name, opts) { return pushContext(this, name, opts); }
  /** Names of the active contexts, bottom to top (pending switches apply at the next fixed step) @returns {string[]} */
  get contexts() { return this._stack.map(c => c.name); }
  /**
   * Who holds input, bottom to top above the base context: [{ context, owner, pass }] (pass: unrelated gameplay actions still read)
   * @returns {{ context: string, owner: string, pass: boolean }[]}
   */
  get holders() { return this._stack.slice(1).map(c => ({ context: c.name, owner: c.owner, pass: c.pass })); }
  /**
   * Close one action while anyone holds its gate (stun: no jump; a tutorial: no attack yet), without a whole input context. Same rules as every
   * engine.mod stack (it is the stack 'input.gate', one entry per owner and action): only the owner opens it, { for } ends it by itself.
   * A closed action reads as not down / pressed / released; describe().holds.gates lists the owners.
   * @param {string} action @param {string | { owner?: string, for?: number, clock?: string }} [owner] default 'game'
   * @returns {{ owner: string, remove(): void }}
   * @example const stun = engine.input.gate('jump', { owner: 'stun', for: 1.5 });   // no jumping for 1.5 s; stun.remove() reopens it early
   */
  gate(action, owner = 'game') {
    this._known(action);
    const o = typeof owner === 'string' ? { owner } : owner;
    return this.engine.mod('input.gate', { ...o, id: action });
  }
  /** @internal true while someone holds this action's gate */
  _gated(action) { const g = this._gateStack ??= this.engine.stacks?.has('input.gate') ? this.engine.stacks.get('input.gate') : null; return !!g && g.size(action) > 0; }
  /**
   * False while an opaque context (menu, dialogue, cutscene...) covers gameplay: no game action can be read, and cameras ignore look/zoom @returns {boolean}
   */
  get enabled() { return this._stack.every(c => c.pass); }

  /**
   * Movement direction: x positive right, y positive forward, length <= 1 (a snapshot of this step in fixed, the latest state in frame) @returns {{ x: number,
   * y: number }}
   */
  get axis() {
    if (!this.enabled) return { x: 0, y: 0 };
    if (this._inFixed) return { x: this._fx.x, y: this._fx.y };
    return this._axisInto({ x: 0, y: 0 });
  }
  /** @internal Write the live movement axis into out (beginFixed reuses its snapshot object: no allocation per step) */
  _axisInto(out) {
    out.x = out.y = 0;
    if (!this.enabled) return out;
    let x = this.stick.x + this.padStick.x, y = this.stick.y + this.padStick.y;
    if (this.down('moveForward')) y += 1;
    if (this.down('moveBack')) y -= 1;
    if (this.down('moveLeft')) x -= 1;
    if (this.down('moveRight')) x += 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    out.x = x; out.y = y;
    return out;
  }
  /** Take the snapshot at the start of a fixed step (also while frozen, so keys pressed during a freeze do not take effect only after unfreezing) @internal */
  beginFixed() {
    applyContexts(this);
    const f = this._fx;
    f.keys.clear(); for (const k of this.keys) f.keys.add(k);
    let t = f.pressed; f.pressed = this._accP; this._accP = t; t.clear();   // swap the two copies, no allocation
    t = f.released; f.released = this._accR; this._accR = t; t.clear();
    this._axisInto(f);
    this._inFixed = true;
  }
  /** @internal */
  endFixed() { this._inFixed = false; }


  /** @internal */
  endFrame() { this.justPressed.clear(); this.justReleased.clear(); this.look.dx = this.look.dy = this.look.zoom = 0; this.pointer.clicked = false; }
}
