// threedog/tsl parity (docs/plans/2026-11-03-webgpu-phase2.md §7 steps 3 and 5): each TSL Fn draws what its GLSL function draws.
// A guard: the TSL signatures match the GLSL ones exactly, so a change of algorithm, space or unit on either side pushes the difference past 0.5%;
// plus a static check that threedog/tsl imports only three/tsl / three/webgpu and WebGL-free engine files, and the main entry never imports it
// (WebGL games' bundles must not grow because of the WebGPU path).
import { readFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// engine files threedog/tsl may import: plain data / plain functions with no three.js WebGL parts
const SAFE = new Set(['core/errorHints.js', 'core/errorCodes.js', 'render/engineUniforms.js', 'render/backend.js', 'render/slots.js', 'render/fxNumbers.js', 'core/threePatches.js', 'core/validate.js', 'render/layers.js',
  'render/uniformRenames.js', 'render/lit.js']);   // uniformRenames.js: a table of renamed uniform names + dev warnings; its only import is core/validate.js (already on this list), no three; lit.js imports nothing
const THREE_OK = new Set(['three/tsl', 'three/webgpu']);
// three's TSL display nodes (bloom, ao for the WebGPU post chain): they import only three/tsl and three/webgpu themselves
// plus CSMShadowNode (render/cascades.tsl.js): three/webgpu, three/tsl and CSMFrustum, which takes only Vector3 / Matrix4 from 'three'
// and LightProbeGrid (render/fx/index.js): three/webgpu, three/tsl and LightProbeGridUtils, which takes only Box3, DirectionalLight, Sphere, Vector3 from 'three'
const THREE_TSL_ADDON = /^three\/addons\/(tsl\/display\/[\w]+|csm\/CSMShadowNode|lighting\/LightProbeGrid)\.js$/;

/** Every import reachable from render/fx/index.js, and the ones it must not have */
function tslImports() {
  const seen = new Set(), bad = [], todo = ['render/fx/index.js'];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(join(ENGINE, f), 'utf8');
    for (const [, spec] of src.matchAll(/^\s*(?:import|export)\s(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm)) {   // bare `import './x'` too
      if (!spec.startsWith('.')) { if (!THREE_OK.has(spec) && !THREE_TSL_ADDON.test(spec)) bad.push(`${f} -> ${spec}`); continue; }
      const to = relative(ENGINE, resolve(ENGINE, dirname(f), spec)).replace(/\\/g, '/');
      if (to.endsWith('.tsl.js') || to === 'render/fx/index.js' || SAFE.has(to)) todo.push(to);
      else bad.push(`${f} -> ${to}`);
    }
  }
  return { files: [...seen], bad };
}
/** Does index.js reach render/fx/index.js or any .tsl.js file through its static imports (it must not) */
function mainReachesTsl() {
  const seen = new Set(), todo = ['index.js'];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let src; try { src = readFileSync(join(ENGINE, f), 'utf8'); } catch { continue; }
    for (const [, spec] of src.matchAll(/^\s*(?:import|export)\s(?:[^'"]*?from\s+)?['"](\.[^'"]+)['"]/gm)) {
      const to = relative(ENGINE, resolve(ENGINE, dirname(f), spec)).replace(/\\/g, '/');
      if (to.endsWith('.tsl.js') || to === 'render/fx/index.js') return `${f} -> ${to}`;
      todo.push(to);
    }
  }
  return null;
}

export const specs = [
  {
    name: '[guard] threedog/tsl imports only three/tsl, three/webgpu and WebGL-free engine files; index.js never reaches it',
    url: '/tests/fx/index.html',
    async run({ check }) {
      const { files, bad } = tslImports();
      check('threedog/tsl reaches no WebGL-only file', bad.length === 0 && files.length >= 7, bad.join('; ') || files.join(', '));
      const hit = mainReachesTsl();
      check('the main entry (index.js) does not import threedog/tsl', hit === null, hit || '');
      const pkg = JSON.parse(readFileSync(join(ENGINE, 'package.json'), 'utf8'));
      check('package.json exports ./tsl -> render/fx/index.js with types', pkg.exports['./tsl']?.default === './render/fx/index.js' && !!pkg.exports['./tsl']?.types,
        JSON.stringify(pkg.exports['./tsl']));
    },
  },
  {
    name: '[guard] threedog/tsl parity: wind / cloudShadow / season (+ objectOrigin), detail, lighting, water in TSL draw the GLSL picture; engine.uniforms drives both',
    software: true,   // pixel parity, read inside the page
    url: '/tests/fx/index.html',
    expectErrors: /tsl-misuse|node build failed/,   // the unbound-renderer case below prints it on purpose (three logs node build errors, the engine names the material after)
    async run({ check, ev }) {
      const r = await ev(() => window.fxParity());
      console.log('  fx parity numbers:', JSON.stringify(r));
      for (const [n, c] of Object.entries(r.cases)) {
        check(`${n}: GLSL vs TSL differ on < 0.5% of pixels`, c.parity < 0.5 && c.lit > 0.05, JSON.stringify(c));
        check(`${n}: the effect itself changes the picture (on vs off > 1%), so the parity is not two no-ops`, c.effect > 1, JSON.stringify(c));
      }
      check('engine.uniforms.uWind changed: the TSL picture moves and still matches GLSL', r.sync.moved > 1 && r.sync.parity < 0.5, JSON.stringify(r.sync));
      check('engine.uniforms.uTime changed: the TSL water moves and still matches GLSL', r.waterSync.moved > 1 && r.waterSync.parity < 0.5, JSON.stringify(r.waterSync));
      check('two engines: one TSL material reads each renderer\'s own engine uniforms', r.twoEngines.apart > 1 && r.twoEngines.parity2 < 0.5
        && r.twoEngines.cached && r.twoEngines.own, JSON.stringify(r.twoEngines));
      check('a renderer with no engine fails by code [tsl-misuse], not silently', /tsl-misuse/.test(r.unbound), r.unbound);
      check("import 'threedog/tsl' is the same module as render/fx/index.js", r.subpath === true);
    },
  },
];
