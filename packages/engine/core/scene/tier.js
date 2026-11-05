// Device tier: tool pages' forced tier, render scale per tier. Detection is render/backend.js tier() (the GPU name is read per renderer).
//
// Headless tool pages (shot, gallery, capture) pass ?threedog-tier=high|low. Why: the headless browser reports SwiftShader or the machine's
// integrated GPU, so detection called every tool page "low" and costly post (ao, bloom) silently dropped out of the picture, which then did not
// show the game's picture. The tool says which tier it rendered at; tests pass nothing and keep their detected (deterministic) tier.
const TIERS = ['low', 'high'];

/** The tier a headless tool page asks for (?threedog-tier=low|high), or null (the tools check the value: shot --tier fails on anything else). */
export function forcedTier(search = typeof location === 'undefined' ? '' : location.search) {
  const t = new URLSearchParams(search).get('threedog-tier');
  return TIERS.includes(t) ? t : null;
}

/**
 * Default render scale. High tier: the display scale up to 1.5. Low tier: at least 0.75 x display scale (1.5 on a 2x screen; a fixed 1 there
 * would be an upscaled blurry picture), never above 1.5 or the display scale.
 * @param {number} dpr @param {string} tier
 */
export function defaultPixelRatio(dpr, tier) {
  const cap = Math.min(dpr, 1.5);
  return tier === 'low' ? Math.min(cap, Math.max(1, +(0.75 * dpr).toFixed(2))) : cap;
}
