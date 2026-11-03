// Models in plain three.js (recipes/05-props-bake.md §2a): a manifest generator returning a multi-material Object3D or a geometry is loaded by name,
// built once (later requests are copies), and its materials survive the GLB round trip the dev cache and npm run bake use: a makeMaterial role is
// rebuilt from the current style (a style swap recolors it unless the generator passed the color), the model's own materials and a code-made
// CanvasTexture are kept. { build, cache: false } is never stored in the dev cache.
export const specs = [
  {
    name: '[守] 代码模型：生成函数按名字取、只建一次、多材质与角色材质经 GLB 往返保留（换游戏自己的 style会改色），cache: false 不写开发缓存',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE, toGLB, createEngine } = threedogTest, A = engine.assets, n = { lamp: 0, block: 0, nocache: 0 };
        function mgLamp() {
          n.lamp++;
          const metal = this.engine.makeMaterial('mgMetal');                                   // role, color from the style
          const paint = this.engine.makeMaterial('mgPaint', { color: 0x3366cc });             // role, the model's own color
          const cv = document.createElement('canvas'); cv.width = cv.height = 8;
          const cx = cv.getContext('2d'); cx.fillStyle = '#c04020'; cx.fillRect(0, 0, 8, 8);
          const own = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cv) });   // the asset's own material
          const root = new THREE.Group(); root.name = 'mgLamp';
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3, 8), metal); post.name = 'post'; post.position.y = 1.5;
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), own); head.name = 'head'; head.position.y = 3.2;
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.4), [paint, metal, paint, metal, paint, metal]); box.name = 'base';
          root.add(post, head, box); root.userData.kind = 'lamp';
          return root;
        }
        A.manifest({ name: 'mg-test', models: { mgLamp, mgBlock: () => { n.block++; return new THREE.BoxGeometry(1, 2, 1); },
          mgNoCache: { build: () => { n.nocache++; return new THREE.BoxGeometry(1, 1, 1); }, cache: false } } });
        const mats = o => { const s = []; o.traverse(m => { if (m.isMesh) for (const x of [].concat(m.material)) s.push(x); }); return s; };
        const a = await A.model('mgLamp'), b = await A.model('mgLamp');
        const sameMats = mats(a).every((m, i) => m === mats(b)[i]);
        // the content path (props / vegetation): assets.cached with the registered generator
        const fn = A.builder('mgLamp'), c1 = await A.cached('mgLamp', fn), c2 = await A.cached('mgLamp', fn);
        const g1 = await A.cached('mgBlock', A.builder('mgBlock')), g2 = await A.cached('mgBlock', A.builder('mgBlock')), bm = await A.model('mgBlock');
        // GLB round trip (what .threedog/cache and npm run bake store), read back by a second engine whose pack colors the role
        const url = URL.createObjectURL(new Blob([await toGLB(a, engine)], { type: 'model/gltf-binary' })) + '#mg.glb';
        const e2 = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'mg-test-2', style: { materials: { mgMetal: { color: 0x00ff00 } } } });
        const back = await e2.assets.model(url), byName = k => back.getObjectByName(k);
        const postM = byName('post')?.material, headM = byName('head')?.material, baseMeshes = [];
        back.traverse(o => { if (o.isMesh && o !== byName('post') && o !== byName('head')) baseMeshes.push(o.material.userData.purpose); });
        const rt = { post: postM?.userData.purpose, postColor: postM?.color.getHexString(), headType: headM?.type, headMap: !!headM?.map?.image,
          base: [...new Set(baseMeshes)].sort().join(','), baseParts: baseMeshes.length, names: !!(byName('post') && byName('head') && byName('base')), userData: back.userData.kind ?? back.children[0]?.userData.kind };
        // a ShaderMaterial comes back with its shaders and plain uniform values, but as new uniform objects (docs: use cache: false if code drives them)
        const time = { value: 2 }, sm = new THREE.ShaderMaterial({ uniforms: { time }, vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'uniform float time; void main() { gl_FragColor = vec4(time); }' });
        const surl = URL.createObjectURL(new Blob([await toGLB(new THREE.Mesh(new THREE.BoxGeometry(), sm), engine)], { type: 'model/gltf-binary' })) + '#mgs.glb';
        const sb = (await e2.assets.model(surl)).getObjectByProperty('isMesh', true).material;
        rt.shader = { type: sb.type, time: sb.uniforms?.time?.value, sameUniform: sb.uniforms?.time === time, frag: /uniform float time/.test(sb.fragmentShader ?? '') };
        e2.dispose();
        // cache: false: built, but nothing is PUT into the dev cache (only checkable when the dev server's cache plugin answers)
        const fetch0 = window.fetch, calls = [];
        window.fetch = (u, o) => { calls.push({ u: String(u), m: o?.method ?? 'GET' }); return fetch0(u, o); };
        const min = A.cacheMinMs; A.cacheMinMs = 0;
        await A.model('mgNoCache'); await new Promise(res => setTimeout(res, 300));
        A.cacheMinMs = min; window.fetch = fetch0;
        return { n, distinct: a !== b, sameMats, kids: a.children.length, c: c1 !== c2 && c1.children.length === 3, geo: g1 === g2 && g1.isBufferGeometry,
          blockMesh: bm.isMesh || !!bm.getObjectByProperty('isMesh', true), rt,
          asked: calls.some(c => c.m === 'POST' && c.u.includes('/__threedog/cache/key')), put: calls.filter(c => c.m === 'PUT').length };
      });
      check('Object3D generator by name: two copies, same shared materials, three meshes', r.distinct && r.sameMats && r.kids === 3, JSON.stringify(r));
      check('built once: model() twice + cached() twice runs the generator once per entry (model / content path)', r.n.lamp <= 2 && r.c, JSON.stringify(r.n));
      check('geometry generator: cached returns the same geometry, model() wraps it in a mesh, built once', r.geo && r.blockMesh && r.n.block <= 2, JSON.stringify(r));
      check('GLB round trip keeps names, userData, the own material type and its CanvasTexture', r.rt.names && r.rt.headType === 'MeshLambertMaterial' && r.rt.headMap && r.rt.userData === 'lamp', JSON.stringify(r.rt));
      check('ShaderMaterial: shaders and uniform values survive, uniform objects are new copies (as documented)', r.rt.shader.type === 'ShaderMaterial' && r.rt.shader.time === 2 && r.rt.shader.frag && !r.rt.shader.sameUniform, JSON.stringify(r.rt.shader));
      check('role materials come back by role; a role without its own color takes the new pack color; a material array becomes one mesh per material', r.rt.post === 'mgMetal' && r.rt.postColor === '00ff00' && r.rt.base === 'mgMetal,mgPaint', JSON.stringify(r.rt));
      check('cache: false builds but stores nothing in the dev cache (the PUT part is only checkable under a dev server: asked)', r.n.nocache === 1 && r.put === 0, JSON.stringify({ n: r.n, asked: r.asked, put: r.put }));
    },
  },
];
