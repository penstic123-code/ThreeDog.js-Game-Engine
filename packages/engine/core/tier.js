// Device tier: Engine uses it at construction to pick default quality (low-end devices default to no bloom and lower render resolution).
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
