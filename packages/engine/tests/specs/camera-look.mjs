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
    name: "Follow camera ground: 'shorten' sees a 0.25 m bump in the middle of an 8 m arm (between the old 12 samples), at a small per-frame cost",
    url: URL,
    async run({ check, ev, frames }) {
      await ev(() => window.scene('bump'));
      await ev(() => { engine.cameraRig.setView({ yaw: 0, pitch: 0.2, distance: 8 }); engine.cameraRig._d = undefined; });
      await frames(8);
      const v = await ev(() => window.view());
      check('bump: the arm stops in front of the bump (about 4.1 m out), not the full 8 m', v.arm > 3 && v.arm < 4.15, JSON.stringify(v));
      const t = await ev(() => {
        const rig = engine.cameraRig, surf = (x, z) => engine.surface(x, z, 1.6), n = 2000;
        const time = d => { const t0 = performance.now(); for (let i = 0; i < n; i++) rig._shorten(0.5, 1.6, 0, 0, 0.2, 0.98, d, surf); return (performance.now() - t0) / n; };
        time(8);   // warm up
        return { ms8: time(8), ms40: time(40) };
      });
      // a clear arm is the most samples (no early stop): 40 at 8 m, the cap at 40 m. Software-rendered CI is slow, so the bound is loose
      check('cost: one clear-arm check stays well under a millisecond (8 m and a capped 40 m arm)', t.ms8 < 0.5 && t.ms40 < 1, JSON.stringify(t));
    },
  },
  {
    name: 'Follow camera in a forest: tree colliders with occluder: false keep the full arm, the same ring without it pulls the camera in',
    url: URL,
    async run({ check, ev, frames }) {
      // 16 trunks (r 0.4) on a 4 m ring round the player: with the camera pad they close every gap, so a blocking ring always catches the arm
      const armWith = async occluder => {
        await ev(o => {
          window.scene('forest');
          const p = engine.player.position;
          window._ring = Array.from({ length: 16 }, (_, i) => engine.collision.addCircle([p.x + 4 * Math.cos(i * Math.PI / 8), 0, p.z + 4 * Math.sin(i * Math.PI / 8)], { radius: 0.4, ...(o === null ? {} : { occluder: o }) }));
          engine.cameraRig.setView({ yaw: 0.3, pitch: 0.2, distance: 8 }); engine.cameraRig._d = undefined;
        }, occluder);
        await frames(8);
        return ev(() => { const v = window.view(); window._ring.forEach(h => h.remove()); return v; });
      };
      const off = await armWith(false), on = await armWith(null);
      check('occluder: false: the arm keeps its full 8 m', off.arm > 7.9, JSON.stringify(off));
      check('default (blocks the camera): the arm stops before the 4 m ring', on.arm < 4, JSON.stringify(on));
    },
  },
  {
    name: 'Follow camera external view control:setView clamps, getView reports, mouseLook: false ignores the mouse',
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
