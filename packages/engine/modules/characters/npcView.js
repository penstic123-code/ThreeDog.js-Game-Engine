// The model side of an NPC (split out of NPC.js): build the Character when the NPC comes near, tear it down when it goes far, start its dialogue.
// Plain functions that take the NPCManager; the manager keeps the maps (_views, _runtime) and avoid, these read and write them.
import { Character } from './Character.js';

/** Build the model: reads position, motion and animation state from data; attaches an interaction if it has dialogue */
export function buildNpcView(m, rec) {
  const e = m.engine, rt = m._runtime.get(rec.id) || {};
  const ch = new Character(e, { ...rec.look, speed: rec.speed, model: rt.model ?? rec.look?.model, clips: rt.clips, animation: rt.animation });
  ch.placeAt(rec.position);
  ch.loadMotion(rec.motion); ch.state = rec.state;
  let talk = null;
  if (rec.talk && e.interactions && e.dialogue) talk = e.interactions.add(ch.root, {
    id: rec.id,   // stable for the interaction.use op, whether the model is built sync or async
    label: rt.talkLabel || rec.talkLabel || (() => e.t('npc.talk', { name: rec.name })), radius: rec.talkRadius,
    onUse: () => talkToNpc(m, rec.id),
  });
  m._views.set(ch.root, { ch, talk });
  m.avoid.built.add(rec.id);
  return ch.root;
}

/** Tear down the model: interaction, crowd agent, animation, geometry; a model passed in by the game is kept (needed for the next build) */
export function unbuildNpcView(m, rec, obj) {
  const e = m.engine, v = m._views.get(obj);
  m._views.delete(obj);
  if (rec) m.avoid.built.delete(rec.id);
  if (!v) { e.remove(obj); return; }
  const { ch, talk } = v;
  talk?.remove();
  if (ch._agent && ch._navVersion === e.nav?.version) e.nav.crowd?.removeAgent(ch._agent);
  const model = rec && m._runtime.get(rec.id)?.model;
  if (model && model.parent === ch.root) ch.root.remove(model);
  ch.dispose();
}

/** Start dialogue: stop (busy written to data), face the player, walk on when dialogue ends */
function talkToNpc(m, id) {
  const e = m.engine, W = m.world, rec = W.get(id); if (!rec) return;
  W.set(id, { busy: true });
  m.character(id)?.face(e.actorPosition() ?? e.focus);
  e.dialogue.start(rec.talk, 'start', () => { if (W.get(id)) W.set(id, { busy: false }); });
}
