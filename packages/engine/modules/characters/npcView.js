// The model side of an NPC (split out of NPC.js): build the Character when the NPC comes near, tear it down when it goes far, run its interact op.
// Plain functions that take the NPCManager; the manager keeps the maps (_views, _runtime) and avoid, these read and write them.
import { Character } from './Character.js';

/** Build the model: reads position, motion and animation state from data; attaches an interaction when it has interact */
export function buildNpcView(m, rec) {
  const e = m.engine, rt = m._runtime.get(rec.id) || {};
  const ch = new Character(e, { ...rec.look, speed: rec.speed, model: rt.model ?? rec.look?.model, clips: rt.clips, animation: rt.animation });
  ch._modId = rec.id;   // engine.mod('move.speed', { id }) and time.local use the NPC's record id, the same id the game knows it by
  ch.npcModel = true;   // the model of a world NPC: disposing it (the NPC went far) keeps the NPC's control slot (core/control.js)
  ch.placeAt(rec.position);
  ch.loadMotion(rec.motion); ch.state = ch._stateMark = rec.state;
  let use = null;
  const io = rec.interact;
  if (io && e.interactions) use = e.interactions.add(ch.root, {
    id: rec.id,   // stable for the interaction.use op, whether the model is built sync or async
    label: rt.interactLabel || io.label || (() => io.op === 'npc.talk' ? e.t('npc.talk', { name: rec.name }) : rec.name), radius: io.radius,
    // the op's result is the use's result: { ok: false, code } from its can fails interaction.use with that code
    onUse: () => { const r = e.ops.run(io.op, { npc: rec.id, ...io.args }, { source: 'player' }); return r.ok ? r.value : r; },
  });
  m._views.set(ch.root, { ch, use });
  m.avoid.built.add(rec.id);
  return ch.root;
}

/** Tear down the model: interaction, crowd agent, animation, geometry; a model passed in by the game is kept (needed for the next build) */
export function unbuildNpcView(m, rec, obj) {
  const e = m.engine, v = m._views.get(obj);
  m._views.delete(obj);
  if (rec) m.avoid.built.delete(rec.id);
  if (!v) { e.remove(obj); return; }
  const { ch, use } = v;
  use?.remove();
  if (ch._agent && ch._navVersion === e.nav?.version) e.nav.crowd?.removeAgent(ch._agent);
  const model = rec && m._runtime.get(rec.id)?.model;
  if (model && model.parent === ch.root) ch.root.remove(model);
  ch.dispose();
}

/**
 * The op npc.talk { npc, script?, channel? }: dialogue as one thing an NPC's interact can do. Stops it (busy written to data), faces the actor, walks on
 * when the dialogue ends. script defaults to the NPC id. channel 'bubble' plays the script as lines over the NPC's head while the player keeps
 * playing (a shopkeeper's greeting, a guard's warning); default 'main' is the conversation that locks input
 */
export function defineTalk(e, m) {
  if (e.ops.defs.has('npc.talk')) return;
  e.ops.define('npc.talk', {
    desc: 'Talk to an NPC: it stops and faces the actor while its dialogue (script, default the NPC id; channel main | bubble) runs',
    args: { npc: 'string', script: 'string?', channel: { type: 'string', values: ['main', 'bubble'], default: 'main', desc: 'main locks input; bubble = lines over the NPC' } },
    can(e, { npc, channel = 'main' }) {
      const rec = m.world.get(npc);
      if (!e.dialogue) return 'noDialogue';
      if (rec?.kind !== 'npc') return 'unknown';
      // bubble runs beside the main conversation, so it only waits for this NPC's own lines; main is one at a time for the whole game
      if (channel === 'bubble') return rec.busy ? 'talking' : true;
      return e.dialogue.active ? 'talking' : true;
    },
    run(e, { npc, script, channel = 'main' }, ctx) {
      const W = m.world;
      W.set(npc, { busy: true });
      // faces the actor that runs the op (a net peer, another NPC), not the local player
      m.character(npc)?.face(e.actorPosition(ctx?.actor) ?? e.focus);
      // the bubble hangs on the NPC's model (no model built yet: its id, which dialogue resolves to a position)
      const opts = channel === 'bubble' ? { channel, at: m.character(npc)?.root ?? npc } : undefined;
      // the lines end later (a click, a bubble timer), outside this op: clearing busy finishes it, so the ops guard lets it through
      e.dialogue.start(script ?? npc, 'start', () => { if (W.get(npc)) e.ops.allow(() => W.set(npc, { busy: false })); }, opts);
    },
    reasons: { noDialogue: 'The dialogue() module is not installed', unknown: 'No NPC with that id', talking: 'A dialogue is already running (bubble: this NPC is still talking)' },
  });
}
