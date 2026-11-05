// A character's model takes the two forms a prop's does. Why a guard: ['villager', tint] worked on props, reached Object3D.add as an array on NPCs, and check could not see it.
export const specs = [{
  name: '[guard] model name forms: an NPC takes [name, ...args] like a prop, and a file model refuses the arguments out loud',
  url: '/?cutscene=skip',
  async run({ check, ev, frames }) {
    await ev(async () => {
      await __t.until(() => engine.stateApplied, 10000);
      engine.assets.manifest({ models: { formBody(tint) { window.tint = tint; return new (Object.getPrototypeOf(Object.getPrototypeOf(engine.scene)).constructor)(); } } });
      const p = engine.actorPosition();
      engine.npcs.add({ id: 'form-npc', name: 'Form', model: ['formBody', 7], position: [p.x + 1, 0, p.z], schedule: [] });
    });
    await frames(6);
    const r = await ev(() => ({ tint: window.tint, look: engine.world.get('form-npc').look?.model, error: engine.error?.message ?? null }));
    check('the arguments reach the generator, with no error', r.tint === 7 && !r.error, JSON.stringify(r));
    check('the name stays plain data in the save', JSON.stringify(r.look) === '["formBody",7]', JSON.stringify(r.look));
    const refused = await ev(() => {
      engine.assets.manifest({ models: { formFile: '/models/form.glb' } });
      try { engine.characters.createPlayer({ control: 'camera', model: ['formFile', 1] }); return 'no error'; } catch (err) { return err.message; }
    });
    check('a file model with arguments stops and says why', refused.includes('arguments work on a generator'), refused);
  },
}];
