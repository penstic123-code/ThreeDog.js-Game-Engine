// [guard] A real three.js camera in engine.camera. Everything that draws, picks or follows reads engine.camera at use, so a copy of the reference kept anywhere shows up here as a
// picture from the old camera: the page (tests/native-camera) reads pixels at the spot the assigned camera projects to, on WebGLRenderer and on WebGPURenderer.
const red = c => c[0] > c[1] + 25 && c[0] > c[2] + 25, blue = c => c[2] > c[0] + 25 && c[2] > c[1] + 25;
const near = (a, b, d = 1e-4) => Math.abs(a - b) <= d;

export const specs = ['webgl', 'webgpu'].flatMap(route => [
  {
    name: `[guard] engine.camera takes a real camera on ${route}: picture, post, pick, cascaded shadow, resize, swap back, other classes refused`,
    url: '/tests/native-camera/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(k => window.nativeCamera(k), route), J = JSON.stringify;
      console.log('  native camera numbers:', J(r));
      for (const k of ['ortho', 'persp', 'back']) {
        const m = r[k];
        check(`${k}: both boxes are where this camera projects them`, red(m.red) && blue(m.blue), J(m));
        check(`${k}: a pick at those spots hits the right box`, m.pickRed === 'red' && m.pickBlue === 'blue', J(m));
        check(`${k}: the cascaded shadow is drawn (> 0.5% of pixels change with the caster)`, m.shadow > 0.5, J(m));
        check(`${k}: the vignette darkens the corners through the rebuilt chain`, m.vignette > 5, J(m));
        check(`${k}: outline, a pass that draws with its own camera, draws at the box this camera shows`, m.outline.share > 0.3 && m.outline.close > 0, J(m));
      }
      check('a chain running across the assignment draws from the new camera, the same picture a fresh chain gives', red(r.running.red) && blue(r.running.blue) && r.running.diff < 0.5, J(r.running));
      check('the assigned object is engine.camera, a true OrthographicCamera', r.assigned.same && r.assigned.instance && r.ortho.real, J(r.assigned));
      check('describe says orthographic for it and perspective for the others', r.ortho.projection === 'orthographic' && r.persp.projection === 'perspective' && r.back.projection === 'perspective', J(r));
      check('assigning keeps the view height and fits the width to the 4:3 canvas', near(r.assigned.height, 18) && near(r.assigned.shape, 4 / 3), J(r.assigned));
      check('far and fov of a real orthographic camera stay the game\'s; no stray fov or aspect', r.left.far === 120 && !r.left.fov && !r.left.aspect, J(r.left));
      check('resize to 2:1 keeps the height, the width follows, the boxes stay in the picture', near(r.resized.height, 18) && near(r.resized.shape, 2) && r.resized.canvas[0] === 240 && red(r.resized.red) && blue(r.resized.blue), J(r.resized));
      check('assigning is no outside write: far, fov, aspect stay the engine\'s', Object.values(r.owned).every(w => w === 'engine'), J(r.owned));
      check('a real PerspectiveCamera gets the canvas aspect', near(r.perspAspect, 4 / 3), String(r.perspAspect));
      check('swapping back draws the first picture again and the aspect stayed right', r.backDiff < 0.5 && near(r.backAspect, 4 / 3), J([r.backDiff, r.backAspect]));
      check('a subclass, an ArrayCamera, a plain object and null are refused by code, and the camera stays', r.refused.every(c => c === 'camera-option') && r.afterRefused, J(r.refused));
      check('autoView.manual(\'aspect\') keeps the game\'s own frustum', near(r.manual, 1), String(r.manual));
      if (route === 'webgl') check('a chain under post.own() stays the game\'s, and follows at the hand-back', r.ownedChain === true && r.handedBack === true, J([r.ownedChain, r.handedBack]));
    },
  },
  {
    name: `[guard] rigs and pixelSnap go on with a real camera on ${route}`,
    url: '/tests/native-camera/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(k => window.nativeRig(k), route), J = JSON.stringify;
      console.log('  native rig numbers:', J(r));
      check('control: pixelSnap holds on the engine camera', r.engine.pixelSnap.agrees && near(r.engine.height, r.engine.rows), J(r.engine));
      check('a real ortho camera with its own height: no conflict, pixelSnap writes the height it needs', r.real.pixelSnap.agrees && near(r.real.height, r.real.rows), J(r.real));
      check('the rig places the real camera and the grid object goes on with it', r.sameGrid && r.real.pos.some(v => Math.abs(v) > 1) && r.cameraWriter === 'engine', J(r));
      check('the view corner sits on the art pixel lattice', r.onGrid.every(v => v < 1e-3), J(r.onGrid));
      check('resize: height from the new rows, width from the canvas', near(r.resized.height, r.resized.rows) && near(r.resized.shape, r.resized.canvas[0] / r.resized.canvas[1], 1e-3) && r.resized.pixelSnap.agrees, J(r.resized));
      check('a real perspective camera: the rig still places it, rounding stops and says so', !r.perspective.agrees && r.perspective.moved && r.perspective.writer === 'engine', J(r.perspective));
      check('the rig stays through the game\'s assignments', r.rigKept, J(r.rigKept));
      check('swap back: the first orthographic camera is back and pixelSnap agrees', r.back.pixelSnap.agrees && r.back.projection === 'orthographic' && near(r.back.height, r.back.rows), J(r.back));
      check('a rig that asks for orthographic over a real perspective camera shows a real one, and the game\'s comes back with the next perspective view', r.asked.real && near(r.asked.height, 10) && r.handedBack, J([r.asked, r.handedBack]));
    },
  },
  {
    name: `[guard] a real camera beside what the game draws on ${route}: offscreen targets, a split view, one final output, resize, a hook or a draw that throws`,
    url: '/tests/native-camera/index.html',
    software: true,
    expectErrors: /pipeline (hook|draw) boom/,
    async run({ check, ev }) {
      const r = await ev(k => window.nativePipeline(k), route), J = JSON.stringify;
      const isRed = pair => pair.some(red), wrote = n => n === 1;
      check('the final picture is written once a frame, with the post chain and with offscreen draws too', Object.values(r.finals).every(wrote), J(r.finals));
      check('a target drawn from a hook holds the assigned camera\'s picture and a second camera\'s', isRed(r.off.main) && isRed(r.off.top) && r.off.camera, J(r.off));
      check('those draws leave the canvas picture as it was, and the target is put back', r.off.canvasDiff < 0.5 && r.off.target, J(r.off));
      check('a split view: the corner shows its own camera, the rest the main one, and the engine keeps the frame', blue(r.split.insetBlue) && red(r.split.mainRed) && !r.split.yielded && r.split.diffLeftHalf === 0, J(r.split));
      check('resize with both running: the boxes stay in the picture at the new shape', r.resized.canvas[0] === 320 && red(r.resized.red) && blue(r.resized.blue) && near(r.resized.shape, 320 / 120), J(r.resized));
      check('the picture comes back whole after the corner goes', r.afterSplit < 0.5, J(r.afterSplit));
      for (const when of ['before', 'after']) {
        check(`a hook ${when} the frame that throws holding target, viewport, scissor, overrideMaterial and layers: the state comes back`, J(r[when].state) === J(r.before0), J([r[when].state, r.before0]));
        check(`and the next picture is whole (${when})`, red(r[when].moved), J(r[when]));
      }
      // shortcut: three's WebGPURenderer keeps its open pass and call depth across a throw inside render(), with nothing public to end them, so the picture stops there. The error is reported; pinned so a three update that mends it is seen
      for (const k of ['draw', 'drawPost']) {
        if (route === 'webgl') check(`a draw that throws inside the frame leaves the next one whole (${k})`, red(r[k].moved) && r[k].diff < 0.5, J(r[k]));
        else check(`known limit: after a throw inside three's draw WebGPURenderer shows no new picture (${k})`, !red(r[k].moved), J(r[k]));
      }
      check('the sound listener follows a real orthographic camera', r.listener.at.every((v, i) => near(v, r.listener.want[i])) && r.listener.look.every((v, i) => near(v, r.listener.wantLook[i])), J(r.listener));
    },
  },
  {
    name: `[guard] a rig's projection against the real camera on ${route}: the wheel, a camera assigned during a shot, no frame throws`,
    url: '/tests/native-camera/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(k => window.nativeProjection(k), route), J = JSON.stringify;
      check('the wheel on a perspective rig changes a real orthographic camera\'s view height', near(r.wheelOut, 1.1) && near(r.wheelIn, 1.1 * 0.9 * 0.9), J(r));
      check('it stops at the rig\'s distance ratio, as an orthographic rig does', near(r.wheelMax, 2) && near(r.wheelMin, 0.5) && r.distanceStill === 20, J(r));
      check('fixed with a size on a real perspective camera shows a real orthographic one, and the game\'s comes back', r.oneShot.real && near(r.oneShot.height, 10) && r.oneShotBack, J(r));
      check('a size works on a real orthographic camera', near(r.onOrtho, 10), J(r));
      check('no frame throws when the camera changes under the shot, and nothing needs saying', r.frames.threw === null && r.frames.error === null && r.frames.told === 0, J(r.frames));
      check('a perspective camera assigned during a shot stays, and the rig places it', r.assigned.stays && r.assigned.shot === 'wide' && r.assigned.placed[1] === 12, J(r.assigned));
      check('the next shot asks for its own view, by nearest shot or trigger zone', r.moved.shot === 'close' && r.moved.ortho && near(r.moved.height, 6) && r.zone.shot === 'wide' && near(r.zone.height, 10), J(r));
      check('a shot with no size hands the game\'s camera back', r.plain.shot === 'plain' && r.plain.back, J(r.plain));
      check('a cut on a real orthographic camera sets its height', near(r.backHeight, 6), J(r));
    },
  },
  {
    name: `[guard] a rig's projection swaps real cameras on ${route}: one view, shots mixed, what the view carries goes with it`,
    url: '/tests/native-camera/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(k => window.nativeSwap(k), route), J = JSON.stringify;
      const f = r.flat, b = r.back;
      check('an orthographic shot is a true OrthographicCamera in engine.camera, not a camera acting as one', f.real && f.swapped && r.flags.perspectiveIsNot && r.flags.orthoIsNot, J([f, r.flags]));
      check('picture, pick and describe all follow it', red(f.red) && blue(f.blue) && f.pick === 'red' && f.projection === 'orthographic' && near(f.orthoSize, 18, 0.1) && near(f.height, 18) && near(f.shape, 4 / 3), J(f));
      check('what the game hung on the camera, its parent, layers, zoom and pose go with the view', r.carried.hung && r.carried.parent && r.carried.layer && r.carried.zoom === 1.25 && r.carried.pos, J(r.carried));
      check('the view range still reaches it, and goes back with the swap', r.far === 9000 && b.far === 9000, J([r.far, b.far]));
      check('size blends between two orthographic shots on the one camera', r.mid < 18 && r.mid > 9 && near(r.end, 9) && r.same, J([r.mid, r.end, r.same]));
      check('a perspective shot brings the first camera back with what it carries, on the canvas shape', b.own && b.hung && b.parent && b.layer && near(b.aspect, b.canvas), J(b));
      check('a shot with no fov comes back to that camera\'s own, not the last shot\'s', b.fov === b.fov0, J(b));
      check('one orthographic camera serves every shot', r.reused, J(r.reused));
      check('a swap is no outside write: camera, far, fov, aspect stay the engine\'s', Object.values(r.owned).every(w => w === 'engine'), J(r.owned));
    },
  },
]);
