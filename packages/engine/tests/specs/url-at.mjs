// ?at=<place>: past the start screen, at a named place, with the game's camera there at once. Headless, so game time moves only on step: an easing camera has
// not moved by itself when the state is applied, and a rig that missed the jump shows up as a camera still at the spawn point.
export const specs = [
  {
    name: '[guard] URL at: ?at=<place> skips the title, stands the player at the place after session:start, and the follow camera is there on the first frame',
    url: '/tests/ui/index.html?mode=default&at=pier&threedog-headless',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await __t.until(() => engine.stateApplied, 10000);
        engine.step(1 / 60);
        const p = engine.player.position, c = engine.camera.position, out = { open: engine.ui.isOpen('title'), playing: engine.session.playing, x: p.x, z: p.z };
        out.camera = Math.hypot(c.x - p.x, c.z - p.z);
        out.rig = engine.cameraRig.kind; out.reach = engine.cameraRig.distance;
        try { await engine.applyState({ at: 'nowhere' }); out.unknown = 'no error'; } catch (e) { out.unknown = e.code; out.names = /pier/.test(e.message); }
        return out;
      });
      check('title closed and a run started', !r.open && r.playing, JSON.stringify(r));
      check('the player stands at the place, not at the spawn', r.x === 20 && r.z === -12, JSON.stringify(r));
      check('the game\'s own camera is on the player', r.rig === 'follow' && r.camera <= r.reach + 0.5, JSON.stringify(r));
      check('an unknown place stops with the list of places', r.unknown === 'content-place' && r.names, JSON.stringify(r));
    },
  },
  {
    name: '[guard] URL at: without a module that knows places, at stops with a coded error instead of quietly staying at the spawn',
    url: '/tests/ui/index.html?mode=default',
    async run({ check, ev }) {
      const code = await ev(() => engine.applyState({ at: 'pier' }).then(() => 'no error', e => e.code));
      check('state-at', code === 'state-at', String(code));
    },
  },
];
