// [guard] The sky's plain entries (modules/sky/Sky.js, dome.js): what used to be look.sky verbs. Each check reads the dome or the three.js object, not an engine table.
const PAGE = '/tests/threads/';

export const specs = [
  {
    name: '[guard] sky entries: uniforms are the dome\'s own objects; clouds / layer / keyframes / top / horizon / dim move the dome; a bad hook changes nothing',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, E = mk(T.createEngine, 'sky-entries');
        E.use(T.sky({ time: '12:00', sunSize: 700, clouds: { coverage: 0.4, scale: 0.5, speed: [0.1, 0.2] } }));
        await E.start();
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const S = E.sky, U = E.uniforms, D = S.dome.material.uniforms, out = {}, frag = () => S.dome.material.fragmentShader, hex = c => c.getHexString();
        out.shared = ['uSunSize', 'uSunGlow', 'uSunPower', 'uMoonSize', 'uMoonPower', 'uMoonColor', 'uStars', 'uStarScale', 'uCurve', 'uCloudCover', 'uCloudOpacity', 'uCloudSoft', 'uCloudColor', 'uCloudShade'].filter(k => D[k] !== U[k]);
        out.renamed = [D.uCloudScale === U.uSkyCloudScale, D.uCloudSpeed === U.uSkyCloudSpeed, D.uCloudScale !== U.uCloudScale, U.uSkyCloudScale.value, U.uSkyCloudSpeed.value.toArray().join(), U.uCloudScale.value];
        out.start = [U.uSunSize.value, U.uCloudCover.value];
        const plain = frag(), CL = 'vec4 threedogClouds(vec3 d, float t, vec3 s, float n, vec3 l, vec3 h, float c){ return vec4(l, 0.5); }';
        S.clouds(CL); out.clouds = frag().includes('return vec4(l, 0.5)');
        out.cloudsBad = err(() => S.clouds('nope')); out.cloudsKept = frag().includes('return vec4(l, 0.5)');
        S.clouds(null); out.cloudsBack = frag() === plain;
        S.layer('aurora', { glsl: 'vec4 threedogSkyLayer(vec3 d, float t, vec3 s, float n){ return vec4(0.2, 1.0, 0.5, 0.1); }', blend: 'add', uniforms: { uK: 0.4 } });
        out.layer = [frag().includes('threedogSkyLayer0'), S.dome.material.uniforms.uK?.value];
        out.layerBad = err(() => S.layer('x', 'nope')); out.nameBad = err(() => S.layer('a b', null));
        S.layer('aurora', null); out.layerBack = frag() === plain;
        const KF = [[0, 0x102030, 0x203040, 0x808080, 1], [1, 0x102030, 0x203040, 0x808080, 1]];
        S.keyframes(KF); S.update(E.focus); out.kf = hex(U.uSkyTop.value);
        out.sun = [hex(U.uSunColor.value), D.uSunColor === U.uSunColor];
        out.kfSix = err(() => S.keyframes([[0, 0x102030, 0x203040, 0x808080, 1, 1], [1, 0x102030, 0x203040, 0x808080, 1, 1]]));   // the old rows: their 5th column must not be read as ambient
        out.kfBad = err(() => S.keyframes([[0.5, 0, 0, 0, 1, 1]])); S.update(E.focus); out.kfKept = hex(U.uSkyTop.value);
        S.top = 0x336699; S.horizon = '#112233'; S.update(E.focus); out.over = [hex(U.uSkyTop.value), hex(U.uSkyHorizon.value)];
        S.top = S.horizon = null; S.update(E.focus); out.overBack = hex(U.uSkyTop.value);
        const y0 = S.sunDir.z; S.orbit.tilt = 2; S.update(E.focus); out.orbit = S.sunDir.z !== y0;
        S.dim.stars = false; S.update(E.focus); out.dim = D.uStarCloudDim.value;
        out.gone = !('look' in E);
        return out;
      });
      check('every picture number in engine.uniforms is the object the dome reads', r.shared.length === 0, r.shared.join());
      check('dome cloud scale / speed are uSkyCloud*, apart from the cloud shadows', r.renamed.slice(0, 3).every(Boolean) && r.renamed[3] === 0.5 && r.renamed[4] === '0.1,0.2' && r.renamed[5] === 0.006, JSON.stringify(r.renamed));
      check('sky({ ... }) start values land in engine.uniforms', r.start.join() === '700,0.4', r.start.join());
      check('clouds(glsl) goes on the dome, a bad one throws and changes nothing, null gives the built-in back', r.clouds && /threedogClouds/.test(r.cloudsBad) && r.cloudsKept && r.cloudsBack, JSON.stringify(r));
      check('layer(name, spec) adds with its uniforms, a bad one or bad name throws, null removes', r.layer[0] && r.layer[1] === 0.4 && /threedogSkyLayer/.test(r.layerBad) && /name is a word/.test(r.nameBad) && r.layerBack, JSON.stringify(r));
      check("uSunColor is the keyframes' sun color and the dome's own object (one object: the WebGL dome, the TSL dome and a game's shader read the same value)", r.sun[0] !== 'ffffff' && r.sun[1], JSON.stringify(r.sun));
      check('rows with the old intensity column throw instead of shifting the ambient', /sunColor, ambientIntensity/.test(r.kfSix), r.kfSix);
      check('keyframes(rows) moves the signals; bad rows throw and change nothing', r.kf === r.kfKept && r.kf !== '000000' && /keyframes/.test(r.kfBad), JSON.stringify([r.kf, r.kfKept, r.kfBad]));
      check('top / horizon are plain fields over the keyframes; null hands back', r.over[0] === '336699' && r.over[1] === '112233' && r.overBack === r.kf, JSON.stringify([r.over, r.overBack]));
      check('orbit and dim are plain fields the frame reads', r.orbit && r.dim === 0, JSON.stringify([r.orbit, r.dim]));
      check('look.sky is gone', r.gone);
    },
  },
  {
    name: '[guard] engine.sky.replace: a Texture gets its mapping on a clone, a parented Object3D stays where it is, a direct scene.background write hands over and replace(null) takes it back',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, E = mk(T.createEngine, 'sky-replace');
        E.use(T.sky({ time: '12:00' }));
        await E.start();
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const S = E.sky, s = E.scene, out = {};
        const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1), m0 = tex.mapping;
        S.replace(tex); S.update(E.focus);
        out.tex = [s.background !== tex, s.background.mapping === THREE.EquirectangularReflectionMapping, tex.mapping === m0, S.dome.visible];
        S.replace(null); S.update(E.focus); out.texBack = [s.background, S.dome.visible];
        const own = new THREE.Mesh(new THREE.BoxGeometry()), pos = own.position.toArray().join(), mat = own.material, v = own.material.version;
        S.replace(own); S.update(E.focus);
        out.obj = [S.dome.visible, own.parent === s, own.position.toArray().join() === pos, own.material === mat, own.material.version === v, own.visible];
        S.replace(null); S.update(E.focus); out.objBack = [S.dome.visible, own.parent];
        out.bad = [err(() => S.replace(false)), err(() => S.replace(12))];
        const c = new THREE.Color(0x123456); s.background = c; S.update(E.focus); out.direct = [s.background === c, S.dome.visible];
        S.replace(null); S.update(E.focus); out.directBack = [s.background, S.dome.visible];
        return out;
      });
      check('a plain Texture: clone carries the mapping, the game\'s object is unchanged, dome hidden', r.tex.join() === 'true,true,true,false', JSON.stringify(r.tex));
      check('null gives the dome back and clears the background', r.texBack[0] === null && r.texBack[1], JSON.stringify(r.texBack));
      check('an Object3D with no parent is added, none of its fields written; null takes out what the engine added', r.obj.join() === 'false,true,true,true,true,true' && r.objBack[0] && r.objBack[1] === null, JSON.stringify([r.obj, r.objBack]));
      check('false and a number throw naming the call', /replace\(null\)/.test(r.bad[0]) && /asset name/.test(r.bad[1]), JSON.stringify(r.bad));
      check('a direct scene.background write hides the dome; replace(null) hands back', r.direct.join() === 'true,false' && r.directBack[0] === null && r.directBack[1], JSON.stringify([r.direct, r.directBack]));
    },
  },
];
