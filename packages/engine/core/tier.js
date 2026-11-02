// Device tier: Engine uses it at construction to pick default quality (low-end devices default to no bloom and lower render resolution).
//
// Headless tool pages (shot, gallery, capture) pass ?threedog-tier=high|low. Why: the headless browser reports SwiftShader or the machine's
// integrated GPU, so detection called every tool page "low" and costly post (ao, bloom) silently dropped out of the picture, which then did not
// show the game's look. The tool says which tier it rendered at; tests pass nothing and keep their detected (deterministic) tier.
const TIERS = ['low', 'high'];

/** The tier a headless tool page asks for (?threedog-tier=low|high), or null (the tools check the value: shot --tier fails on anything else). */
export function forcedTier(search = typeof location === 'undefined' ? '' : location.search) {
  const t = new URLSearchParams(search).get('threedog-tier');
  return TIERS.includes(t) ? t : null;
}

/** Roughly detect the device tier: phones and integrated GPUs count as low. Only sets defaults; the player can change it in settings. */
export function detectTier(renderer) {
  try {
    if (matchMedia('(pointer: coarse)').matches) return 'low';
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    if (/intel|uhd|iris|mali|adreno|powervr|swiftshader|llvmpipe|software/i.test(name)) return 'low';
  } catch { /* cannot tell: assume high-end */ }
  return 'high';
}
