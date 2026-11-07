// 屏幕空间环境光遮蔽（@threedog/post-effects 的 ao，three 的 GTAOPass）：开了墙角变暗、空地不变，describe 看得到参数，
// 关掉恢复原图，改尺寸 / 像素比 / MSAA 不坏，移除后显存回到原数。
// 在 perf city 页面里临时搭一个"地面 + 墙"的直角，其余物体先藏起来，测完全部还原。

export const specs = [
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: '[守] 后期 ao：墙角变暗、空地不变；describe 显示参数；关掉恢复；改尺寸 / 像素比 / MSAA 不报错；移除后纹理数回到原数',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, postEffects: E } = threedogTest, p = engine.post, R = engine.renderer, gl = R.getContext(), sc = engine.scene, cam = engine.camera;
        const out = {}, css0 = R.getSize(new THREE.Vector2()), pr0 = R.getPixelRatio(), aa0 = p.antialias;
        const W = 200, H = 150;
        // 藏起页面原有的东西，只留一个直角：地面 y=0，墙面在 z=-2（为什么用半球光：均匀照明，明暗差只来自 AO）
        const hidden = sc.children.filter(o => o.visible); hidden.forEach(o => { o.visible = false; });
        const fog0 = sc.fog, bg0 = sc.background; sc.fog = null; sc.background = new THREE.Color(0x808080);
        const camState = { pos: cam.position.clone(), quat: cam.quaternion.clone(), aspect: cam.aspect };
        const mat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 1 });
        const g = new THREE.Group();
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), mat); floor.rotation.x = -Math.PI / 2;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 1), mat); wall.position.set(0, 3, -2.5);
        g.add(floor, wall, new THREE.HemisphereLight(0xffffff, 0xffffff, 2)); sc.add(g);
        const size = (w, h, pr = 1) => { engine.setPixelRatio(pr); R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
        size(W, H); p.antialias = false;
        cam.position.set(0, 2.2, 3); cam.lookAt(0, 0, -2); cam.updateMatrixWorld();
        const read = (w = W, h = H) => { const b = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
        const shot = () => { p.render(0.016); return read(); };
        // 某个世界点在画面上那一行附近（±2 行、中间 60% 宽）的平均亮度
        const rowOf = v => Math.round((v.clone().project(cam).y * 0.5 + 0.5) * H);
        const band = (px, row) => { let s = 0, n = 0; for (let y = row - 2; y <= row + 2; y++) for (let x = W * 0.2 | 0; x < W * 0.8; x++) { const i = (y * W + x) * 4; s += px[i] + px[i + 1] + px[i + 2]; n += 3; } return s / n; };
        const corner = rowOf(new THREE.Vector3(0, 0.02, -2)), open = rowOf(new THREE.Vector3(0, 0, -0.3));
        out.rows = [corner, open];
        const off = shot();
        const tex0 = R.info.memory.textures;
        const h = p.add(E.ao({ enabled: true }));
        const on = shot();
        out.cornerDarken = band(off, corner) - band(on, corner);
        out.openDarken = band(off, open) - band(on, open);
        out.err1 = gl.getError();
        out.describe = engine.describe().render.post.find(x => x.name === 'ao');
        out.text = engine.describe().render.text;
        // 参数：radius 变大，墙角变暗的范围更宽；intensity 0 等于没开
        p.get('ao').set({ radius: 1 });
        const wide = shot(); out.wideDarkenAbove = band(off, corner + 8) - band(wide, corner + 8); out.narrowDarkenAbove = band(off, corner + 8) - band(on, corner + 8);
        p.get('ao').set({ radius: 0.25, intensity: 0 });
        const zero = shot(); out.zeroDiff = Math.abs(band(off, corner) - band(zero, corner));
        p.get('ao').set({ intensity: 1 });
        // 关掉恢复原图
        p.get('ao').enabled = false;
        const back = shot(); let maxD = 0; for (let i = 0; i < off.length; i++) maxD = Math.max(maxD, Math.abs(off[i] - back[i])); out.restoreMax = maxD;
        p.get('ao').enabled = true;
        // 改尺寸、像素比、MSAA：pass 跟着画布的设备像素走，墙角仍变暗
        const pass = p.composer.passes.find(x => x.gtaoMaterial);
        size(120, 90, 1.5); p.render(0.016);
        out.resized = [pass.width, pass.height, pass.normalRenderTarget.width];
        p.antialias = true; size(W, H);
        const msaa = shot(); out.msaaDarken = band(off, corner) - band(msaa, corner); p.antialias = false;
        out.err2 = gl.getError();
        // 移除：GTAOPass 自己的 3 个目标 + 2 张噪声图都放掉
        out.texOn = R.info.memory.textures;
        h.remove(); p.render(0.016);
        out.texOff = R.info.memory.textures; out.tex0 = tex0;
        // 还原页面
        g.removeFromParent(); floor.geometry.dispose(); wall.geometry.dispose(); mat.dispose();
        hidden.forEach(o => { o.visible = true; }); sc.fog = fog0; sc.background = bg0;
        cam.position.copy(camState.pos); cam.quaternion.copy(camState.quat);
        engine.setPixelRatio(pr0); R.setSize(css0.x, css0.y, false); cam.aspect = camState.aspect; cam.updateProjectionMatrix();
        p.antialias = aa0;
        return out;
      });
      const j = JSON.stringify(r);
      check('开 ao：墙角那一行明显变暗（> 3 级）', r.cornerDarken > 3, j);
      check('开阔地面几乎不变（< 2 级）', Math.abs(r.openDarken) < 2, j);
      check('describe().render.post 显示 ao 开着和它的参数', r.describe?.on === true && r.describe.params.radius === 0.25 && r.describe.params.intensity === 1 && /ao\{/.test(r.text), j);
      check('ao.radius 变大：墙角上方更远处也变暗', r.wideDarkenAbove > r.narrowDarkenAbove + 2, j);
      check('ao.intensity 0：和没开一样', r.zeroDiff < 0.5, j);
      check('关掉后与原图逐像素一致（差 ≤ 1 级）', r.restoreMax <= 1, j);
      check('改尺寸 + 像素比 1.5：pass 尺寸是设备像素 180x135', r.resized.join() === '180,135,180', j);
      check('开 MSAA 墙角仍变暗', r.msaaDarken > 3, j);
      check('全程没有 GL 错误', r.err1 === 0 && r.err2 === 0, j);
      check('移除 ao 后纹理数回到加之前', r.texOff === r.tex0 && r.texOn > r.tex0, j);
    },
  },
];
