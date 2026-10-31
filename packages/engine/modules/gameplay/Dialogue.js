// Dialogue module: data-driven dialogue (nodes + choices + conditions + callbacks), typewriter effect, confirm key advances, number keys pick choices.
// Typing runs on game time (frame dt accumulation), so engine.step advances it deterministically. A normal dialogue locks game input and joins the UI focus stack
// (Esc won't open the settings menu; the key press that opened it does not advance). say(text, { lock: false }) is a line spoken while the player keeps playing:
// no lock, keys stay with the game, the line moves on by itself holdSeconds after it is typed.
// Drawing is the UI part 'dialogue' (default: dialogueBox.js); a game replaces it or turns it off with engine.ui.set('dialogue', ...) (recipes/26-ui-parts.md).
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
// Advancing and picking a choice are the ops dialogue.advance and dialogue.choose { index } (recipes/23-ops.md): keys, clicks, the dev bridge and tests
// all run them, so a choice's do (which may change gameplay state) always runs inside a logged op.
import { uiFocus } from '../../ui/UI.js';
import { checkOptions, warnMissing } from '../../core/validate.js';
import { dialogueBox } from './dialogueBox.js';
// 'data' is the one slot for game-specific fields: other unknown keys stay typos (a misspelled next would silently end the dialogue)
const NODE_KEYS = ['text', 'next', 'choices', 'do', 'speaker', 'data'], CHOICE_KEYS = ['text', 'next', 'if', 'do', 'data'];
const NONE = Object.freeze([]);
const OWN_FIELDS = ' (put your own fields in data: { ... })';

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
    // choice keys are read only while a locking dialogue runs (game input is locked then), so 1-9 stay free for weapons and hotbars the rest of the time
    if (choiceKeys) for (let i = 1; i <= 9; i++) engine.input.define('choice' + i, ['Digit' + i, 'Numpad' + i], 'dialogue.choice');
  }

  define(speaker, nodes) {
    for (const [id, n] of Object.entries(nodes || {})) {
      checkOptions(`dialogue '${speaker}' ${id}${OWN_FIELDS}`, n, NODE_KEYS);
      for (const c of n?.choices || []) checkOptions(`dialogue '${speaker}' ${id} choices${OWN_FIELDS}`, c, CHOICE_KEYS);
    }
    this.scripts.set(speaker, nodes);
  }
  /** Name of the script currently speaking (null when no dialogue). */
  get speaking() { return this.active?.speaker ?? null; }
  /**
   * Say a one-off line (no define needed); the returned Promise resolves when it ends.
   * say('天快黑了。', { speaker: '老渔夫' }), or pass a node table: say({ start: {...}, ... }). lock: false = spoken while the player keeps playing. The returned .id is the name of this one-off dialogue.
   * Ending the playthrough (engine.session) drops the line and leaves the Promise pending: code awaiting it belonged to the old playthrough and never runs.
   */
  say(text, { speaker = '', node = 'start', lock = true, onCancel = null } = {}) {
    const id = '__say_' + (this._sayId = (this._sayId || 0) + 1);
    this.define(id, typeof text === 'object' ? text : { start: { speaker, text } });
    const p = new Promise(res => this.start(id, node, () => { this.scripts.delete(id); res(); }, { lock, onCancel }));
    p.id = id;
    return p;
  }

  /** onCancel: what the back key (Esc) does while this locking dialogue is the top of the UI focus stack (default: nothing, Esc is swallowed) */
  start(speaker, nodeId = 'start', onEnd = null, { lock = true, onCancel = null } = {}) {
    const nodes = this.scripts.get(speaker);
    // wrong name: warn with the fix and still call onEnd (so an NPC waiting on it and the say() Promise don't hang)
    if (!nodes) { warnMissing('dialogue', speaker, [...this.scripts.keys()].filter(k => !k.startsWith('__say_'))); onEnd?.(); return; }
    if (!lock && this.active?.lock) { onEnd?.(); return; }   // a passing line never cuts into a conversation the player is reading
    if (this.active) this.end();   // end a running dialogue normally first (runs its onEnd so NPCs don't hang)
    this.active = { speaker, nodes, onEnd, lock, focus: lock ? uiFocus(this.engine).push('dialogue', { cancel: onCancel }) : null, ctx: lock ? this.engine.input.push('dialogue') : null };   // locking: join the UI focus stack, Esc is swallowed
    this.part = this.engine.ui.get('dialogue');
    this.part?.show();
    this.engine.events.emit('dialogue:start', speaker);
    this._show(nodeId);
  }

  end() {
    const a = this.active;
    this.active = null;
    this.part?.hide();
    a?.focus?.remove();
    a?.ctx?.remove();
    a?.onEnd?.();
    if (a) this.engine.events.emit('dialogue:end', a.speaker);
  }
  /** @internal session:end: close the dialogue without its onEnd (that callback belongs to the old playthrough: an NPC's busy flag, a say() Promise) */
  _cancel() {
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
    const text = typeof node.text === 'function' ? node.text(this.state, this.engine) : node.text;
    node.do?.(this.state, this.engine);   // read the line before running effects, so it doesn't see flags just changed
    if (this.active !== a) return;        // do ended the dialogue or started another
    a.who = node.speaker || a.speaker;
    this.full = String(text ?? ''); this.shown = 0; this.typing = true; this._opts = null; this._hold = 0;
    this.engine.events.emit('dialogue:line', { script: a.speaker, node: id, speaker: a.who, text: this.full, data: node.data ?? {} });
    if (!this.full || !(this.cps > 0)) this._finishTyping();   // charsPerSecond 0 = whole line at once
    else this._draw();
  }

  _finishTyping() {
    this.typing = false;
    this.shown = this.full.length;
    const opts = (this.active.node.choices || []).filter(c => !c.if || c.if(this.state, this.engine));
    this._opts = opts.length ? opts : null;
    const label = c => typeof c.text === 'function' ? c.text(this.state, this.engine) : c.text;
    const keys = this.choiceKeys && this.active.lock;
    // key: the first bound key only ('1', not '1/Numpad1'), so a rebound choice key shows its new name
    this._choices = opts.map((c, i) => ({ text: label(c), key: keys && i < 9 ? this.engine.input.label('choice' + (i + 1)).split('/')[0] : null, data: c.data ?? {} }));
    this._draw();
  }

  /** @internal hand the current line to the UI part: plain data plus advance() / choose(i), which run the ops */
  _draw() {
    const a = this.active, e = this.engine, P = { source: 'player' };
    const hint = !this.typing && !this._opts && a.lock ? e.t('dialogue.continue', { key: e.input.label(this.advanceActions[0]) }) : '';
    this.part?.update({
      script: a.speaker, node: a.id, speaker: a.who, text: this.full.slice(0, Math.floor(this.shown)), full: this.full, typing: this.typing,
      choices: this.typing ? NONE : this._choices, hint, data: a.node.data ?? {}, lock: a.lock,
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

  /** Per frame: advance typing, read keys (a locking dialogue locks game input, hence pressedRaw). */
  frame(dt) {
    const a = this.active;
    if (!a) return;
    const ops = this.engine.ops;
    if (this.typing) {
      const was = Math.floor(this.shown);
      this.shown = Math.min(this.full.length, this.shown + dt * this.cps);
      if (this.shown >= this.full.length) this._finishTyping();
      else if (Math.floor(this.shown) !== was) this._draw();   // redraw only when another character shows
    }
    if (!a.lock) {   // keys belong to the game: the line moves on by itself (choices wait for a click or the op)
      if (!this.typing && !this._opts && (this._hold += dt) >= this.holdSeconds) ops.run('dialogue.advance', {}, { source: 'game' });
      return;
    }
    if (a.focus.fresh) return;   // just opened this frame: the key press that opened it (E) does not advance
    const input = this.engine.input, P = { source: 'player' };
    if (this.advanceActions.some(x => (!this._advDefault || input.actions.has(x)) && input.pressedRaw(x))) ops.run('dialogue.advance', {}, P);
    if (this.choiceKeys) for (let i = 1; i <= 9; i++) if (input.pressedRaw('choice' + i) && this.active && this._visible()[i - 1]) ops.run('dialogue.choose', { index: i - 1 }, P);
  }
}

const STRINGS = {
  'zh-CN': { 'dialogue.continue': '{key} 继续 ▸', 'dialogue.choice': '选择选项' },
  en: { 'dialogue.continue': '{key} to continue ▸', 'dialogue.choice': 'Choose option' },
};

/** Dialogue module. Installs engine.dialogue; story flags engine.dialogue.state.flags are engine.vars.flags. Declares the UI part 'dialogue'. */
export function dialogue(opts = {}) {
  let d = null;
  return {
    name: 'dialogue', label: 'Dialogue', stage: 'gameplay', after: ['interactions'],
    install(e) {
      e.i18n.add(STRINGS);
      checkOptions('dialogue()', opts, ['charsPerSecond', 'advanceActions', 'choiceKeys', 'holdSeconds']);
      d = new Dialogue(e, opts);
      e.events.on('session:end', () => d._cancel());   // per-playthrough state (recipes/14-custom-module.md "Per-playthrough state")
      e.ui.define('dialogue', dialogueBox);
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
      const a = d.active;
      if (!a) return;
      const label = c => (typeof c.text === 'function' ? c.text(d.state, e) : c.text);
      ctx.out.ui.dialogue = { speaker: a.who, text: d.full, typing: d.typing, choices: (d._opts || []).map(label), lock: a.lock };
    },
  };
}
