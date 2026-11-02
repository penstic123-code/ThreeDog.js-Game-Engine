// Follow camera looking up (presets.camera.thirdPersonAction): judged by the view. A real mouse moves up, then a ray from the camera centre must hit
// a marker placed high in front of the player, on flat ground, on a roof, at a roof edge and next to a wall. Page: tests/camera-look.

const URL = '/tests/camera-look/index.html';

/** Lock the pointer with a real click (fall back to dragging if the browser refuses), then move the mouse up `px` pixels */
async function setupMouse(page, ev) {
  const box = await page.locator('#view').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  const locked = await ev(() => __t.until(() => document.pointerLockElement === engine.renderer.domElement, 3000).then(() => true, () => false));
  return { cx, cy, locked };
}
async function lookUp(page, m, frames, px = 420) {
  await page.mouse.move(m.cx, m.cy);
  if (!m.locked) await page.mouse.down();
  for (let i = 1; i <= 21; i++) { await page.mouse.move(m.cx, m.cy - px * i / 21); if (i % 3 === 0) await frames(1); }
  if (!m.locked) await page.mouse.up();
  await frames(6);
}

export const specs = [
  {
    name: 'Follow camera looks up ~60° by the view (thirdPersonAction): a high marker sits at the screen centre on ground, roof, roof edge, by a wall',
    url: URL,
    async run({ page, check, ev, frames }) {
      const m = await setupMouse(page, ev);
      for (const name of ['ground', 'roof', 'roofEdge', 'wall']) {
        await page.mouse.move(m.cx, m.cy);   // mouse back to the middle (looks down, then the scene resets pitch)
        await frames(2);
        await ev(n => window.scene(n), name);
        await frames(8);
        const before = await ev(() => window.view());
        if (name === 'wall') {
          check('wall: the wall behind pulls the arm in (shorter than 4.5 m)', before.arm < 4.4, JSON.stringify(before));
          check('wall: the camera is right behind the head, so the player is hidden and does not fill the screen centre', before.playerHidden && before.first !== 'player', JSON.stringify(before));
        }
        await lookUp(page, m, frames);
        const v = await ev(() => window.view());
        check(`${name}: mouse up turns the view up at least 50° (pointer ${m.locked ? 'locked' : 'dragged'})`, v.upDeg >= 50, JSON.stringify(v));
        check(`${name}: the ray from the camera centre hits the high marker first`, v.first === 'marker', JSON.stringify(v));
        check(`${name}: the camera stays above the ground under it`, v.camY > v.groundUnder + 0.1, JSON.stringify(v));
      }
    },
  },
  {
    name: "Follow camera ground: 'raise' cannot look up from flat ground (the control case), a function decides, a wrong name throws",
    url: URL + '?ground=raise',
    async run({ page, check, ev, frames }) {
      const m = await setupMouse(page, ev);
      await ev(() => window.scene('ground')); await frames(8);
      await lookUp(page, m, frames);
      const v = await ev(() => window.view());
      check("raise: same mouse, flat ground: the view stays low and misses the marker (this is the old problem the test must see)", v.upDeg < 45 && v.first !== 'marker', JSON.stringify(v));
      const r = await ev(async () => {
        const out = {};
        let facts = null;
        engine.setCamera('follow', { ...window.presets.camera.thirdPersonAction, ground: f => { facts = f; return { x: f.position.x, y: 50, z: f.position.z }; } });
        await __t.frames(3);
        out.fnY = Math.round(engine.camera.position.y); out.factKeys = facts && ['position', 'lookPoint', 'dir', 'arm', 'distance', 'groundY', 'clearance', 'surface', 'rig'].every(k => k in facts);
        try { engine.setCamera('follow', { ground: 'lift' }); out.err = ''; } catch (e) { out.err = e.message; }
        return out;
      });
      check('ground: fn gets the facts and its returned position is used', r.fnY === 50 && r.factKeys, JSON.stringify(r));
      check("ground: 'lift' throws and lists the choices", /shorten/.test(r.err) && /raise/.test(r.err), r.err);
    },
  },
  {
    name: 'Follow camera external view control: setView clamps, getView reports, mouseLook: false ignores the mouse',
    url: URL,
    async run({ page, check, ev, frames }) {
      const m = await setupMouse(page, ev);
      await ev(() => window.scene('ground')); await frames(4);
      const r = await ev(async () => {
        const rig = engine.cameraRig;
        rig.setView({ yaw: 1, pitch: -5, distance: 100 });
        const out = { pitch: rig.pitch, distance: rig.distance, yaw: rig.yaw };
        await __t.frames(4);
        const v = rig.getView();
        out.keys = ['yaw', 'pitch', 'distance', 'arm', 'lookPoint', 'look'].every(k => k in v);
        out.lookUp = v.look.y > 0.5;
        rig.mouseLook = false; rig.setView({ pitch: 0.3 });
        return out;
      });
      check('setView clamps pitch to minPitch and distance to maxDistance, keeps yaw', r.pitch === -1.05 && r.distance === 9 && r.yaw === 1, JSON.stringify(r));
      check('getView reports yaw / pitch / distance / arm / lookPoint / look, and look points up after setView({ pitch: min })', r.keys && r.lookUp, JSON.stringify(r));
      await lookUp(page, m, frames);
      const p = await ev(() => engine.cameraRig.pitch);
      check('mouseLook: false: moving the mouse leaves the pitch the game set', p === 0.3, String(p));
    },
  },
];
