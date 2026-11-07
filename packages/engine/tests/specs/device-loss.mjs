// A real WebGL context loss in a running game: the browser's own extension, not a fake event. What must hold: play waits, game facts stay, and the picture comes back.
const pixelSum = () => {
  const c = document.getElementById('view'), s = document.createElement('canvas'); s.width = 32; s.height = 32;
  engine.renderOnce?.(); const g = s.getContext('2d'); g.drawImage(c, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data; let n = 0; for (let i = 0; i < d.length; i += 4) n += d[i] + d[i + 1] + d[i + 2];
  return n;
};
export const specs = [{
  name: '[guard] device loss: a real WebGL context loss freezes play and says so; on restore the same game goes on with its picture, post and shadows',
  url: '/?cutscene=skip',
  software: true,
  async run({ check, ev, frames }) {
    const a = await ev(async () => {
      const gl = engine.renderer.getContext(), ext = gl.getExtension('WEBGL_lose_context');
      window.lose = ext;
      window.__ev = []; for (const n of ['page:contextlost', 'page:contextrestored']) engine.events.on(n, () => __ev.push(n));
      const p = engine.player.position;
      window.before = { pos: [p.x, p.y, p.z].join(), tick: engine.time.tick };
      if (!ext) return { ext: false };
      ext.loseContext();
      await __t.until(() => engine.page.contextLost, 5000);
      return { ext: true, lost: engine.page.contextLost, frozen: engine.frozen };
    });
    if (!a.ext) { check('this browser has no WEBGL_lose_context', false, 'cannot run'); return; }
    check('play waits while the context is gone', a.lost && a.frozen, JSON.stringify(a));
    const t0 = await ev(() => engine.time.tick);
    await ev(() => new Promise(r => setTimeout(r, 300)));
    check('no fixed step runs while it is gone', await ev(() => engine.time.tick) === t0);
    const b = await ev(async () => {
      lose.restoreContext();
      await __t.until(() => !engine.page.contextLost, 8000);
      return { frozen: engine.frozen, ev: __ev.join(), err: engine.error?.message ?? null };
    });
    await frames(20);
    const c = await ev(pixelSum);
    const d = await ev(() => { const p = engine.player.position; return { pos: [p.x, p.y, p.z].join(), before: before.pos, err: engine.error?.message ?? null, rendered: engine.renderer.info.render.calls ?? 0 }; });
    check('both events went out and play goes on', !b.frozen && b.ev === 'page:contextlost,page:contextrestored' && !b.err, JSON.stringify(b));
    check('the game is the same game', d.pos === d.before && !d.err, JSON.stringify(d));
    check('the picture is back', c > 1000 && d.rendered > 0, JSON.stringify({ c, d }));
    await ev(() => { engine.settings.set('shadows', false, { save: false }); engine.settings.set('shadows', true, { save: false }); });
    await frames(5);
    check('settings still apply after it', !await ev(() => engine.error?.message ?? null));
  },
}];
