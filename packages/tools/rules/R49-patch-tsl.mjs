// R49 every shader patch the engine ships has both forms: glsl (WebGLRenderer) and tsl (WebGPURenderer).
// Why: a patch without tsl is never compiled on WebGPURenderer (render/fx/patchNodes.tsl.js throws [webgpu-needs-tsl] and the material draws
//   without it), so an engine module that ships GLSL only is broken there. Two such patches (vegetation nearFade, terrain terrainColorMap)
//   froze the open world on real WebGPU while every WebGL test passed; nothing failed until a browser with WebGPU ran it.
// Criteria: in engine code (core / modules / render / ui) and the add-on packages, an object literal that is
//   - a patch: has a `name` and a `glsl` property (also inside a spread `...(x && { glsl })`), or
//   - a post fuse: the value of a `fuse:` property with a `glsl` property
//   must also have a `tsl` property (directly or in a spread), or be passed straight to a function of the same file that sets `.tsl = ...` on
//   its argument (water's wavesTsl / surfaceTsl). A tsl that is left out only when the game brought its own glsl (`...(!o.glsl && { tsl })`)
//   passes: that GLSL is the game's, named on WebGPU by the engine.
// ALLOW: patches that are WebGL only by design, because WebGPURenderer does the same job another way. Add one only with that reason.
// Known limits: a patch built at run time without a literal `name` / `glsl` (p.glsl = ...) is not seen; hook examples in drawing parts are not read.
import { ts, parse, visit, lineOf, engineFiles, walk, P } from './_lib.mjs';

/** [file suffix, patch name, reason] */
const ALLOW = [
  ['render/cascades.js', 'csm', "WebGPU uses three's CSMShadowNode on the light (render/cascades.tsl.js): one light, no material patch"],
];

const keyOf = p => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;

/** Own and spread-literal property names of an object literal (`...(a && { x })`, `...(a ? { x } : {})`) */
function propNames(obj) {
  const out = new Set();
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) visit(p.expression, n => { if (ts.isObjectLiteralExpression(n)) n.properties.forEach(q => keyOf(q) && out.add(keyOf(q))); });
    else if (keyOf(p)) out.add(keyOf(p));
  }
  return out;
}

/** Names of the functions in a file that set `.tsl = ...` on something (they add the tsl form to the patch they are given) */
function tslAdders(sf) {
  const out = new Set();
  visit(sf, n => {
    if (ts.isFunctionDeclaration(n) && n.name && /\.tsl\s*=[^=]/.test(n.body?.getText() ?? '')) out.add(n.name.text);
  });
  return out;
}

const nameText = obj => {
  const p = obj.properties.find(q => keyOf(q) === 'name' && ts.isPropertyAssignment(q));
  return p && ts.isStringLiteralLike(p.initializer) ? p.initializer.text : null;
};

export default {
  id: 'R49', title: 'Engine shader patches ship a tsl form next to glsl (WebGPURenderer)',
  run() {
    const out = [], files = [...engineFiles(), ...P.ADDONS_REL.flatMap(d => walk(d, ['.js']).filter(f => !f.includes('/tests/')))];
    for (const f of files) {
      const sf = parse(f), adders = tslAdders(sf);
      visit(sf, n => {
        if (!ts.isObjectLiteralExpression(n)) return;
        const names = propNames(n);
        if (!names.has('glsl')) return;
        // a literal nested in a spread of a bigger literal is read as part of that one
        let up = n.parent;
        while (ts.isParenthesizedExpression(up) || ts.isBinaryExpression(up) || ts.isConditionalExpression(up)) up = up.parent;
        if (ts.isSpreadAssignment(up)) return;
        const isFuse = ts.isPropertyAssignment(n.parent) && keyOf(n.parent) === 'fuse';
        if (!isFuse && !names.has('name')) return;
        if (names.has('tsl')) return;
        if (ts.isCallExpression(n.parent) && ts.isIdentifier(n.parent.expression) && adders.has(n.parent.expression.text)) return;
        const name = nameText(n);
        if (ALLOW.some(([s, p]) => f.endsWith(s) && p === name)) return;
        const what = isFuse ? 'post fuse' : `patch '${name ?? '?'}'`;
        out.push({ level: 'error', file: f, line: lineOf(n), msg: `${what} has glsl but no tsl: it does not draw on WebGPURenderer ([webgpu-needs-tsl])`,
          fix: isFuse ? 'add tsl: (color, uv, ctx) => node next to glsl (see packages/post-effects/index.js)'
            : "add tsl: (ctx) => node for its slot next to glsl (recipe 43; ctx.tsl is three/tsl, ctx.fx the threedog/tsl helpers, ctx.fx.patchUniform(u) a patch uniform), "
              + 'and compare it with the GLSL in a WebGPU spec page; WebGL only by design (WebGPU does the job another way): add it to ALLOW in this rule with the reason' });
      });
    }
    return out;
  },
};
