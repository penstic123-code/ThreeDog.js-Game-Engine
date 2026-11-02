// Dialogue module: data-driven dialogue (nodes + choices + conditions + callbacks), typewriter effect, confirm key advances, number keys pick choices.
// Typing runs on game time (frame dt accumulation), so engine.step advances it deterministically. Two channels:
//   main (default)  the conversation the player reads: locks game input and joins the UI focus stack (Esc won't open the settings menu; the key press that
//                   opened it does not advance). Its choices take the UI choice cursor (menu keys / d-pad / stick + confirm, ui/Focus.js), number keys and clicks.
//   bubble          lines over their speakers while the player keeps playing, several speakers at once, queued per speaker (dialogueBubbles.js):
//                   say(text, { channel: 'bubble', at: npc.root }) or start(script, 'start', onEnd, { channel: 'bubble', at })
// Drawing is the UI parts 'dialogue' (default: dialogueBox.js) and 'dialogue.bubble'; a game replaces them or turns them off with engine.ui.set (recipes/26-ui-parts.md).
// What a replacement dialogue module must provide: dialogue.contract.js.
//
// dialogue.define('老渔夫', {
//   start: { text: '今天的鱼不太咬钩。', next: 'ask', data: { portrait: 'fisher', mood: 'tired' } },   // data: the game's own fields, handed to the UI part and 'dialogue:line'
//   ask:   { text: '你是来拍照的吧？', choices: [
//            { text: '对，想拍日落', next: 'sunset', if: (state, engine) => true },
//            { text: '随便走走', next: 'end' } ] },
//   sunset:{ text: '去东边的山脊。', do: (state, engine) => engine.vars.setFlag('knowsSunset') },
// });
// dialogue.start('老渔夫');
// The speaker defaults to the script name; set speaker: '另一个人' on a node to switch speakers.
// Advancing and picking a choice are the ops dialogue.advance and dialogue.choose { index } (recipes/23-ops.md): keys, the cursor, clicks, the dev bridge and
// tests all run them, so a choice's do (which may change gameplay state) always runs inside a logged op.
import { uiFocus } from '../../ui/UI.js';
import { warnMissing, warnOnce, renamed } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { dialogueBox } from './dialogueBox.js';
import { codedError } from '../../core/errorHints.js';
import { Bubbles, bubblePart } from './dialogueBubbles.js';
// 'data' is the one slot for game-specific fields: other unknown keys stay typos (a misspelled next would silently end the dialogue)
const NODE_KEYS = ['text', 'next', 'choices', 'do', 'speaker', 'data'], CHOICE_KEYS = ['text', 'next', 'if', 'do', 'data'];
const NONE = Object.freeze([]);
const OWN_FIELDS = ' (put your own fields in data: { ... })';
const CHANNELS = ['main', 'bubble'];
const STR = {
  channel: "dialogue: channel '{got}' is not one of 'main' (the conversation the player reads, locks input) | 'bubble' (a line over its speaker while play goes on)",
  bubbleChoices: "[dialogue] '{name}' node '{id}' has choices: choices need the main channel (the player picks them), so on the bubble channel the script ends there",
};
const checkChannel = c => { if (!CHANNELS.includes(c)) throw codedError('module-params', STR.channel.replace('{got}', c)); };
const SAY_KEYS = ['speaker', 'node', 'channel', 'at', 'seconds', 'queue', 'onCancel'], START_KEYS = ['channel', 'at', 'onCancel'];
// 0.2 lock: false is now channel: 'bubble'; if not caught, old code would silently take the main channel and lock input (the opposite behavior), so name the new form first, then run the generic unknown-key check
const OLD_LINE = renamed('dialogue.say / start options', { lock: "{ channel: 'bubble', at } for a line that does not lock input (main, the default, always locks)" });
const readLine = (fn, keys, o) => readParams(`dialogue.${fn}`, keysSchema(keys), OLD_LINE.check(o) ?? {});

export class Dialogue {
  constructor(engine, { charsPerSecond = 40, advanceActions, choiceKeys = true, holdSeconds = 2 } = {}) {
    this.engine = engine;
    this.scripts = new Map();
    this.state = { get flags() { return engine.vars.flags; } };   // story flags = engine.vars.flags (autosaved)
    this.cps = charsPerSecond;
    // default: confirm, plus interact when the game bound one (interact is not a core key any more, so it is only used if it exists)
    /** @internal */ this._advDefault = advanceActions === undefined;
    this.advanceActions = advanceActions ?? ['confirm', 'interact'];
    this.holdSeconds = holdSeconds;
    this.choiceKeys = choiceKeys;
    this.active = null;
    /** @internal the bubble channel */ this._bubbles = new Bubbles(this);
    // choice keys are read only while the main dialogue runs (game input is locked then), so 1-9 stay free for weapons and hotbars the rest of the time
    if (choiceKeys) for (let i = 1; i <= 9; i++) engine.input.define('choice' + i, ['Digit' + i, 'Numpad' + i], 'dialogue.choice');
  }

  define(speaker, nodes) {
    for (const [id, n] of Object.entries(nodes || {})) {
      readParams(`dialogue '${speaker}' ${id}${OWN_FIELDS}`, keysSchema(NODE_KEYS), n);
      for (const c of n?.choices || []) readParams(`dialogue '${speaker}' ${id} choices${OWN_FIELDS}`, keysSchema(CHOICE_KEYS), c);
    }
    this.scripts.set(speaker, nodes);
  }
  /** Name of the script the main dialogue is playing (null when none). */
  get speaking() { return this.active?.speaker ?? null; }
  /**
   * Say a one-off line (no define needed); the returned Promise resolves when it ends; .stop() ends it now (it resolves too); .id names a main-channel line.
   * say('天快黑了。', { speaker: '老渔夫' }), or pass a node table: say({ start: {...}, ... }).
   * channel: 'bubble' = over at (an Object3D, a position, an actor id; none = a screen line) while the player keeps playing; seconds / queue: dialogueBubbles.js.
   * Ending the playthrough (engine.session) drops the line and leaves the Promise pending: code awaiting it belonged to the old playthrough and never runs.
   */
  say(text, opts) {
    const { speaker = '', node = 'start', channel = 'main', at = null, seconds, queue, onCancel = null } = readLine('say', SAY_KEYS, opts);
    checkChannel(channel);
    if (channel === 'bubble' && typeof text !== 'object') { const p = this._bubbles.say(at, text, { speaker, seconds, queue }); p.id = null; return p; }
    const id = '__say_' + (this._sayId = (this._sayId || 0) + 1);
    this.define(id, typeof text === 'object' ? text : { start: { speaker, text } });
    let stop = () => {};
    const p = /** @type {any} */ (new Promise(res => {
      const done = () => { this.scripts.delete(id); res(); };
      if (channel === 'bubble') { const run = this._playBubbles(id, node, done, { at, seconds, queue }); stop = () => run.stop(); return; }
      this.start(id, node, done, { onCancel });
      stop = () => { if (this.active?.speaker === id) this.end(); };
    }));
    p.id = id; p.stop = () => stop();
    return p;
  }

  /** Lines on the bubble channel now: [{ speaker, text, queued }] */
  bubbles() { return this._bubbles.list(); }

  /** @internal a script on the bubble channel: each node one bubble on at, do runs, next follows; choices belong to the main channel (warned, ended) */
  _playBubbles(name, nodeId, onEnd, { at = null, seconds, queue } = {}) {
    const nodes = this.scripts.get(name);
    let stopped = false, cur = null;
    const finish = () => { if (!stopped) { stopped = true; onEnd?.(); } };
    const step = id => {
      const node = id && id !== 'end' && nodes[id];
      if (!node || stopped) { finish(); return; }
      if (node.choices?.length) { warnOnce(STR.bubbleChoices.replace('{name}', name).replace('{id}', id)); finish(); return; }
      const text = typeof node.text === 'function' ? node.text(this.state, this.engine) : node.text;
      node.do?.(this.state, this.engine);
      cur = this._bubbles.say(at, text, { speaker: node.speaker || (name.startsWith('__say_') ? '' : name), seconds, queue });
      cur.then(() => step(node.next || 'end'));
    };
    step(nodeId);
    return { stop: () => { stopped || cur?.stop(); finish(); } };
  }

  /**
   * Start a script. Main channel (default): onCancel is what the back key (Esc) does while it is on top of the UI focus stack (default: nothing, Esc is
   * swallowed). channel: 'bubble' plays it as bubble lines over at instead (no lock, no choices; a conversation the player reads keeps running).
   */
  start(speaker, nodeId = 'start', onEnd = null, opts) {
    const { channel = 'main', at = null, onCancel = null } = readLine('start', START_KEYS, opts);
    checkChannel(channel);
    const nodes = this.scripts.get(speaker);
    // wrong name: warn with the fix and still call onEnd (so an NPC waiting on it and the say() Promise don't hang)
    if (!nodes) { warnMissing('dialogue', speaker, [...this.scripts.keys()].filter(k => !k.startsWith('__say_'))); onEnd?.(); return; }
    if (channel === 'bubble') { this._playBubbles(speaker, nodeId, onEnd, { at }); return; }
    if (this.active) this.end();   // end a running dialogue normally first (runs its onEnd so NPCs don't hang)
    // join the UI focus stack (Esc swallowed unless onCancel; the choice cursor lives on this entry) and lock game input with an opaque context
    this.active = { speaker, nodes, onEnd, focus: uiFocus(this.engine).push('dialogue', { cancel: onCancel }), ctx: this.engine.input.push('dialogue') };
    this.part = this.engine.ui.get('dialogue');
    this.part?.show();
    this.engine.events.emit('dialogue:start', speaker);
    this._show(nodeId);
  }

  end() {
    const a = this.active;
    this.active = null;
    this.part?.hide();
    a?.focus.remove();
    a?.ctx.remove();
    a?.onEnd?.();
    if (a) this.engine.events.emit('dialogue:end', a.speaker);
  }
  /** @internal session:end: close the dialogue without its onEnd (that callback belongs to the old playthrough: an NPC's busy flag, a say() Promise); drop bubbles */
  _cancel() {
    this._bubbles.clear();
    const a = this.active;
    if (!a) return;
    a.onEnd = null;
    if (a.speaker.startsWith('__say_')) this.scripts.delete(a.speaker);
    this.end();
  }

  _show(id) {
    const a = this.active, node = id && a.nodes[id];
    if (!node && id && id !== 'end') warnMissing('node', id, Object.keys(a.nodes));   // next points at a node that doesn't exist
    if (!node || id === 'end') { this.end(); return; }
    a.node = node; a.id = id;
    a.focus.setNav(null);   // no choices while the new line types
    const text = typeof node.text === 'function' ? node.text(this.state, this.engine) : node.text;
    node.do?.(this.state, this.engine);   // read the line before running effects, so it doesn't see flags just changed
    if (this.active !== a) return;        // do ended the dialogue or started another
    a.who = node.speaker || a.speaker;
    this.full = String(text ?? ''); this.shown = 0; this.typing = true; this._opts = null;
    this.engine.events.emit('dialogue:line', { script: a.speaker, node: id, speaker: a.who, text: this.full, data: node.data ?? {} });
    if (!this.full || !(this.cps > 0)) this._finishTyping();   // charsPerSecond 0 = whole line at once
    else this._draw();
  }

  _finishTyping() {
    this.typing = false;
    this.shown = this.full.length;
    const a = this.active, e = this.engine;
    const opts = (a.node.choices || []).filter(c => !c.if || c.if(this.state, e));
    this._opts = opts.length ? opts : null;
    const label = c => typeof c.text === 'function' ? c.text(this.state, e) : c.text;
    // key: the first bound key only ('1', not '1/Numpad1'), so a rebound choice key shows its new name
    this._choices = opts.map((c, i) => ({ text: label(c), key: this.choiceKeys && i < 9 ? e.input.label('choice' + (i + 1)).split('/')[0] : null, data: c.data ?? {} }));
    // the choice cursor: the menu keys / d-pad / stick move it, confirm picks (the same op as a click or a number key); the part draws view.selected
    if (this._opts) a.focus.setNav({ count: () => this._choices.length, moved: () => this._draw(), confirm: i => e.ops.run('dialogue.choose', { index: i }, { source: 'player' }) });
    this._draw();
  }

  /** @internal hand the current line to the UI part: plain data plus advance() / choose(i), which run the ops */
  _draw() {
    const a = this.active, e = this.engine, P = { source: 'player' };
    const hint = !this.typing && !this._opts ? e.t('dialogue.continue', { key: e.input.label(this.advanceActions[0]) }) : '';
    this.part?.update({
      script: a.speaker, node: a.id, speaker: a.who, text: this.full.slice(0, Math.floor(this.shown)), full: this.full, typing: this.typing,
      choices: this.typing ? NONE : this._choices, selected: this.typing || !this._opts ? -1 : a.focus.index ?? 0, hint, data: a.node.data ?? {},
      advance: () => e.ops.run('dialogue.advance', {}, P), choose: index => e.ops.run('dialogue.choose', { index }, P),
    });
  }

  /** @internal run through the op dialogue.advance */
  _advance() {
    if (!this.active) return;
    if (this.typing) { this._finishTyping(); return; }
    if (this._opts) return;
    this._show(this.active.node.next || 'end');
  }

  /** Choices shown for the current line (typing or not). @internal */
  _visible() { return this._opts ?? (this.active?.node.choices || []).filter(c => !c.if || c.if(this.state, this.engine)); }
  /** @internal run through the op dialogue.choose */
  _choose(i) {
    if (!this.active) return;
    if (this.typing) this._finishTyping();   // mid-typing: finish the sentence (choices appear) before picking
    if (!this._opts?.[i]) return;
    const c = this._opts[i], a = this.active;
    c.do?.(this.state, this.engine);
    if (this.active === a) this._show(c.next || 'end');   // do ended the dialogue or started another: its next belongs to the old one
  }

  /** Per frame: bubbles count down, the main line types, keys are read (the main dialogue locks game input, hence pressedRaw). */
  frame(dt) {
    this._bubbles.frame(dt);
    const a = this.active;
    if (!a) return;
    const ops = this.engine.ops;
    if (this.typing) {
      const was = Math.floor(this.shown);
      this.shown = Math.min(this.full.length, this.shown + dt * this.cps);
      if (this.shown >= this.full.length) this._finishTyping();
      else if (Math.floor(this.shown) !== was) this._draw();   // redraw only when another character shows
    }
    // just opened this frame (the press that opened it does not advance), or the choice cursor already used confirm this frame
    if (a.focus.fresh || a.focus.consumed) return;
    const input = this.engine.input, P = { source: 'player' };
    if (this.advanceActions.some(x => (!this._advDefault || input.actions.has(x)) && input.pressedRaw(x))) ops.run('dialogue.advance', {}, P);
    if (this.choiceKeys) for (let i = 1; i <= 9; i++) if (input.pressedRaw('choice' + i) && this.active && this._visible()[i - 1]) ops.run('dialogue.choose', { index: i - 1 }, P);
  }
}

const STRINGS = {
  'zh-CN': { 'dialogue.continue': '{key} 继续 ▸', 'dialogue.choice': '选择选项' },
  en: { 'dialogue.continue': '{key} to continue ▸', 'dialogue.choice': 'Choose option' },
};

const DIALOGUE_PARAMS = keysSchema(['charsPerSecond', 'advanceActions', 'choiceKeys', 'holdSeconds']);

/** Dialogue module. Installs engine.dialogue; story flags engine.dialogue.state.flags are engine.vars.flags. Declares the UI parts 'dialogue' and 'dialogue.bubble'. */
export function dialogue(opts = {}) {
  readParams('dialogue', DIALOGUE_PARAMS, opts);
  let d = null;
  return {
    name: 'dialogue', params: DIALOGUE_PARAMS, options: opts, label: 'Dialogue', stage: 'gameplay', after: ['interactions'],
    install(e) {
      e.i18n.add(STRINGS);
      d = new Dialogue(e, opts);
      e.events.on('session:end', () => d._cancel());   // per-playthrough state (recipes/14-custom-module.md "Per-playthrough state")
      e.ui.define('dialogue', dialogueBox);
      e.ui.define('dialogue.bubble', bubblePart, { multi: true });
      e.ops.define('dialogue.advance', {
        desc: 'Finish typing the line, or go on to the next one',
        net: 'local',   // in co-op each player reads their own dialogue box; ops it runs (give, start a quest) still go to the host
        can: () => d.active ? true : 'noDialogue',
        run: () => { d._advance(); },
        offers: () => d.active && !d._opts ? [{}] : [],
      });
      e.ops.define('dialogue.choose', {
        desc: 'Pick a visible dialogue choice (0-based)', args: { index: 'int' },
        net: 'local',
        can: (e, { index }) => !d.active ? 'noDialogue' : d._visible()[index] ? true : 'noChoice',
        run: (e, { index }) => { d._choose(index); },
        offers: () => d.active ? d._visible().map((c, index) => ({ index })) : [],
      });
      return d;
    },
    frame(dt) { d.frame(dt); },
    describe(e, ctx) {
      const a = d.active, bubbles = d.bubbles();
      if (!a && !bubbles.length) return;
      const label = c => (typeof c.text === 'function' ? c.text(d.state, e) : c.text);
      if (ctx.out.ui) {
        if (a) ctx.out.ui.dialogue = { speaker: a.who, text: d.full, typing: d.typing, choices: (d._opts || []).map(label), selected: d._opts ? a.focus.index ?? 0 : -1 };
        if (bubbles.length) ctx.out.ui.bubbles = bubbles;
      }
    },
  };
}
