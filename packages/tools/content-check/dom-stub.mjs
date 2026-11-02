// A no-op browser stand-in for importing a game's assets.js in Node (content check reads only the asset NAMES from the pack objects).
// Why: recipe 05 recommends textures drawn in code, and a game naturally builds a shared canvas texture or material at module top
// (document.createElement('canvas')); in Node that threw "document is not defined" and the whole names check failed. Nothing is drawn or kept here:
// every property / call / `new` returns another stand-in, numbers read as 0, so module-top drawing code runs through and the pack objects come out.
// shortcut: covers drawing and DOM calls only; browser APIs not listed in GLOBALS (fetch of a file, FontFace...) still throw and the error names the fix.

const GLOBALS = ['document', 'window', 'Image', 'OffscreenCanvas', 'HTMLCanvasElement', 'ImageData', 'localStorage', 'requestAnimationFrame'];

/** One stand-in: callable and constructible; remembers what is written to it (canvas.width = 256 reads back 256) */
function standIn() {
  const own = new Map();
  return new Proxy(function () {}, {
    get(_, k) {
      if (own.has(k)) return own.get(k);
      if (k === 'then') return undefined;                     // never a thenable: `await x` must not hang
      if (k === Symbol.toPrimitive) return () => 0;           // arithmetic and sizes read 0, so pixel loops end at once
      if (k === Symbol.iterator) return function* () {};
      if (k === 'length') return 0;
      if (typeof k === 'symbol') return undefined;
      // "__x__" names are flags libraries probe for "already loaded?": three checks window.__THREE__ and a stand-in answering yes printed
      // "THREE.WARNING: Multiple instances of Three.js being imported" on every check with one three instance. Unset reads as unset
      if (k.startsWith('__')) return undefined;
      const v = standIn(); own.set(k, v); return v;
    },
    set(_, k, v) { own.set(k, v); return true; },
    apply: () => standIn(),
    construct: () => standIn(),
  });
}

let depth = 0, installed = [];

/** Run fn (an import) with the stand-ins on globalThis for the names Node lacks; removed afterwards (nested calls share one install) */
export async function withDomStub(fn) {
  if (depth++ === 0) installed = GLOBALS.filter(n => !(n in globalThis)).map(n => (globalThis[n] = standIn(), n));
  try { return await fn(); }
  finally { if (--depth === 0) { for (const n of installed) delete globalThis[n]; installed = []; } }
}
