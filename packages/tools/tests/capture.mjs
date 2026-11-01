// threedog capture: the frame summary and the Spector command count are plain functions, tested on a hand-made frame (no browser, no network)
import { summarize, spectorDraws } from '../lib/capture-lib.mjs';

export const name = 'capture: frame summary and Spector counts';

const frame = {
  passes: [{ name: 'depth target 1024x1024', draws: 2, tris: 20, depthOnly: true }, { name: 'screen', draws: 3, tris: 1100, depthOnly: false }, { name: 'target 960x540', draws: 1, tris: 2, depthOnly: false }],
  draws: [
    { pass: 0, tris: 10, inst: 1, depth: true, type: 'Mesh', name: '', record: 'cabin', tag: 'level', material: 'prop', materialType: 'MeshDepthMaterial' },
    { pass: 0, tris: 10, inst: 1, depth: true, type: 'Mesh', name: '', record: null, tag: 'vegetation', material: 'vegetation', materialType: 'MeshDepthMaterial' },
    { pass: 1, tris: 1000, inst: 50, depth: false, type: 'Mesh', name: '', record: null, tag: 'vegetation', material: 'vegetation', materialType: 'MeshLambertMaterial' },
    { pass: 1, tris: 90, inst: 1, depth: false, type: 'Mesh', name: 'roof', record: 'cabin', tag: 'level', material: 'prop', materialType: 'MeshLambertMaterial' },
    { pass: 1, tris: 10, inst: 1, depth: false, type: 'Mesh', name: '', record: null, tag: null, material: 'water', materialType: 'MeshPhongMaterial' },
    { pass: 2, tris: 2, inst: 1, depth: false, type: 'Mesh', name: '', record: null, tag: null, material: 'ShaderMaterial', materialType: 'ShaderMaterial' },
  ],
};

export async function run({ check }) {
  const text = summarize(frame, { top: 2, gl: spectorDraws({ commands: [{ name: 'bindFramebuffer' }, { name: 'drawElements' }, { name: 'drawElementsInstanced' }, { name: 'useProgram' }, { name: 'drawArrays' }, { name: 'drawArrays' }, { name: 'drawArrays' }] }) });
  check('first line counts all draws, shadow draws and passes', /^Frame: 6 draw calls in 3 render passes · shadow-map draws 2 · scene and post draws 4/.test(text), text.split('\n')[0]);
  check('a colour pass after the screen pass is counted as a post pass', text.includes('post-effect or off-screen colour passes: 1'));
  check('largest draw is listed first, with instances, tag and material purpose', /1 {3}1000 tris\s+x50 instances.*tag vegetation · material vegetation/.test(text));
  check('only the requested number of largest draws is listed', text.split('Largest 2 scene draws by triangles:\n')[1].split('\n\n')[0].trim().split('\n').length === 2);
  check('world record ids are grouped', /Draws by world record id[^\n]*\n\s+cabin\s+1 draws\s+90 tris/.test(text));
  check('Spector counts: draw calls are counted by command name', spectorDraws({ commands: [{ name: 'drawArrays' }, { name: 'drawElementsInstanced' }, { name: 'clear' }] }).draws === 2);
  check('a draw count that differs from the hook is said, not hidden', text.includes('differs from the renderer hook (6)'));
}
