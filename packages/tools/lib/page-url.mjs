// What the tools say about a page they drive: the address of its headless form, and which renderer drew it.

const BACKENDS = { webgpu: 'WebGPU', webgl2: 'WebGL2', webgl: 'WebGL' };

/**
 * A page path (or page?query) as the headless page a tool opens: time moves only on step, and the engine reads the other parameters at start
 * @param {string} page @param {Record<string, string> | URLSearchParams} [params] @returns {string}
 */
export function headlessUrl(page, params = {}) {
  const q = new URLSearchParams(params).toString();
  return `${page}${page.includes('?') ? '&' : '?'}threedog-headless${q ? '&' + q : ''}`;
}

/**
 * Which backend drew a picture, in words, from describe().renderer: the headless browser may have no WebGPU, and a WebGL2 picture taken for a WebGPU one misleads
 * @param {{ requested?: string, backend?: string, reason?: string } | null | undefined} r @returns {string}
 */
export function drawnBy(r) {
  if (!r?.backend) return 'unknown backend';
  const name = BACKENDS[r.backend] ?? r.backend;
  return r.requested === 'webgpu' && r.backend !== 'webgpu' ? `${name} (fallback: WebGPU was asked for${r.reason ? `, ${r.reason}` : ''}; this is not a WebGPU picture)` : name;
}

/** The longer form for the tools that measure: drawnBy plus the GPU and the browser kind @param {any} r @param {string} [kind] @returns {string} */
export const rendererLine = (r, kind) => `Renderer: ${drawnBy(r)} on ${r?.gpu || 'unknown GPU'}${kind ? ` · ${kind} browser` : ''}`;
