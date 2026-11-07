// A whole replacement dialogue in ~50 lines against the public core only (events, ops, the UI focus stack, input contexts): the proof that
// modules/gameplay/dialogue.contract.js is small enough to meet. The shared contract check runs it like the engine's own; the browser test
// (specs/ui-nav.mjs, page tests/uinav?fakes=1) installs it in place of dialogue() and talks to an NPC and runs a timeline say through it.
// Deliberately plain: no typing, no choice cursor, no UI part. Lines are recorded in api.log so a test can read them.
export function fakeDialogue() {
  let e = null;
  const scripts = new Map();
  const api = {
    active: null, log: [],
    state: { get flags() { return e.vars?.flags ?? {}; } },
    define(name, nodes) { scripts.set(name, nodes); },
    start(name, node = 'start', onEnd = null, { channel = 'main', at = null } = {}) {
      const nodes = scripts.get(name);
      if (!nodes) { onEnd?.(); return; }
      if (channel === 'bubble') { api.log.push({ channel, name, text: nodes[node]?.text, at: !!at }); e.events.emit('dialogue:bubble', { speaker: name, text: nodes[node]?.text, at }); onEnd?.(); return; }
      if (api.active) api.end();
      api.active = { speaker: name, nodes, onEnd, node, ctx: e.input.push('fake-dialogue') };
      e.events.emit('dialogue:start', name);
      api._line();
    },
    say(text, { speaker = '', channel = 'main', at = null } = {}) {
      const id = 'fake-say-' + api.log.length;
      api.define(id, typeof text === 'object' ? text : { start: { text, speaker } });
      let stop = () => {};
      const p = /** @type {any} */ (new Promise(res => { api.start(id, 'start', res, { channel, at }); stop = () => { if (api.active?.speaker === id) api.end(); res(); }; }));
      p.id = id; p.stop = () => stop();
      return p;
    },
    end() { const a = api.active; api.active = null; a?.ctx.remove(); a?.onEnd?.(); if (a) e.events.emit('dialogue:end', a.speaker); },
    _line() { const a = api.active, n = a.nodes[a.node]; if (!n) { api.end(); return; } api.log.push({ channel: 'main', name: a.speaker, text: n.text }); e.events.emit('dialogue:line', { script: a.speaker, node: a.node, speaker: n.speaker || a.speaker, text: n.text, data: {} }); },
    _next(to) { const a = api.active; if (!to || to === 'end' || !a.nodes[to]) { api.end(); return; } a.node = to; api._line(); },
  };
  return {
    name: 'dialogue', type: 'rules',
    content: { dialogues: { commit(d) { for (const [id, def] of Object.entries(d)) api.define(id, def.nodes); } } },
    install(engine) {
      e = engine;
      e.ops.define('dialogue.advance', { net: 'local', can: () => api.active ? true : 'noDialogue', run: () => { const n = api.active.nodes[api.active.node]; if (!n.choices) api._next(n.next); } });
      e.ops.define('dialogue.choose', { net: 'local', args: { index: 'int' },
        can: (x, { index }) => api.active?.nodes[api.active.node].choices?.[index] ? true : 'noChoice',
        run: (x, { index }) => api._next(api.active.nodes[api.active.node].choices[index].next) });
      return api;
    },
    describe() { return api.active ? { speaker: api.active.speaker } : undefined; },
  };
}
