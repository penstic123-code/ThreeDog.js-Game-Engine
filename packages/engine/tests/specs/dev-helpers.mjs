// Dev helper tools: engine.inspect.materials (color space), debug views overdraw / shaderCost, engine.inspect.perf, shader hot reload (engine.debug.reloadGlsl).
export const specs = [
  {
    name: 'DEV-HELPERS inspect materials: a color map not sRGB and a normal map marked sRGB are issues; textures, sharing, maker listed',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const THREE = engine.THREE, cv = document.createElement('canvas'); cv.width = cv.height = 64;
        const color = new THREE.CanvasTexture(cv); color.name = 'dh-color';   // colorSpace left at NoColorSpace: wrong for map
        const normal = new THREE.CanvasTexture(cv); normal.name = 'dh-normal'; normal.colorSpace = THREE.SRGBColorSpace;   // wrong for normalMap
        const m = new THREE.MeshStandardMaterial({ map: color, normalMap: normal }); m.name = 'dh-mat';
        const g = new THREE.Group(); g.name = 'dh-root';
        for (let i = 0; i < 2; i++) g.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
        engine.scene.add(g);
        const out = engine.inspect.materials({ limit: 500 });
        g.removeFromParent(); m.dispose(); color.dispose(); normal.dispose();
        return { issues: out.issues, mat: out.materials.find(x => x.name === 'dh-mat'), text: out.text, count: out.count, bytes: out.textureBytes };
      });
      check(r.issues.some(i => /dh-color/.test(i) && /SRGBColorSpace/.test(i)) && r.issues.some(i => /dh-normal/.test(i) && /NoColorSpace/.test(i)), 'both wrong color spaces reported with the fix');
      check(r.mat?.madeBy === 'game' && r.mat.sharedBy === 2 && r.mat.textures.length === 2 && r.mat.textures[0].size === '64x64' && r.mat.textures[0].bytes > 0, 'material: maker game, shared by 2 meshes, texture size and bytes', JSON.stringify(r.mat));
      check(r.count > 1 && r.bytes > 0 && /^\d+ materials, \d+ textures/.test(r.text) && /✗ /.test(r.text), 'summary line and issues in the text');
      const engineMade = await ev(() => engine.inspect.materials({ limit: 500 }).materials.some(m => m.madeBy === 'engine'));
      check(engineMade, 'engine-made materials (makeMaterial, terrain...) are told apart');
    },
  },
  {
    name: 'DEV-HELPERS debug views overdraw and shaderCost compile, color by cost, and off restores the real materials',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const R = engine.renderer, errs = [], orig = console.error;
        console.error = (...a) => { errs.push(a.map(String).join(' ')); orig(...a); };
        try {
          R.render(engine.scene, engine.camera);   // programs exist before shaderCost reads them
          const mesh = []; engine.scene.traverse(o => { if (o.isMesh && o.material && !Array.isArray(o.material)) mesh.push(o); });
          const real = new Map(mesh.map(o => [o, o.material]));
          const ov = engine.debug.view('overdraw'); R.render(engine.scene, engine.camera);
          const overdraw = { mode: ov.mode, additive: engine.scene.overrideMaterial?.blending === engine.THREE.AdditiveBlending, what: ov.what };
          const sc = engine.debug.view('shaderCost'); R.render(engine.scene, engine.camera);
          const colors = new Set(mesh.map(o => o.material.color?.getHex()));
          const stand = mesh.every(o => o.material.userData._dbgOf === real.get(o));
          engine.debug.view('off'); R.render(engine.scene, engine.camera);
          return { overdraw, sc: sc.mode, colors: colors.size, stand, restored: mesh.every(o => o.material === real.get(o)) && !engine.scene.overrideMaterial, errs };
        } finally { console.error = orig; }
      });
      check(r.overdraw.mode === 'overdraw' && r.overdraw.additive && /layers/.test(r.overdraw.what), 'overdraw: additive override, explained');
      check(r.sc === 'shaderCost' && r.stand && r.colors > 1, 'shaderCost: every mesh shows a stand-in, colored by cost (more than one color)', `colors ${r.colors}`);
      check(r.restored, 'off restores every real material');
      check(r.errs.length === 0, 'both views compile without shader errors', r.errs.join(' | ').slice(0, 300));
    },
  },
  {
    name: 'DEV-HELPERS inspect perf: draw calls, triangles, programs, texture MB, JS ms, compile stalls, a verdict per budget with the next call',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await __t.frames(3);
        const a = engine.inspect.perf();
        const THREE = engine.THREE, m = new THREE.MeshPhysicalMaterial({ color: 0x123456, sheen: 1 }), o = new THREE.Mesh(new THREE.BoxGeometry(), m);
        o.position.copy(engine.camera.position).add(engine.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(4));
        engine.scene.add(o);
        await __t.frames(3);   // a new program compiles during play: a stall frame
        engine.budget.enable({ drawCalls: 1 });
        const b = engine.inspect.perf();
        engine.budget.disable(); o.removeFromParent(); m.dispose();
        return { a, b };
      });
      const { a, b } = r;
      check(a.drawCalls > 0 && a.triangles > 0 && a.programs > 0 && typeof a.textureMB === 'number' && typeof a.cpuMs === 'number', 'fields present', JSON.stringify({ d: a.drawCalls, t: a.triangles, p: a.programs }));
      check(['drawCalls', 'triangles', 'programs', 'textureMB', 'cpuMs', 'compileMs'].every(k => a.budgets.some(x => x.name === k)), 'one verdict per budget');
      check(b.compiles.length > a.compiles.length, 'the program compiled during play is counted as a stall frame', `${a.compiles.length} -> ${b.compiles.length}`);
      const d = b.budgets.find(x => x.name === 'drawCalls');
      check(d.from === 'engine.budget' && !d.ok && /capture/.test(d.next) && /✗ drawCalls/.test(b.text), 'the game\'s budget is used, the over one says what to call next');
      check(a.programCosts.length > 0 && a.programCosts[0].score > 0, 'costliest programs listed');
    },
  },
  {
    name: 'DEV-HELPERS shader hot reload: reloadGlsl recompiles the material using the file text; an error names file:line',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const THREE = engine.THREE, R = engine.renderer;
        const wrap = body => `// threedog:begin file=shaders/test.frag\n${body}\n// threedog:end`;
        const v1 = wrap('void main() {\n  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);\n}');
        const m = new THREE.ShaderMaterial({ fragmentShader: v1 }); m.name = 'dh-hot';
        const o = new THREE.Mesh(new THREE.BoxGeometry(), m);
        o.position.copy(engine.camera.position).add(engine.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(4));
        engine.scene.add(o);
        R.render(engine.scene, engine.camera);
        const p1 = R.properties.get(m).currentProgram;
        const v2 = wrap('void main() {\n  gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);\n}');
        const res = engine.debug.reloadGlsl(v1, v2, 'shaders/test.frag');
        R.render(engine.scene, engine.camera);
        const p2 = R.properties.get(m).currentProgram;
        const errs = [], orig = console.error;
        console.error = (...a) => errs.push(a.map(String).join(' '));
        try {
          engine.debug.reloadGlsl(v2, wrap('void main() {\n  gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0)\n}'), 'shaders/test.frag');   // missing ;
          R.render(engine.scene, engine.camera);
        } finally { console.error = orig; }
        o.removeFromParent(); m.dispose();
        return { res, changed: p1 !== p2 && !!p2, green: m.fragmentShader.includes('0.0, 1.0, 0.0'), errs };
      });
      check(r.res.materials === 1 && r.res.names.includes('dh-hot'), 'the material holding the text is found', JSON.stringify(r.res));
      check(r.changed && r.green, 'it recompiled with the new text (a new program)');
      check(r.errs.some(e => /file shaders\/test\.frag:[23]\b/.test(e)), 'the compile error names the file and line', r.errs.join(' | ').slice(0, 300));
    },
  },
];
