// 运行时切换相机 engine.setCamera：身体显示、视角、鼠标锁定、参数保留、写错报错。页面是 tests/cameras（follow 起步）。

export const specs = [
  {
    name: '相机切换：follow ↔ firstPerson ↔ rts，目标和朝向接着走、身体显示 / 视角恢复、切回参数还在、写错名字列出可选项',
    url: '/tests/cameras/index.html?cam=follow',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const P = engine.player, meshes = [];
        P.root.traverse(o => { if (o.isMesh) meshes.push(o); });
        const visible = () => meshes.length > 0 && meshes.every(m => engine.camera.layers.test(m.layers));
        const fov0 = engine.camera.fov;
        engine.step(0.3);
        engine.cameraRig.distance = 20; engine.cameraRig.yaw = 1.1;
        const out = { kind0: engine.cameraRig.kind, vis0: visible() };
        engine.setCamera('firstPerson', { fov: 80, height: 1.7 });
        engine.step(0.3);
        out.kind1 = engine.cameraRig.kind; out.vis1 = visible(); out.fov1 = engine.camera.fov;
        out.target1 = engine.cameraRig.target === P.root; out.yaw1 = +engine.cameraRig.yaw.toFixed(3);
        out.desc1 = engine.describe().camera.type;
        out.eye = +(engine.camera.position.y - P.position.y).toFixed(1);
        engine.setCamera('rts');
        engine.step(0.3);
        out.kind2 = engine.cameraRig.kind; out.vis2 = visible(); out.fov2 = engine.camera.fov === fov0;
        engine.setCamera('follow');
        engine.step(0.3);
        out.kind3 = engine.cameraRig.kind; out.vis3 = visible(); out.fov3 = engine.camera.fov === fov0;
        out.distance3 = engine.cameraRig.distance;
        out.fwdOk = Math.abs(engine.cameraRig.forward().x + Math.sin(1.1)) < 1e-6;
        try { engine.setCamera('thirdPerson'); out.err = ''; } catch (e) { out.err = e.message; }
        out.kindAfterErr = engine.cameraRig.kind;
        return out;
      });
      check('起步是 follow，身体可见', r.kind0 === 'follow' && r.vis0, JSON.stringify(r));
      check('切 firstPerson：种类、跟随目标、朝向接着、视角用新参数、身体从相机里藏起来', r.kind1 === 'firstPerson' && r.target1 && r.yaw1 === 1.1 && r.fov1 === 80 && !r.vis1 && r.desc1 === 'firstPerson', JSON.stringify(r));
      check('眼睛高度用新参数 1.7', Math.abs(r.eye - 1.7) < 0.2, JSON.stringify(r));
      check('切 rts：身体显示回来、视角恢复', r.kind2 === 'rts' && r.vis2 && r.fov2, JSON.stringify(r));
      check('切回 follow：身体可见、视角恢复、缩放距离还是 20、朝向接着', r.kind3 === 'follow' && r.vis3 && r.fov3 && r.distance3 === 20 && r.fwdOk, JSON.stringify(r));
      check('种类写错报错列出可选项；失败时相机不变', /firstPerson/.test(r.err) && /thirdPerson/.test(r.err) && r.kindAfterErr === 'follow', JSON.stringify(r));
    },
  },
  {
    name: 'RtsCamera 起点在岛外（surface 是 -Infinity）：不崩，焦点 y 退回 0',
    url: '/tests/cameras/index.html?cam=follow',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        engine.setGround({ height: x => x > 1000 ? -Infinity : 0, has: x => x <= 1000 });
        let err = null; try { engine.setCamera('rts', { start: { x: 2000, z: 0 } }); engine.step(0.1); } catch (e) { err = e.message; }
        const f = engine.camera.position;
        return { err, finite: [f.x, f.y, f.z].every(Number.isFinite) };
      });
      check('rts 相机起点在岛外：不抛错，相机位置有限', r.err === null && r.finite, JSON.stringify(r));
    },
  },
  {
    name: '正交相机：fixed 单镜头 projection orthographic，世界点落在预期屏幕位置，切回透视恢复',
    url: '/tests/cameras/index.html?cam=follow',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const errs = []; const oe = console.error; console.error = (...a) => { errs.push(a.join(' ')); oe(...a); };
        const cam = engine.camera, V = cam.position.constructor, out = {};
        const ndc = (x, y, z) => { cam.updateMatrixWorld(); return new V(x, y, z).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix); };
        engine.setCamera('fixed', { position: [0, 10, 10], lookAt: [0, 0, 0], projection: 'orthographic', size: 10 });
        engine.step(0.1);
        out.ortho = cam.isOrthographicCamera === true && cam.isPerspectiveCamera === false;
        const a = cam.aspect, p = ndc(2, 0, 0), up = ndc(0, 0, -3);
        out.x = +p.x.toFixed(3); out.wantX = +(2 / (5 * a)).toFixed(3);
        out.centre = Math.abs(ndc(0, 0, 0).x) < 1e-6 && Math.abs(ndc(0, 0, 0).y) < 1e-6;
        out.upY = +up.y.toFixed(3);   // 3 m farther from the camera along the ground is 3 * sin(45deg) up the screen: 2.12 / 5
        out.parallel = Math.abs(ndc(0, 0, 0).x - ndc(0, 0, 5).x) < 1e-6;   // no perspective: depth does not change the x position
        engine.step(0.1);
        out.desc = engine.describe().camera.type;
        engine.setCamera('follow');
        engine.step(0.1);
        out.back = cam.isPerspectiveCamera === true && !cam.orthoSize;
        console.error = oe; out.errs = errs.length;
        return out;
      });
      check('正交标记生效、屏幕中心不偏', r.ortho && r.centre, JSON.stringify(r));
      check('世界 x=2 落在 ndc.x = 2/(size/2*aspect)；沿地面远 3 米在屏幕上移 2.12/5', Math.abs(r.x - r.wantX) < 2e-3 && Math.abs(r.upY - 0.424) < 2e-3, JSON.stringify(r));
      check('正交无透视：深度不影响 x；渲染期间无 console.error；切回 follow 恢复透视', r.parallel && r.errs === 0 && r.back, JSON.stringify(r));
    },
  },
  {
    // 没装相机模块的场景（没 openWorld、没玩家）：setCamera 以前是 undefined，报 "setCamera is not a function"，不说怎么修
    name: '相机切换：没装相机模块时 setCamera 报带代码的错，说出要先 engine.use(fixedCamera(...))',
    url: '/tests/lights/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const out = { rig: !!engine.cameraRig };
        try { engine.setCamera('fixed', { position: [10, 10, 10], lookAt: [0, 0, 0] }); out.err = ''; } catch (e) { out.err = e.message; out.code = e.code; }
        return out;
      });
      check('[guard] 无相机模块：报 camera-none，消息点名 engine.use(fixedCamera({ position, lookAt }))', !r.rig && r.code === 'camera-none'
        && /engine\.use\(fixedCamera\(\{ position, lookAt \}\)\)/.test(r.err), JSON.stringify(r));
    },
  },
];
