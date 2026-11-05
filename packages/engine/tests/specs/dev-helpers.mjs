// Dev helper tools: engine.inspect.materials (color space), debug views overdraw / shaderCost, engine.inspect.perf, shader hot reload (engine.debug.reloadGlsl).
export const specs = [
  {
    name: 'DEV-HELPERS inspect materials: a color map not sRGB and a normal map marked sRGB are issues; textures, sharing, maker listed',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const THREE = __threedogThree, cv = document.createElement('canvas'); cv.width = cv.height = 64;
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
      check('both wrong color spaces reported with the fix', r.issues.some(i => /dh-color/.test(i) && /SRGBColorSpace/.test(i)) && r.issues.some(i => /dh-normal/.test(i) && /NoColorSpace/.test(i)));
      check('material: maker game, shared by 2 meshes, texture size and bytes', r.mat?.madeBy === 'game' && r.mat.sharedBy === 2 && r.mat.textures.length === 2 && r.mat.textures[0].size === '64x64' && r.mat.textures[0].bytes > 0, JSON.stringify(r.mat));
      check('summary line and issues in the text', r.count > 1 && r.bytes > 0 && /^\d+ materials, \d+ textures/.test(r.text) && /✗ /.test(r.text));
      const engineMade = await ev(() => engine.inspect.materials({ limit: 500 }).materials.some(m => m.madeBy === 'engine'));
      check('engine-made materials (terrain, neutral defaults...) are told apart', engineMade);
    },
  },
  {
    name: 'DEV-HELPERS debug views overdraw and shaderCost compile, color by cost, and off restores the real materials',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        const R = engine.renderer, errs = [], orig = console.error;
        console.error = (...a) => { errs.push(a.map(String).join(' ')); orig(...a); };
        try {
          R.render(engine.scene, engine.camera);   // programs exist before shaderCost reads them
          const mesh = []; engine.scene.traverse(o => { if (o.isMesh && o.material && !Array.isArray(o.material)) mesh.push(o); });
          const real = new Map(mesh.map(o => [o, o.material]));
          const ov = engine.debug.view('overdraw'); R.render(engine.scene, engine.camera);
          const overdraw = { mode: ov.mode, additive: engine.scene.overrideMaterial?.blending === __threedogThree.AdditiveBlending, what: ov.what };
          const sc = engine.debug.view('shaderCost'); R.render(engine.scene, engine.camera);
          const colors = new Set(mesh.map(o => o.material.color?.getHex()));
          const stand = mesh.every(o => o.material.userData._dbgOf === real.get(o));
          engine.debug.view('off'); R.render(engine.scene, engine.camera);
          return { overdraw, sc: sc.mode, colors: colors.size, stand, restored: mesh.every(o => o.material === real.get(o)) && !engine.scene.overrideMaterial, errs };
        } finally { console.error = orig; }
      });
      check('overdraw: additive override, explained', r.overdraw.mode === 'overdraw' && r.overdraw.additive && /layers/.test(r.overdraw.what), JSON.stringify(r.overdraw));
      check('shaderCost: every mesh shows a stand-in, colored by cost (more than one color)', r.sc === 'shaderCost' && r.stand && r.colors > 1, `colors ${r.colors}`);
      check('off restores every real material', r.restored);
      check('both views compile without shader errors', r.errs.length === 0, r.errs.join(' | ').slice(0, 300));
    },
  },
  {
    name: 'DEV-HELPERS inspect perf: draw calls, triangles, programs, texture MB, JS ms, compile stalls, a verdict per budget with the next call',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await __t.frames(3);
        const a = engine.inspect.perf();
        const THREE = __threedogThree, m = new THREE.MeshPhysicalMaterial({ color: 0x123456, sheen: 1 }), o = new THREE.Mesh(new THREE.BoxGeometry(), m);
        o.position.copy(engine.camera.position).add(engine.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(4));
        engine.scene.add(o);
        await __t.frames(3);   // a new program compiles during play: a stall frame
        engine.budget.enable({ drawCalls: 1 });
        const b = engine.inspect.perf();
        engine.budget.disable(); o.removeFromParent(); m.dispose();
        // what a page that has not drawn yet reads: the counters at 0
        const info = engine.renderer.info.render, calls = info.calls; info.calls = 0;
        const none = engine.inspect.perf(); info.calls = calls;
        engine.haltLoop(); engine.step(1 / 60);
        const halted = engine.inspect.perf();
        return { a, b, none, halted };
      });
      const { a, b, none, halted } = r;
      check('[guard] halted: JS ms and fps have no value and the text says so, not "JS 0 ms, fps 0"', halted.cpuMs === null && halted.fps === null && /not measured/.test(halted.text) && !/fps 0/.test(halted.text) && !halted.budgets.some(x => x.name === 'cpuMs'), halted.text);
      check('the lights line says what it counts: a sun is not in it', / lights \d+ point \+ spot \/ /.test(a.text), a.text);
      check('[guard] no draw counted: says nothing is measured, no tick on the frame metrics, not ok', none.measured === false && none.ok === false && /^nothing measured yet/.test(none.text) && !none.budgets.some(x => ['drawCalls', 'triangles', 'cpuMs', 'compileMs'].includes(x.name)), none.text);
      check('fields present', a.drawCalls > 0 && a.triangles > 0 && a.programs > 0 && typeof a.textureMB === 'number' && typeof a.cpuMs === 'number', JSON.stringify({ d: a.drawCalls, t: a.triangles, p: a.programs }));
      check('one verdict per budget', ['drawCalls', 'triangles', 'programs', 'textureMB', 'cpuMs', 'compileMs'].every(k => a.budgets.some(x => x.name === k)));
      check('the program compiled during play is counted as a stall frame', b.compiles.length > a.compiles.length, `${a.compiles.length} -> ${b.compiles.length}`);
      const d = b.budgets.find(x => x.name === 'drawCalls');
      check('the game\'s budget is used, the over one says what to call next', d.from === 'engine.budget' && !d.ok && /capture/.test(d.next) && /✗ drawCalls/.test(b.text));
      check('costliest programs listed', a.programCosts.length > 0 && a.programCosts[0].score > 0);
    },
  },
  {
    name: 'DEV-HELPERS shader hot reload: reloadGlsl recompiles the material using the file text; an error names file:line',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        const THREE = __threedogThree, R = engine.renderer;
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
      check('the material holding the text is found', r.res.materials === 1 && r.res.names.includes('dh-hot'), JSON.stringify(r.res));
      check('it recompiled with the new text (a new program)', r.changed && r.green);
      check('the compile error names the file and line', r.errs.some(e => /file shaders\/test\.frag:[23]\b/.test(e)), r.errs.join(' | ').slice(0, 300));
    },
  },
];
