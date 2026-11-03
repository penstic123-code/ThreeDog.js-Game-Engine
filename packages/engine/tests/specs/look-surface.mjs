// look.materials / surface / ground / wind (render/lookSurface.js, modules/terrain/lookGround.js, modules/vegetation/lookWind.js).
// 每个部件一条"不许绕开"：走动词改了以后 describe().look 显示 game:<owner>，真的影响后来做的材质 / uniform，删掉那一层后回到 style 的值。
// Same format as the other files here.
const PAGE = '/tests/perf/index.html?mode=world';

export const specs = [
  {
    name: 'look no bypass: materials (set / add / replace) and surface (lighting / detail / ramp / hooks) change what makeMaterial makes; remove restores',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const L = engine.look, info = () => engine.describe().look, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const key = role => engine.makeMaterial(role).customProgramCacheKey();
        // materials.set: merged into the role's spec, later materials only
        const c0 = engine.makeMaterial('prop').color.getHex(), k0 = key('prop');
        const h = L.materials.set({ prop: { color: 0xff0000, roughness: 0.2 } }, { owner: 'cave' });
        out.set = [info().materials['prop.color'].writer, engine.makeMaterial('prop').color.getHex() === 0xff0000, L.materials.object('prop')?.color.getHex() === 0xff0000];
        h.remove();
        out.setBack = [engine.makeMaterial('prop').color.getHex() === c0, info().materials['prop.color']?.writer ?? 'gone'];
        out.typo = err(() => L.materials.replace(5, null));
        // materials.add: a ShaderPatch added to the roles (none = all)
        const patch = { glsl: { fragment: { color_fragment: 'diffuseColor.rgb *= 0.5;' } } };
        const hp = L.materials.add('dim', patch, { roles: ['prop'], owner: 'cave' });
        out.patch = [info().materials['hook:dim'].writer, key('prop') !== k0, key('character') === key('character')];
        hp.remove();
        out.patchBack = [key('prop') === k0, info().materials['hook:dim']?.writer ?? 'gone'];
        // materials.replace(role, Material)
        const mark = engine.makeMaterial('default').clone(); mark.userData.mark = 7;
        const hr = L.materials.replace('prop', mark, { owner: 'cave' });
        out.replace = [info().materials['replace:prop'].writer, engine.makeMaterial('prop').userData.mark];
        hr.remove(); out.replaceBack = engine.makeMaterial('prop').userData.mark === undefined;
        // surface.set lighting / detail
        const kl = key('prop');
        const hs = L.surface.set({ lighting: { wrap: 0.5 }, detail: { noise: 'grain', strength: 0.2 } }, { owner: 'cave' });
        out.surface = [info().surface['lighting.wrap'].writer, info().surface.detail.writer, key('prop') !== kl];
        hs.remove();
        out.surfaceBack = [key('prop') === kl, info().surface['lighting.wrap']?.writer];
        out.badRim = err(() => L.surface.set({ lighting: { rim: { strength: 1 } } }));
        out.badRamp = err(() => L.surface.set({ ramp: [1] }));
        out.noReplace = err(() => L.surface.replace({}));
        // surface.patch('lighting' | 'detail', glsl): a lighting function, picked up by materials made after
        const glsl = 'void threedogLighting(inout ReflectedLight light, vec3 normal, vec3 viewDir, vec3 sunDir, float sunShadow, vec3 albedo){ light.directDiffuse *= 0.5; }';
        const hg = L.surface.patch('lighting', glsl, { owner: 'cave' });
        out.hook = [info().surface['hook:lighting'].writer, key('prop') !== kl];
        hg.remove(); out.hookBack = key('prop') === kl;
        out.verbs = [engine.catalog('look.materials').verbs, engine.catalog('look.surface').verbs];
        return out;
      });
      check('materials.set: describe game:<owner>, later materials take it, remove restores the style value', r.set[0] === 'game:cave' && r.set[1] && r.set[2] && r.setBack[0] && r.setBack[1] !== 'game:cave', JSON.stringify([r.set, r.setBack]));
      check('materials.add(name, patch, { roles }): only those roles change; remove restores', r.patch[0] === 'game:cave' && r.patch[1] && r.patchBack[0] && r.patchBack[1] === 'gone', JSON.stringify([r.patch, r.patchBack, r.typo]));
      check('materials.replace(role, Material): that role is the Material; null / remove gives it back', r.replace[0] === 'game:cave' && r.replace[1] === 7 && r.replaceBack, JSON.stringify([r.replace, r.replaceBack]));
      check('surface.set lighting / detail change the program of later materials; remove restores', r.surface[0] === 'game:cave' && r.surface[1] === 'game:cave' && r.surface[2] && r.surfaceBack[0], JSON.stringify([r.surface, r.surfaceBack]));
      check('surface: wrong values throw with the fix; replace is refused and points at materials.replace', /needs a color/.test(r.badRim) && /ramp/.test(r.badRamp) && /look-verb/.test(r.noReplace) && /materials\.replace/.test(r.noReplace), JSON.stringify([r.badRim, r.badRamp, r.noReplace]));
      check("surface.patch('lighting', glsl): describe game:<owner>, later materials change; remove restores", r.hook[0] === 'game:cave' && r.hook[1] && r.hookBack, JSON.stringify([r.hook, r.hookBack]));
      check('catalog lists the verbs: materials set / add / replace / glow / rebuild, surface set / patch', JSON.stringify(r.verbs) === '[["set","add","replace","glow","rebuild"],["set","patch"]]', JSON.stringify(r.verbs));
    },
  },
  {
    name: 'look no bypass: wind (frequency / amplitude / sway) and ground (shading / detail / material) via verbs; remove restores',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const L = engine.look, info = () => engine.describe().look, out = {}, u = engine.uniforms;
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        // wind
        const f0 = u.uWindFreq.value;
        const hw = L.wind.set({ amplitude: 0, frequency: 3 }, { owner: 'cave' });
        out.wind = [info().wind.amplitude.writer, u.uWindAmp.value, u.uWindFreq.value, info().wind.frequency.writer];
        hw.remove();
        out.windBack = [u.uWindAmp.value, u.uWindFreq.value === f0, info().wind.frequency.writer];
        out.badSway = err(() => L.wind.patch('sway', 'void nope(){}'));
        out.noReplace = err(() => L.wind.replace({}));
        const sway = 'void threedogWind(inout vec3 transformed, vec3 ip, vec3 position){ transformed.x += 0.1; }';
        const hs = L.wind.patch('sway', sway, { owner: 'cave' });
        out.sway = [info().wind['hook:sway'].writer];
        hs.remove(); out.swayBack = info().wind['hook:sway']?.writer ?? 'gone';
        // the amplitude multiplier is in the GLSL of a species added now
        const m = engine.makeMaterial('vegetation'); engine.applyEffects?.(m, { wind: 0.05 });
        // ground
        const G = L.ground, t0 = engine.terrainLook.material, k0 = t0.customProgramCacheKey();
        const sh0 = G.value('shading');
        const hg = G.set({ shading: sh0 === 'flat' ? 'smooth' : 'flat', detail: { noise: 'grain', strength: 0.2 } }, { owner: 'cave' });
        out.ground = [info().ground.shading.writer, info().ground.detail.writer, engine.terrainLook.material !== t0, engine.terrainLook.material.customProgramCacheKey() !== k0, typeof G.object === 'object'];
        hg.remove();
        out.groundBack = [G.value('shading') === sh0, info().ground.shading.writer !== 'game:cave', engine.terrainLook.material.customProgramCacheKey() === k0];
        out.badShading = err(() => G.set({ shading: 'fancy' }));
        out.badColors = err(() => G.set({ colors: 5 }));
        const mat = engine.terrainLook.material.clone();
        const hm = G.replace(mat, { owner: 'cave' });
        out.replace = [info().ground['@replace'].writer];
        hm.remove(); out.replaceBack = info().ground['@replace']?.writer !== 'game:cave';
        out.verbs = [engine.catalog('look.wind').verbs, engine.catalog('look.ground').verbs];
        return out;
      });
      check('wind.set: describe game:<owner>, uniforms follow, remove restores the style value', r.wind[0] === 'game:cave' && r.wind[1] === 0 && r.wind[2] === 3 && r.wind[3] === 'game:cave' && r.windBack[0] === 1 && r.windBack[1] && r.windBack[2] !== 'game:cave', JSON.stringify([r.wind, r.windBack]));
      check("wind.patch('sway', glsl): wrong function throws; right one shows game:<owner>; remove restores; replace refused", /threedogWind/.test(r.badSway) && r.sway[0] === 'game:cave' && r.swayBack !== 'game:cave' && /look-verb/.test(r.noReplace), JSON.stringify([r.badSway, r.sway, r.swayBack, r.noReplace]));
      check('ground.set (shading, detail): describe game:<owner>, the ground material is rebuilt, remove restores', r.ground[0] === 'game:cave' && r.ground[1] === 'game:cave' && r.ground[2] && r.ground[3] && r.ground[4] && r.groundBack[0] && r.groundBack[1] && r.groundBack[2], JSON.stringify([r.ground, r.groundBack]));
      check('ground: wrong values throw with the key; replace(Material) shows game:<owner> and remove gives it back', /shading/.test(r.badShading) && /colors/.test(r.badColors) && r.replace[0] === 'game:cave' && r.replaceBack, JSON.stringify([r.badShading, r.badColors, r.replace, r.replaceBack]));
      check('catalog lists the verbs: wind set / patch, ground set / patch / replace', JSON.stringify(r.verbs) === '[["set","patch"],["set","patch","replace"]]', JSON.stringify(r.verbs));
    },
  },
];
