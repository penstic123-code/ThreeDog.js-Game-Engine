// What COMMANDS.md tells a game test that steers: hold the real loop and advance game time with engine.step, so the machine's load cannot change the path.
export const specs = [{
  name: 'test stepping: under a test pause a held key moves the player only through engine.step, the same distance whatever the wall clock did',
  url: '/?cutscene=skip&play',
  async run({ page, check, ev, wait }) {
    const pos = () => ev(() => engine.player.position.toArray());
    const walk = async pause => {
      await ev(async () => { await engine.applyState({ pos: '0,0' }); window.__hold = engine.haltLoop('walk-test'); engine.step(1); });
      const a = await pos();
      await page.keyboard.down('KeyW');
      await wait(pause);
      const idle = await pos();
      await ev(() => engine.step(1));
      const b = await pos();
      await page.keyboard.up('KeyW');
      await ev(() => { engine.step(1); window.__hold.remove(); });
      return { still: Math.hypot(idle[0] - a[0], idle[2] - a[2]), moved: Math.hypot(b[0] - a[0], b[2] - a[2]) };
    };
    await walk(0);   // the first walk starts from the run's own start state; the two compared start alike
    const quick = await walk(0), slow = await walk(400);
    check('[guard] nothing moves while the loop is held, however long the wall clock runs', quick.still === 0 && slow.still === 0, JSON.stringify({ quick, slow }));
    check('[guard] the same steps give the same distance on a quick and on a slow machine', quick.moved > 0.5 && Math.abs(quick.moved - slow.moved) < 1e-6, JSON.stringify({ quick, slow }));
  },
}];
