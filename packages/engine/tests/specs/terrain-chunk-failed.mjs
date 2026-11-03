// A chunk job that always throws is tried again, then reported (terrain:chunkFailed + error 'terrain-chunk-failed'), counted, and never left
// pending; terrain.retry() sends it again. start() is not awaited: the game may never become ready around a broken chunk, and the report must
// come anyway (before, a broken rule left the loading screen waiting without a word).
export const specs = [
  {
    name: '[守] 地形块失败：重试后报告（事件 + 错误码）、计数、不卡在加载中，retry() 重新排队',
    url: '/tests/terrain-edit/index.html',
    expectErrors: /terrain-chunk-failed|terrain chunk|bad rule/,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, terrain } = threedogTerrain;
        const F = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'terrain-failed', threads: false });
        const errs = [], failed = [];
        F.use(terrain({ height: (x, z) => { if (x > 40 && x < 70) throw new Error('bad rule'); return 0; }, viewChunks: 2 }));
        F.events.on('terrain:chunkFailed', d => failed.push(d));
        F.events.on('engine:error', d => errs.push(String(d?.code ?? '') + ' ' + String(d?.message ?? d)));
        F.start().catch(err => errs.push('start ' + String(err?.message ?? err)));
        // headless start runs no loop of its own: step (frame hooks only while loading) until every chunk settled (ready or failed), or give up
        const busy = () => [...F.terrain.chunks.values()].some(c => c.state === 'pending' || c.state === 'queued');
        for (let i = 0; i < 400 && (!failed.length || busy()); i++) { F.step(1 / 60, { describe: false, render: false }); await new Promise(res => setTimeout(res, 0)); }
        const out = {
          failed: failed.length, stat: F.terrain.stats.failed,
          pending: [...F.terrain.chunks.values()].filter(c => c.state === 'pending').length,
          coded: errs.some(s => s.includes('terrain-chunk-failed')), errs: errs.slice(0, 3),
        };
        out.retried = F.terrain.retry();
        out.statAfter = F.terrain.stats.failed;
        F.dispose();
        return out;
      });
      const s = JSON.stringify(r);
      check('失败的块发出 terrain:chunkFailed 并计数', r.failed > 0 && r.stat > 0, s);
      check('报告带错误码 terrain-chunk-failed', r.coded, s);
      check('没有块卡在 pending', r.pending === 0, s);
      check('retry() 把失败的块重新排队，计数清零', r.retried > 0 && r.statAfter === 0, s);
    },
  },
];
