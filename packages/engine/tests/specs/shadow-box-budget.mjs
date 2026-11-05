// engine.shadows.box and engine.shadows.budget on a light the game made: only that light moves, its direction stays the game's, remove() puts everything back.
export const specs = [
  {
    name: '[guard] shadow box and budget on a game light: the box follows, the direction stays the game\'s, a light nobody handed in is untouched, remove() gives all back',
    url: '/tests/lights/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.haltLoop();
        const T = __threedogThree, light = new T.DirectionalLight(0xffffff, 1), goal = new T.Object3D(), mover = new T.Object3D();
        light.position.set(10, 20, 5); light.target = goal; engine.scene.add(light, goal, mover);
        const other = new T.DirectionalLight(0xffffff, 0.5); engine.scene.add(other);
        const sc = light.shadow.camera, was = sc.right, err = f => { try { f(); return ''; } catch (x) { return String(x.message); } };
        const box = engine.shadows.box(light, { follow: mover, extent: 5, snap: 0 });
        mover.position.set(30, 0, 40); engine.step(1 / 60);
        const dirOf = () => light.position.clone().sub(light.target.position).normalize().toArray().map(v => +v.toFixed(4));
        const out = { extent: sc.right, center: light.target.position.toArray(), gameTarget: goal.position.toArray(), dir: dirOf(), otherPos: other.position.toArray() };
        light.position.set(-10, 20, 5); engine.step(1 / 60);
        out.dir2 = dirOf(); out.center2 = light.target.position.toArray();
        out.twice = err(() => engine.shadows.box(light)); out.point = err(() => engine.shadows.box(new T.PointLight()));
        const budget = engine.shadows.budget(light, { every: 3 });
        out.budget = { own: light.shadow.autoUpdate, other: other.shadow.autoUpdate, again: err(() => engine.shadows.budget(light)) };
        let asks = 0;
        for (let i = 0; i < 6; i++) { light.shadow.needsUpdate = false; engine.step(1 / 60); if (light.shadow.needsUpdate) asks++; }
        out.budget.asks = asks;
        budget.remove(); box.remove();
        out.back = { pos: light.position.toArray(), target: light.target === goal, extent: sc.right === was, auto: light.shadow.autoUpdate };
        engine.scene.remove(light, goal, mover, other);
        return out;
      });
      check('[guard] box: the half size is written on the shadow camera and the center is the followed object', r.extent === 5 && r.center.join() === '30,0,40', JSON.stringify(r));
      check('[guard] box: the game\'s target is not moved and the light keeps the direction the game gave it', r.gameTarget.join() === '0,0,0' && r.dir[0] > 0 && Math.abs(r.dir[1] / r.dir[0] - 2) < 0.01, JSON.stringify(r));
      check('[guard] box: a later write to light.position sets the direction, the center stays on the object', r.dir2[0] < 0 && r.center2.join() === '30,0,40', JSON.stringify(r));
      check('[guard] a light nobody handed in is untouched', r.otherPos.join() === '0,1,0' && r.budget.other === true, JSON.stringify(r));
      check('[guard] a second box, a second budget and a non-directional box fail by name', /already/.test(r.twice) && /already/.test(r.budget.again) && /DirectionalLight/.test(r.point), JSON.stringify(r));
      check('[guard] budget: every 3 hands the redraw to the light\'s own flags, twice in 6 frames', r.budget.own === false && r.budget.asks === 2, JSON.stringify(r.budget));
      check('[guard] remove() gives back position (with the game\'s last write), target, shadow camera and autoUpdate', r.back.pos.join() === '-10,20,5' && r.back.target && r.back.extent && r.back.auto, JSON.stringify(r.back));
    },
  },
];
