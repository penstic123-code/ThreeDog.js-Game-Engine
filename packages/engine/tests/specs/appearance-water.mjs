// Water and weather look hooks (recipes/44): defaults draw what they always drew (compared pixel by pixel with the old shaders kept
// here as the oracle), new parameters take effect, replacement GLSL compiles, wrong settings throw or warn with the fix.

const HELPERS = `
  const { THREE, createEngine, water, weather, sky, makeMaterial, patchMaterial } = threedogTest;
  const R = engine.renderer;
  const make = (style, mods) => {
    const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'appearance-water', style });
    try { e.use(...mods); } catch (err) { e.dispose(); return { error: err.message }; }
    return { e };
  };
  // render a material (or a ready object) into a small target; errors from shader compilation are collected
  const shot = (what, cam, size = 32) => {
    const rt = new THREE.WebGLRenderTarget(size, size), bytes = new Uint8Array(size * size * 4), sc = new THREE.Scene();
    sc.background = new THREE.Color(0x203040);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(5, 10, 3); sc.add(sun);
    sc.add(what.isMaterial ? new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 40, 40).rotateX(-Math.PI / 2), what) : what);
    let err = ''; const prev = R.debug.onShaderError;
    R.debug.onShaderError = (gl, p, vs, fs) => { err += (gl.getProgramInfoLog(p) || '') + (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || ''); };
    R.setRenderTarget(rt); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, size, size, bytes); R.setRenderTarget(null);
    R.debug.onShaderError = prev; rt.dispose();
    return { px: Array.from(bytes).join(','), err: err.slice(0, 400) };
  };
  const warns = fn => { const got = [], w = console.warn; console.warn = (...a) => got.push(a.join(' ')); try { fn(); } catch (x) { got.push(x.message); } finally { console.warn = w; } return got.join('\\n'); };
`;
// the weather particle shaders before particles.js, verbatim (the oracle for "default rain and snow unchanged")
const OLD_PARTICLES = {
  rainVert: `uniform vec3 uCam; uniform float uSize; uniform float uFallOff; uniform vec2 uWindDir; uniform float uLen; attribute float aEnd;
varying float vA;
void main(){
  vec3 p = position;
  float fall = mod(p.y - uFallOff, uSize);
  vec3 w = vec3(mod(p.x - uCam.x + uWindDir.x * fall * 0.3, uSize) - uSize*0.5, fall - uSize*0.35, mod(p.z - uCam.z + uWindDir.y * fall * 0.3, uSize) - uSize*0.5);
  w += uCam;
  w.y -= aEnd * uLen; w.x -= aEnd * uWindDir.x * 0.2; w.z -= aEnd * uWindDir.y * 0.2;
  vA = 1.0 - aEnd * 0.8;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`,
  rainFrag: `uniform float uOpacity; uniform vec3 uColor; varying float vA;
void main(){
  gl_FragColor = vec4(uColor, uOpacity * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  snowVert: `uniform vec3 uCam; uniform float uSize; uniform float uPx; uniform float uMaxPx; uniform float uFallOff; uniform float uSway;
void main(){
  vec3 p = position;
  float fall = mod(p.y - uFallOff, uSize);
  vec3 w = vec3(mod(p.x - uCam.x + sin(uSway*0.7 + p.y)*1.5, uSize) - uSize*0.5, fall - uSize*0.35, mod(p.z - uCam.z + cos(uSway*0.5 + p.x)*1.5, uSize) - uSize*0.5) + uCam;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_PointSize = min(uPx * 3.0 / -mv.z, uMaxPx);
  gl_Position = projectionMatrix * mv;
}`,
  snowFrag: `uniform float uOpacity; uniform vec3 uColor; uniform sampler2D uMap; uniform float uUseMap;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  vec4 c = uUseMap > 0.5 ? texture2D(uMap, gl_PointCoord) : vec4(1.0, 1.0, 1.0, step(dot(d,d), 0.25));
  if (c.a < 0.05) discard;
  gl_FragColor = vec4(uColor * c.rgb, uOpacity * c.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
};
const page = fn => new Function(`${HELPERS}\nconst OLD = ${JSON.stringify(OLD_PARTICLES)};\nreturn (${fn})();`);

export const specs = [
  {
    name: '[守] 水面外观：默认和旧着色器逐像素一致；depthColor / foam 生效；glsl.wave 照抄默认写法逐像素相同、glsl.surface 带自定义 uniform 能编译；写错报错给改法；Reflector 经 water.material 接入能渲染',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {}, cam = new THREE.PerspectiveCamera(60, 1, 0.1, 200); cam.position.set(0, 6, 14); cam.lookAt(0, 0, 0);
        const at = (style, opts = {}) => { const m = make({ water: style }, [water({ sea: false, ...opts })]); if (m.error) return m; m.e.uniforms.uTime.value = 37.5; return m; };
        // the old water material, verbatim: role 'water' + the inline wave sum + fresnel (the oracle)
        const def = at({}).e, grey = new THREE.Color(0xcccccc);
        const old = makeMaterial('water', { color: 0x888888, transparent: true, opacity: 0.85, flatShading: true, shininess: 90, specular: 0xaaaaaa, roughness: 0.15, metalness: 0 }, def);
        patchMaterial(old, [{ name: 'waves',
          uniforms: { uTime: def.uniforms.uTime, uWave: { value: 1 }, uWaveScale: { value: 1 }, uWaveSpeed: { value: 1 } },
          glsl: { vertex: { pars: 'uniform float uTime; uniform float uWave; uniform float uWaveScale; uniform float uWaveSpeed;', begin_vertex: `
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz * uWaveScale; float tw = uTime * uWaveSpeed;
        transformed.y += (sin(wp.x * 0.21 + tw * 1.1) * 0.12 + cos(wp.z * 0.17 + tw * 0.9) * 0.12 + sin((wp.x + wp.z) * 0.37 + tw * 1.7) * 0.05) * uWave;` } } },
        { name: 'fresnel', uniforms: { uFresnel: { value: 0.5 }, uFresnelColor: { value: grey } },
          glsl: { fragment: { pars: 'uniform float uFresnel; uniform vec3 uFresnelColor;', opaque_fragment: { before: `
        float threedogFres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0) * uFresnel;
        outgoingLight = mix(outgoingLight, uFresnelColor, clamp(threedogFres, 0.0, 1.0));` } } } }], { strict: false });
        const base = shot(def.water.material, cam), oracle = shot(old, cam);
        out.same = base.px === oracle.px && !base.err; out.err0 = base.err || oracle.err;
        out.noSurface = !/threedogWaterSurface/.test(JSON.stringify(def.water.material.customProgramCacheKey())) && !def.water.material.customProgramCacheKey().includes('waterSurface');
        const differs = style => { const m = at(style); if (m.error) return m.error; const s = shot(m.e.water.material, cam); m.e.dispose(); return s.err || (s.px !== base.px); };
        out.depthView = differs({ depthColor: { shallow: 0x55ddcc, deep: 0x082040 } });
        out.depthWave = differs({ depthColor: { shallow: 0x55ddcc, deep: 0x082040, by: 'wave' } });
        out.foam = differs({ foam: { color: 0xffffff, start: 0.2, end: 0.6 } });
        // glsl.wave copied from the default draws the same; a custom surface with its own uniform compiles and differs
        const copy = at({ glsl: { wave: `float threedogWaterWave(vec3 p, float t) {
  return sin(p.x * 0.21 + t * 1.1) * 0.12 + cos(p.z * 0.17 + t * 0.9) * 0.12 + sin((p.x + p.z) * 0.37 + t * 1.7) * 0.05; }` } }).e;
        out.copyWave = shot(copy.water.material, cam).px === base.px; copy.dispose();
        out.surface = differs({ uniforms: { uBands: 4 }, glsl: { surface: `vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time) {
  float b = floor(facing * uBands) / uBands; return vec4(mix(vec3(0.05, 0.2, 0.4), vec3(0.4, 0.8, 0.9), b), base.a); }` } });
        out.wave = differs({ glsl: { wave: 'float threedogWaterWave(vec3 p, float t) { return sin(p.x * 2.0 + t) * 0.5; }' } });
        // wrong settings
        out.badBy = at({ depthColor: { by: 'veiw' } }).error;
        out.badSurface = at({ glsl: { surface: 'vec3 surf() { return vec3(1.0); }' } }).error;
        out.badKey = warns(() => { const m = at({ foam: { colour: 0xffffff } }); m.e?.dispose(); });
        out.optKey = warns(() => { const m = make({}, [water({ sea: false, depthColour: {} })]); m.e?.dispose(); });
        // reflections through style.water.material (recipe 44): a three.js Reflector feeds its material to the engine water
        const { Reflector } = threedogTest; let lastMirror;
        const mirrorWater = () => {   // the recipe 44 example, verbatim
          const mirror = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: 64, textureHeight: 64, color: 0x88aacc }), m = mirror.material;
          const toPlane = new THREE.Matrix4().makeRotationX(-Math.PI / 2), back = new THREE.Matrix4().makeRotationX(Math.PI / 2);
          let busy = false; lastMirror = mirror;
          m.onBeforeRender = (renderer, scene, camera, geometry, mesh) => {
            if (busy) return; busy = true;
            mirror.matrixWorld.copy(mesh.matrixWorld).multiply(toPlane);
            mesh.visible = false; mirror.onBeforeRender(renderer, scene, camera); mesh.visible = true;
            m.uniforms.textureMatrix.value.multiply(back);
            busy = false;
          };
          return m;
        };
        const refl = make({ water: { material: mirrorWater } }, [water({ level: 0.2, size: 40, segments: 8 })]).e;
        refl.water.update(refl.focus, 0);   // builds the sea mesh
        const sea = refl.water.sea;
        const box = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshLambertMaterial({ color: 0xff3333 })); box.position.set(0, 2, -4);
        const grp = new THREE.Group(); grp.add(sea, box);
        const rs = shot(grp, cam), mrt = lastMirror.getRenderTarget(), mp = new Uint16Array(64 * 64 * 4);   // Reflector renders to half floats
        R.readRenderTargetPixels(mrt, 0, 0, 64, 64, mp);
        let red = 0; for (let i = 0; i < mp.length; i += 4) { const [r, g] = [mp[i], mp[i + 1]].map(THREE.DataUtils.fromHalfFloat); if (r > 0.4 && g < 0.2) red++; }
        out.reflector = !rs.err && red > 20; out.reflErr = rs.err + ' red px ' + red + ' type ' + mrt.texture.type;
        for (const e of [def, refl]) e.dispose();
        return out;
      }));
      check('默认水面和旧写法逐像素一致、无编译错误', r.same, r.err0);
      check('不写 depthColor / foam / glsl.surface 时不加表面补丁（不付代价）', r.noSurface);
      check('depthColor 按视角 / 按波高、foam 波峰泡沫都改变画面且能编译', r.depthView === true && r.depthWave === true && r.foam === true, JSON.stringify([r.depthView, r.depthWave, r.foam]));
      check('glsl.wave 照抄默认写法逐像素相同；换波函数画面不同', r.copyWave && r.wave === true, String(r.wave));
      check('glsl.surface 带自定义 uniform 能编译且画面不同', r.surface === true, String(r.surface));
      check('写错：by 拼错报错给可选值；surface 签名不对报错给签名', /did you mean 'view'/.test(r.badBy || '') && /threedogWaterSurface\(vec4 base/.test(r.badSurface || ''), `${r.badBy} | ${r.badSurface}`);
      check('写错键：style.water.foam / water() 选项拼错提示近似名', /color/.test(r.badKey) && /depthColor/.test(r.optKey), `${r.badKey} | ${r.optKey}`);
      check('Reflector 经 style.water.material 接入：编译渲染一帧无错，反射贴图里有红箱子', r.reflector, r.reflErr);
    },
  },
  {
    name: '[守] 天气粒子：默认雨雪和旧着色器逐像素一致；形状 / 大小 / 密度曲线 / 速度 / 颜色生效；glsl 替换带 uniform 能编译；闪电外观可换；look.weather.replace 注册自己的粒子；写错报错给改法',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {}, cam = new THREE.PerspectiveCamera(70, 1, 0.1, 100); cam.position.set(3, 2, 5); cam.updateMatrixWorld();
        const types = { clear: {}, wet: { rain: 1, snow: 1, wind: 1.5 }, ashfall: { ash: 1 } };
        const at = (wst, opts = {}) => { const m = make({ weather: wst }, [sky(), weather({ types, start: 'wet', particles: 3000, ...opts })]); if (m.error) return m;
          m.e.step(0.3, { render: false }); m.e.weather.apply(cam); return m; };
        const sys = (e, k) => e.weather.systems.get(k);
        const def = at({}).e, rain = sys(def, 'rain'), snow = sys(def, 'snow');
        const oldRain = new THREE.LineSegments(rain.object.geometry, new THREE.ShaderMaterial({ vertexShader: OLD.rainVert, fragmentShader: OLD.rainFrag, uniforms: rain.uniforms, transparent: true, depthWrite: false }));
        const oldSnow = new THREE.Points(snow.object.geometry, new THREE.ShaderMaterial({ vertexShader: OLD.snowVert, fragmentShader: OLD.snowFrag, uniforms: snow.uniforms, transparent: true, depthWrite: false }));
        const px = o => { const c = o.clone(); c.visible = true; c.frustumCulled = false; return shot(c, cam, 48); };
        const r0 = px(rain.object), s0 = px(snow.object);
        const n = def.weather.particles; const busy = q => new Set(q.px.split(',')).size > 4;   // something was drawn, so equal is not two empty pictures
        out.same = busy(r0) && busy(s0) && r0.px === px(oldRain).px && s0.px === px(oldSnow).px && !r0.err && !s0.err;
        out.err0 = r0.err + s0.err + JSON.stringify([r0.px === px(oldRain).px, s0.px === px(oldSnow).px, rain.object.geometry.drawRange.count, n, r0.px.length, new Set(r0.px.split(',')).size]);
        out.drawn = rain.object.visible && snow.object.visible && rain.object.geometry.drawRange.count === n * 2;
        // parameters
        const look = at({ rain: { color: 0xff2020, length: 2, speed: 5, density: a => a * 0.25 }, snow: { shape: 'soft', size: 60, maxSize: 20, sway: 4 } }).e;
        const lr = sys(look, 'rain'), ls = sys(look, 'snow');
        out.density = lr.object.geometry.drawRange.count === Math.floor(n * 0.25) * 2;
        out.params = lr.uniforms.uLen.value === 2 && ls.uniforms.uSwayAmp.value === 4 && ls.uniforms.uPx.value === 60 && px(lr.object).px !== r0.px && px(ls.object).px !== s0.px;
        out.points = sys(at({ rain: { shape: 'square', size: 30 } }).e, 'rain').object.isPoints;
        // glsl with a custom uniform
        const tinted = at({ snow: { uniforms: { uTint: [1, 0.2, 0.2] }, glsl: { fragment: OLD.snowFrag.replace('uColor * c.rgb', 'uTint * c.rgb') } } }).e;
        const ts = px(sys(tinted, 'snow').object); out.glsl = !ts.err && ts.px !== s0.px; out.glslErr = ts.err;
        // lightning look
        const zap = at({ lightning: f => f * 0.25 }, { start: 'wet' }).e; zap.weather.flash = 1; zap.weather.apply(cam);
        out.lightning = Math.abs(zap.weather._layer.flash - 0.25) < 1e-6;
        // game-defined systems
        const g = at({}).e;
        g.look.weather.replace({ ash: { shape: 'soft', color: 0x555555, size: 14, speed: 0.8, sway: 3 } }); const ash = g.weather.systems.get('ash');
        g.weather.set('ashfall', 0.01); g.step(0.2, { render: false }); g.weather.apply(cam);
        out.ash = ash.object.parent === g.scene && ash.object.name === 'weather-ash' && ash.object.visible && !px(ash.object).err;
        let seen = -1; const own = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        g.look.weather.replace({ ash: { create: () => ({ object: own, update(a) { seen = a; } }) } }); g.weather.apply(cam);
        out.own = !ash.object.parent && own.parent === g.scene && seen > 0.9;
        const drops = new THREE.Points(new THREE.BufferGeometry());
        g.look.weather.replace({ rain: { create: () => ({ object: drops }) } });
        out.replaced = !g.scene.getObjectByName('weather-rain') || g.scene.getObjectByName('weather-rain') === drops;
        out.zero = at({}, { types: { clear: {}, dusk: { grey: 0.4 } }, start: 'clear' }).e.weather.systems.size === 0;
        // wrong settings
        const err = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
        out.badField = err(() => g.look.weather.replace({ ahs: {} }));
        out.badShape = at({ snow: { shape: 'sqare' } }).error;
        out.badDensity = at({ rain: { density: 0.5 } }).error;
        out.badKey = warns(() => { const m = at({ rain: { colour: 0xffffff }, lightnig: 1 }); m.e?.dispose(); });
        for (const e of [def, look, tinted, zap, g]) e.dispose();
        return out;
      }));
      check('默认雨（线）和雪（圆点）与旧着色器逐像素一致、无编译错误；雨按旧密度曲线画满', r.same && r.drawn, r.err0);
      check('密度曲线、长度、颜色、大小、飘移、soft 形状生效；square 形状把雨换成点', r.density && r.params && r.points, JSON.stringify([r.density, r.params, r.points]));
      check('glsl.fragment 替换带自定义 uniform 能编译且画面不同', r.glsl, r.glslErr);
      check('style.weather.lightning 换闪电亮度曲线', r.lightning);
      check('look.weather.replace：自己的字段画粒子；create 整体替换；同名替换内置雨；不用就不建', r.ash && r.own && r.replaced && r.zero, JSON.stringify([r.ash, r.own, r.replaced, r.zero]));
      check('写错：字段不存在列出可用字段；形状拼错给近似名；density 不是函数给写法', /ashfall: \{ ahs: 1 \}/.test(r.badField) && /did you mean 'square'/.test(r.badShape || '') && /density: a => a \* a/.test(r.badDensity || ''), `${r.badField} | ${r.badShape} | ${r.badDensity}`);
      check('写错键：style.weather.rain / style.weather 拼错提示近似名', /`color`/.test(r.badKey) && /lightning/.test(r.badKey), r.badKey);
    },
  },
];
