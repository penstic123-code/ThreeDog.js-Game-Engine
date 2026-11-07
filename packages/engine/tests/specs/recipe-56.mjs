// Recipe 56 (docs/recipes/56-webgpu-tsl.md) code blocks, run for real on the WebGPU route (plan step 11: every snippet of the recipe is extracted
// and run). threedog check R13 type-checks the same blocks against the engine d.ts; this runs them, so a TSL name three renamed, a node that
// fails to build or a wrong engine call shows here before an AI copies it. Rules kept with it: the recipe's examples are TSL only (no ```glsl
// block, no ShaderMaterial / onBeforeCompile outside a comment), so the WebGPU recipe never teaches the WebGL route by example.
import { readFileSync } from 'node:fs';

const DOC = new URL('../../docs/recipes/56-webgpu-tsl.md', import.meta.url);

/** The ```js blocks of a markdown text: [{ n, line, code }] */
export function jsBlocks(text) {
  const out = []; let at = -1, buf = [];
  text.split('\n').forEach((l, i) => {
    if (at < 0 && /^```js\s*$/.test(l)) { at = i + 2; buf = []; return; }
    if (at >= 0 && /^```\s*$/.test(l)) { out.push({ n: out.length + 1, line: at, code: buf.join('\n') }); at = -1; return; }
    if (at >= 0) buf.push(l);
  });
  return out;
}

/** import lines -> __mod('name') reads, so a block runs as a function body (static imports cannot) */
export function rewriteImports(code) {
  return code
    .replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+(['"])([^'"]+)\2;?/gm, (m, ns, q, src) => `const ${ns} = __mod('${src}');`)
    .replace(/^import\s+\{([^}]*)\}\s+from\s+(['"])([^'"]+)\2;?/gm, (m, names, q, src) => `const { ${names.split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+as\s+/, ': ')).join(', ')} } = __mod('${src}');`)
    .replace(/^import\s+(['"])([^'"]+)\1;?/gm, (m, q, src) => `__mod('${src}');`);
}

export const specs = [
  {
    name: '[guard] recipe 56: every js code block runs on the WebGPU route without an error, and the examples are TSL only',
    url: '/tests/recipe-56/index.html',
    software: false,   // nothing reads pixels: a block only has to build, start and draw three frames without an error
    expectErrors: /broken node|node build failed/,   // three (and the engine's line after it) logs the deliberately broken block of the self-check below
    async run({ check, ev }) {
      const text = readFileSync(DOC, 'utf8'), blocks = jsBlocks(text);
      check('recipe 56 has its code blocks (at least 10)', blocks.length >= 10, String(blocks.length));
      check('no ```glsl block in the WebGPU recipe (WebGL examples are GLSL, WebGPU examples TSL, never mixed)', !/^```glsl/m.test(text));
      const glslInCode = blocks.filter(b => b.code.split('\n').some(l => !/^\s*\/\//.test(l) && /ShaderMaterial\(|onBeforeCompile|EffectComposer/.test(l.replace(/\/\/.*$/, ''))));
      check('no ShaderMaterial / onBeforeCompile / EffectComposer in the code (only inside a "wrong:" comment)', !glslInCode.length, glslInCode.map(b => `block ${b.n} (line ${b.line})`).join(', '));
      const left = blocks.filter(b => /^\s*import\s/m.test(rewriteImports(b.code)));
      check('every import line of the blocks is one the runner understands', !left.length, left.map(b => `block ${b.n}`).join(', '));
      // the runner itself must fail broken blocks: a GLSL-only patch on a node material, and a node that fails while three builds it
      const bad = [
        "import * as THREE from 'three';\nimport { MeshLambertNodeMaterial } from 'three/webgpu';\nimport { applyEffects } from 'threedog';\n" +
          "engine.add(new THREE.Mesh(new THREE.BoxGeometry(), applyEffects(new MeshLambertNodeMaterial(), { patches: [{ name: 'g', slot: 'color', glsl: 'diffuseColor.rgb *= 0.5;' }] })));",
        "import * as THREE from 'three';\nimport { MeshBasicNodeMaterial } from 'three/webgpu';\nimport { Fn } from 'three/tsl';\n" +
          "const m = new MeshBasicNodeMaterial(); m.colorNode = Fn(() => { throw new Error('broken node'); })();\nengine.add(new THREE.Mesh(new THREE.BoxGeometry(), m));",
      ];
      const caught = [];
      for (const code of bad) caught.push(await ev(c => window.runBlock(c), rewriteImports(code)));
      check('the runner fails a broken block (GLSL-only patch, a node that throws while building)', caught.every(r => !r.ok), JSON.stringify(caught));
      const failed = [];
      for (const b of blocks) {
        const r = await ev(code => window.runBlock(code), rewriteImports(b.code));
        if (!r.ok || r.backends?.some(x => !['webgl2', 'webgpu'].includes(x))) failed.push(`block ${b.n} (line ${b.line}): ${r.error || 'backend ' + r.backends}`);
      }
      check(`all ${blocks.length} blocks run: start, three frames, no error logged`, !failed.length, failed.join('\n'));
    },
  },
];
