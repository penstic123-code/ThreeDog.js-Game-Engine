// Quests module: made of steps, each with a completion condition (function), checked every half second (game time, in the fixed step; not checked while frozen/paused). Press J by default to open the quest log.
//
// quests.define('first-photo', {
//   title: '第一张照片', desc: '…',
//   steps: [
//     { text: '和老渔夫聊聊', done: e => e.vars.flag('metFisher'), target: npc.root },   // target: auto-marked when the hud module is present
//     { id: 'sunset', text: '在傍晚拍一张照片', done: e => e.vars.counter('sunsetPhotos') >= 1 },   // id: the save's name for this step
//   ],
//   reward: e => e.inventory.add('film', 3),
// });
// quests.start('first-photo');
// A step can be parallel goals { text?, all: [{ text, done, target, optional }] } (done when every non-optional part is done, in any order);
// a quest can fail: fail: e => bool is checked while it is active, then onFail runs, quest:fail fires, and start(id) may begin it again.
// Saves name steps and parts by id (step / part id: 'mayor'), else by position; give them ids once the game ships, so inserting a step later
// does not move players to another step. Save shape (version 2): { state: { questId: { step?: stepId, done?, failed?, parts?: [partId met], got?: { stepId: [partId] } } } }.
// The log window is the UI part 'questLog' (questLog.js): replace it or turn it off with engine.ui.set('questLog', ...) (recipes/26-ui-parts.md).
import { toast, toggleOnKey } from '../../ui/UI.js';
import { questLogWindow } from './questLog.js';
import { checkOptions, warnMissing, DEV } from '../../core/validate.js';
import { codedError } from '../../core/errorHints.js';
import { toSaved, fromSaved, migrateV1, stepId } from './questSave.js';

const STRINGS = {
  'zh-CN': { 'quests.title': '任务日志', 'quests.action': '任务', 'quests.empty': '还没有任务。', 'quests.new': '新任务：{title}', 'quests.done': '任务完成：{title}', 'quests.doneTag': '（已完成）', 'quests.failed': '任务失败：{title}' },
  en: { 'quests.title': 'Journal', 'quests.action': 'Journal', 'quests.empty': 'No quests yet.', 'quests.new': 'New quest: {title}', 'quests.done': 'Quest complete: {title}', 'quests.doneTag': ' (done)', 'quests.failed': 'Quest failed: {title}' },
};

/** A step's text; a parallel step without its own text lists its required parts */
const stepText = st => st.text ?? st.all.filter(p => !p.optional).map(p => p.text).join(' / ');
export class Quests {
  constructor(engine, { action = 'quests', keys = ['KeyJ'], pad = ['PadSelect'], checkInterval = 0.5, notify = true } = {}) {
    this.engine = engine;
    this.defs = new Map();
    this.state = {};       // id -> { step, done, failed?, parts? (parts done in the current parallel step), got? (parts met in finished parallel steps) }
    /** @internal saved progress of quests not defined yet (content loaded after the save): applied by define(), written back unchanged meanwhile */ this._saved = {};
    this._t = 0;
    this.action = action; this.checkInterval = checkInterval;
    this.notify = notify;   // true toast (kind 'quest') · false silent · function ({ type, id, text }) => void
    engine.i18n.add(STRINGS);
    engine.input.define(action, keys, 'quests.action', { pad });
    this.win = questLogWindow(engine, this);   // { open, toggle, refresh } over engine.ui
    // counters live in engine.vars
    // saved by stable step ids (questSave.js); version 1 saved positions
    engine.saves.register('quests', { version: 2, migrate: { 1: d => migrateV1(this.defs, d) }, save: () => this._save(), load: d => this._load(d) });
  }

  /**
   * Define a quest. A step is { id?, text, done, target } or parallel goals { id?, text?, all: [{ id?, text, done, target, optional }] }.
   * id: a stable name for the step (saves store progress by it, so steps can be inserted or reordered later); default its position.
   * fail: checked while active; true fails the quest (onFail runs, quest:fail fires; start(id) can begin it again).
   * @example quests.define('defend', { title: '守住营地', steps: [
   *   { text: '到营地', done: e => e.vars.flag('atCamp') },
   *   { all: [{ text: '守住 A 点', done: e => e.vars.flag('heldA') }, { text: '守住 B 点', done: e => e.vars.flag('heldB') },
   *           { text: '没人受伤', done: e => e.vars.flag('noHurt'), optional: true }] },
   * ], fail: e => e.vars.flag('campLost'), onFail: e => e.vars.setFlag('mayRetry') });
   * @param {string} id
   * @param {any} def
   */
  define(id, def) {
    const at = `quests.define('${id}')`;
    checkOptions(at, def, ['title', 'desc', 'steps', 'reward', 'fail', 'onFail']);
    for (const s of def.steps || []) {
      if (!s.all && (typeof s.done !== 'function' || s.optional !== undefined)) throw codedError('quest-step', `${at}: a step needs done (a function), or all: [parts] for parallel goals; optional goes on a part inside all`);
      checkOptions(`${at} steps`, s, s.all ? ['id', 'text', 'all'] : ['id', 'text', 'done', 'target']);
      for (const p of s.all || []) checkOptions(`${at} parallel part`, p, ['id', 'text', 'done', 'target', 'optional']);
      if (s.all && !s.all.some(p => !p.optional)) throw codedError('quest-step', `${at}: a parallel step needs at least one part without optional: true, or it would finish at once`);
    }
    const ids = (def.steps || []).map((_, i) => stepId(def, i)), dup = ids.find((x, i) => ids.indexOf(x) !== i);
    if (dup != null) throw codedError('quest-step', `${at}: two steps have the id '${dup}'; step ids must be unique (saves find a step by it)`);
    this.defs.set(id, def);
    if (id in this._saved) { this.state[id] = fromSaved(id, def, this._saved[id]); delete this._saved[id]; this.win.refresh(); }
    return this;
  }
  /** @internal save part data: progress by step ids, plus saved quests not defined yet */
  _save() {
    const state = { ...this._saved };
    for (const [id, s] of Object.entries(this.state)) { const d = this.defs.get(id); if (d) state[id] = toSaved(d, s); }
    return { state };
  }
  /** @internal */
  _load(d) {
    this.state = {}; this._saved = {};
    for (const [id, q] of Object.entries(d?.state || {})) { const def = this.defs.get(id); if (def) this.state[id] = fromSaved(id, def, q); else this._saved[id] = q; }
    this.win.refresh();
  }
  /** Quest list (for custom UI): unfinished first. A parallel step has parts [{ text, target, done, optional }]; its text defaults to the required parts joined. */
  list() {
    return Object.entries(this.state).filter(([id]) => this.defs.has(id)).sort((a, b) => a[1].done - b[1].done).map(([id, s]) => {
      const d = this.defs.get(id), live = !s.done && !s.failed;
      return { id, title: d.title, desc: d.desc, done: s.done, failed: !!s.failed, steps: d.steps.map((st, i) => {
        const now = live && i === s.step, row = { text: st.text, target: st.target, done: s.done || i < s.step, current: now };
        if (st.all) {
          const met = now ? s.parts : s.got?.[i];
          row.parts = st.all.map((p, k) => ({ text: p.text, target: p.target, optional: !!p.optional, done: !!met?.[k] || (row.done && !p.optional) }));
          row.text = stepText(st);
        }
        return row;
      }) };
    });
  }
  start(id) {
    if (!this.defs.has(id)) { warnMissing('quest', id, [...this.defs.keys()]); return; }
    if (this.state[id] && !this.state[id].failed) return;   // a failed quest may be taken again (a daily order, a retry)
    DEV && this.engine.ops.guard('quests.start');
    this.state[id] = { step: 0, done: false };
    this._say('start', id, this.engine.t('quests.new', { title: this.defs.get(id).title }));
    this.engine.events.emit('quest:start', { id });
    this.win.refresh();
  }
  /** @internal A quest message: a toast, nothing, or the game's own function (souls-likes keep quests silent) */
  _say(type, id, text) {
    if (this.notify === true) toast(this.engine, text, { kind: 'quest' });
    else if (typeof this.notify === 'function') this.notify({ type, id, text });
  }
  isDone(id) { return !!this.state[id]?.done; }
  isActive(id) { const s = this.state[id]; return !!s && !s.done && !s.failed; }
  isFailed(id) { return !!this.state[id]?.failed; }

  check() {
    const e = this.engine;
    for (const [id, s] of Object.entries(this.state)) {
      if (s.done || s.failed) continue;
      const d = this.defs.get(id); if (!d) continue;
      if (d.fail?.(e)) { this._fail(id, s, d); continue; }
      let advanced = false;
      while (s.step < d.steps.length && this._stepDone(id, s, d.steps[s.step])) { DEV && e.ops.guard('quests.advance'); s.step++; delete s.parts; advanced = true; e.events.emit('quest:step', { id, step: s.step }); }
      if (s.step >= d.steps.length) {
        s.done = true; d.reward?.(this.engine);
        this._say('done', id, this.engine.t('quests.done', { title: d.title })); this.engine.events.emit('quest:done', { id });
      } else if (advanced) this._say('step', id, stepText(d.steps[s.step]));
      if (advanced) this.win.refresh();
    }
  }
  /** @internal Plain step: its condition. Parallel step: tick off parts as they are met (each stays done); done when no required part is left */
  _stepDone(id, s, st) {
    if (!st.all) return st.done(this.engine);
    s.parts ??= st.all.map(() => false);
    let left = false;
    st.all.forEach((p, k) => {
      if (!s.parts[k] && p.done(this.engine)) {
        DEV && this.engine.ops.guard('quests.advance');
        s.parts[k] = true; this.engine.events.emit('quest:part', { id, step: s.step, part: k }); this.win.refresh();
      }
      if (!s.parts[k] && !p.optional) left = true;
    });
    if (!left && s.parts.some((x, k) => x && st.all[k].optional)) (s.got ??= {})[s.step] = s.parts;   // optional goals met stay visible in list()
    return !left;
  }
  /** @internal */
  _fail(id, s, d) {
    DEV && this.engine.ops.guard('quests.fail');
    s.failed = true;
    d.onFail?.(this.engine);
    this._say('fail', id, this.engine.t('quests.failed', { title: d.title }));
    this.engine.events.emit('quest:fail', { id });
    this.win.refresh();
  }
}

/** Quests module. Installs engine.quests. */
export function quests(opts = {}) {
  let q = null;
  return {
    name: 'quests', label: 'Quests',
    install(e) { checkOptions('quests()', opts, ['action', 'keys', 'pad', 'checkInterval', 'notify']); q = new Quests(e, opts); return q; },
    // Check quests in the fixed step (game time; not while frozen or flow is paused, so no rewards are granted while paused)
    fixed(dt) { q._t -= dt; if (q._t <= 0) { q._t = q.checkInterval; q.check(); } },
    frame(dt, e) { toggleOnKey(e, q.win, q.action); },
    // engine.explain({ quest: id }): where a quest is stuck, so the AI need not read every done() function
    explain: { quest(e, id) {
      const d = q.defs.get(id), s = q.state[id];
      if (!d) return { ok: false, text: `quest '${id}' is not defined (defined: ${[...q.defs.keys()].join(', ') || 'none'})` };
      if (!s) return { ok: false, text: `quest '${id}' has not started (quests.start('${id}') or a content start effect)` };
      if (s.done) return { ok: true, text: `quest '${id}' is done` };
      if (s.failed) return { ok: false, text: `quest '${id}' failed (its fail() returned true; start('${id}') begins it again)` };
      const st = d.steps[s.step], at = `quest '${id}' waits on step ${s.step + 1}/${d.steps.length} "${stepText(st)}"`, every = `(checked every ${q.checkInterval} s in fixed steps)`;
      if (!st.all) return { ok: false, step: s.step, text: `${at}: its done() returns ${!!st.done(e)} ${every}` };
      const left = st.all.filter((p, k) => !p.optional && !s.parts?.[k]).map(p => `"${p.text}"`);
      return { ok: false, step: s.step, text: `${at}: required parts not done yet: ${left.join(', ')} ${every}` };
    } },
    describe() {
      const list = q.list();
      return { active: list.filter(x => !x.done && !x.failed).map(x => ({ id: x.id, title: x.title, step: x.steps.find(s => s.current)?.text ?? null })),
        done: list.filter(x => x.done).length, failed: list.filter(x => x.failed).length };
    },
  };
}
