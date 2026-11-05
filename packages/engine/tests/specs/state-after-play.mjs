// engine.applyState: what `threedog state` and `shot` stand on. A new run must not undo a pos given in the same call while the tool prints Set,
// and a view far from the player must load the world around what it looks at.
export const specs = [{
  name: 'applyState: pos survives the run that fresh / play starts; a view moves the world focus',
  url: '/?cutscene=skip',
  async run({ check, ev }) {
    const r = await ev(async () => {
      const at = () => ({ x: Math.round(engine.player.position.x), z: Math.round(engine.player.position.z) });
      const res = await engine.applyState({ fresh: 1, play: 1, pos: '37,-41' });
      const placed = at();
      engine.views.define('far-view', { position: [300, 40, 300], target: [320, 0, 320] });
      await engine.applyState({ view: 'far-view' });
      const focus = { x: engine.focus.x, z: engine.focus.z };
      engine.views.release();
      return { ok: res.ok, placed, focus };
    });
    check('[guard] applyState({ fresh, play, pos }) leaves the player at pos, not at the start of the new run', r.ok && r.placed.x === 37 && r.placed.z === -41, JSON.stringify(r));
    check('[guard] a view moves engine.focus to its target, so the world loads there and not around the player', r.focus.x === 320 && r.focus.z === 320, JSON.stringify(r));
  },
}];
