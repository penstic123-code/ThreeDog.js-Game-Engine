// Browser side of the dev bridge (injected as a virtual module by vite-threedog-bridge.js, present only in dev).
// Receives commands and returns results over Vite's own HMR WebSocket; the headless page the server holds (?threedog-headless) does not come through here, Playwright drives it directly.
const hot = import.meta.hot;
if (hot && !new URLSearchParams(location.search).has('threedog-headless')) {
  const hello = () => hot.send('threedog:hello', { path: location.pathname });
  hello();
  addEventListener('focus', () => hot.send('threedog:focus'));   // with several pages open, commands go to the one that last got focus
  hot.on('threedog:eval', async ({ id, src, arg }) => {
    try {
      // indirect eval: src is function source, evaluated in the global scope and then called
      const value = await (0, eval)('(' + src + ')')(arg);
      hot.send('threedog:result', { id, ok: true, value });
    } catch (e) {
      hot.send('threedog:result', { id, ok: false, error: String(e && e.message || e) });
    }
  });
  hot.on('threedog:shot', ({ id }) => {
    // capture the game's canvas only (no HTML UI, not a minimap's canvas earlier in the page): draw one frame first, because only then does the WebGL buffer have content. A draw, not a step: snap moves no game time
    try {
      window.engine?._tools.render(1 / 60);
      hot.send('threedog:result', { id, ok: true, value: (window.engine?.renderer.domElement ?? document.querySelector('canvas')).toDataURL('image/png').split(',')[1] });
    } catch (e) { hot.send('threedog:result', { id, ok: false, error: String(e && e.message || e) }); }
  });
  hot.on('threedog:reload', () => location.reload());
}
