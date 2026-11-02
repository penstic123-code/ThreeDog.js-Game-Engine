import { reportError } from '../../core/errors.js';
// Apply one setting to the engine (helper of Settings.js): the built-in keys (pixel ratio, shadows, post effects, view distance, density, audio buses) and
// the game's own settings (define). `s` is the Settings instance.

export function applySetting(s, key, val) {
  const e = s.engine;
  try {
    switch (key) {
      case 'pixelRatio': if (e.adaptive) e.adaptive.max = val; if (Math.abs(e.renderer.getPixelRatio() - val) > 0.001) e.setPixelRatio(val); break;
      case 'shadows': if (e.shadows !== val) e.setShadows(val); break;
      case 'antialias': e.post.setAntialias(val); break;
      case 'bloom': case 'ao': if (e.post.get(key)) e.look.post.set({ [key + '.enabled']: val }); break;   // a style without this effect has nothing to switch (look.post.set would throw on the unknown key)
      case 'adaptive': if (e.adaptive) { e.adaptive.on = val; if (!val && e.adaptive.max) e.setPixelRatio(e.adaptive.max); } break;
      case 'viewChunks': { const H = s.chunkHost(); if (H?.setViewChunks && H.viewChunks !== val) H.setViewChunks(val); break; }
      case 'density': { const H = s.chunkHost(); if (H?.setDensity && H.density !== val) H.setDensity(val); break; }
      default:
        // a saved slider for a bus this build no longer has is skipped, not an error
        if (key.startsWith('vol.')) { if (key.slice(4) in e.audio.levels) e.audio.setVolume(key.slice(4), val); }
        else s.custom.get(key)?.apply?.(val, e);
    }
  } catch (err) { reportError(e, err, `settings '${key}' apply`, { soft: true }); }
}
