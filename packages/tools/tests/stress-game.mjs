// threedog stress in a game: running it needs a real GPU and a game, so this holds the shape in place: the load is injected into the game's page and no renderer is assumed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { TOOLS } from '../paths.mjs';
import { freeLoad, instances, meter } from '../stress-load.js';

export const name = 'stress game route: measures the game on its own renderer, or refuses';

export async function run({ check }) {
  const cli = readFileSync(join(TOOLS, 'stress.mjs'), 'utf8'), page = readFileSync(join(TOOLS, 'stress-load.js'), 'utf8');
  check('[guard] in a game the load goes into the game page, not the neutral one', /if \(GAME\) \{[\s\S]*stress-page\.js/.test(cli));
  check('[guard] a WebGPU game on a fallback is refused', /back\.requested === 'webgpu' && back\.backend !== 'webgpu'\) throw/.test(cli));
  check('[guard] a game that drew nothing is refused', cli.includes('the game drew nothing'));
  check('[guard] the measure waits for the GPU on both renderers', page.includes('onSubmittedWorkDone') && page.includes('readPixels'));
  check('the output names what it measured', cli.includes('the neutral test page') && cli.includes('rendererLine'));

  // [guard] a lost device draws nothing, so frame times fall: the measure has to say so on WebGPU, where there is no gl to ask, and headless, where engine.page watches nothing.
  // Stub devices; the same two paths were run once by hand on a real GPU (docs/testing/runs.md, 2026-11-05 fix/logic-review)
  const webgpu = () => {
    const events = {}; let lose;
    const device = { lost: new Promise(go => { lose = go; }), queue: { onSubmittedWorkDone: async () => {} }, addEventListener: (k, f) => { events[k] = f; } };
    return { events, lose, measure: meter({ step() {}, renderer: { backend: { isWebGPUBackend: true, device }, info: { render: { drawCalls: 1, triangles: 3 } } } }) };
  };
  const lost = webgpu();
  check('a healthy WebGPU page reports no error', (await lost.measure(1, 0)).error === null);
  lost.lose({ message: 'gone' });
  check('[guard] a lost WebGPU device is an error, not spare capacity', /lost: gone/.test((await lost.measure(1, 0)).error ?? ''));
  const full = webgpu();
  full.events.uncapturederror({ error: { message: 'buffer too large' } });
  check('[guard] an uncaptured GPU error stops the ramp, and stays through the measure the tool throws away', /buffer too large/.test((await full.measure(1, 0)).error ?? '') && /buffer too large/.test((await full.measure(1, 0)).error ?? ''));

  // [guard] the steps double, so an instance buffer left behind is as big as the load being measured
  const group = new THREE.Group(), box = new THREE.BoxGeometry(1, 1, 1);
  instances(group, 4, box, new THREE.MeshBasicMaterial());
  let freed = false;
  group.children[0].addEventListener('dispose', () => { freed = true; });
  freeLoad(group, box);
  check('[guard] a step frees its instanced mesh', freed);
  const neutral = readFileSync(join(TOOLS, '../engine/tests/stress/main.js'), 'utf8'), game = readFileSync(join(TOOLS, 'stress-page.js'), 'utf8');
  check('[guard] both pages measure and free through stress-load.js, no copy of their own', [neutral, game].every(t => /stress-load/.test(t) && /meter\(/.test(t) && /freeLoad\(/.test(t) && !/onSubmittedWorkDone|readPixels/.test(t)));
}
