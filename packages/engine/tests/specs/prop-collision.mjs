// Collision of content props and templates (recipes/30-templates.md). Same style as the other files here.
// Guard: a circle stands on the model's base, not on its widest extent: an arm or a crown above the base blocks nobody and does not pull the follow camera in.
// Everything goes through content.load and the real collision module, so a second way of sizing the circle fails here.
const models = () => {
  const T = engine.THREE, part = (g, x, y) => new T.Mesh(g.translate(x, y, 0));
  const group = (...m) => { const o = new T.Group(); o.add(...m); return o; };
  engine.assets.manifest({ name: 'pc', models: {
    // the pole stands on the origin, the arm reaches 1.8 m to +x at the top: bounds are 1.9 m wide and centred 0.8 m off the pole
    pcLamp: () => group(part(new T.CylinderGeometry(0.1, 0.1, 5, 12), 0, 2.5), part(new T.BoxGeometry(1.8, 0.1, 0.1), 0.9, 4.9)),
    pcTree: () => group(part(new T.CylinderGeometry(0.3, 0.3, 2.5, 12), 0, 1.25), part(new T.SphereGeometry(1.7, 12, 8), 0, 3.5)),
    pcCrate: () => part(new T.BoxGeometry(2, 2, 1), 0, 1),
    pcBoulder: () => new T.IcosahedronGeometry(0.8, 0),           // centred on y = 0: the lower half is under the ground
    pcLantern: () => part(new T.BoxGeometry(0.6, 0.6, 0.6), 0, 2.3),   // nothing near the ground
    pcOffset: () => part(new T.BoxGeometry(1, 3, 1), 2, 1.5),     // stands 2 m beside its origin
  } });
};

export const specs = [
  {
    name: "Prop collision: a circle stands on the model's base, { circle, occluder } sets it from a template or a prop, a mistyped collide is refused, a box keeps its bounds [guard]",
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async src => {
        engine.pause();
        (0, eval)(src)();
        const p = engine.player.position, x = Math.round(p.x), z = Math.round(p.z), W = engine.world, at = (i, o) => ({ x: x + 5 + i * 6, z: z + 8, ...o });
        engine.content.load({
          templates: {
            pcLampT: { model: 'pcLamp', collide: 'circle' }, pcTreeT: { model: 'pcTree', collide: 'circle' }, pcCrateT: { model: 'pcCrate', collide: 'box' },
            pcThinT: { model: 'pcLamp', collide: { circle: 0.25, occluder: false } }, pcSolidT: { model: 'pcLamp', collide: { circle: 0.25 } },
          },
          props: [
            { template: 'pcLampT', id: 'pc-lamp', ...at(0) }, { template: 'pcTreeT', id: 'pc-tree', ...at(1) }, { template: 'pcCrateT', id: 'pc-crate', ...at(2) },
            { template: 'pcThinT', id: 'pc-thin', ...at(3), scale: 2 }, { template: 'pcSolidT', id: 'pc-solid', ...at(4) },
            { id: 'pc-prop', model: 'pcLamp', collide: { circle: 0.3, occluder: false }, ...at(5) },
            { id: 'pc-boulder', model: 'pcBoulder', collide: 'circle', ...at(6) }, { id: 'pc-lantern', model: 'pcLantern', collide: 'circle', ...at(7) },
            { id: 'pc-turned', model: 'pcOffset', collide: 'circle', rot: Math.PI / 2, scale: 2, ...at(8) },
          ],
        });
        engine.step(0.5); await W.whenReady; engine.step(0.1);
        const circle = (id, i) => {
          const h = W.view(id)?.userData.colliders[0], near = [...engine.collision.circles].filter(c => Math.hypot(c.x - (x + 5 + i * 6), c.z - (z + 8)) < 6);
          return { ok: !!h, near: near.map(c => ({ dx: +(c.x - (x + 5 + i * 6)).toFixed(3), dz: +(c.z - (z + 8)).toFixed(3), r: +c.r.toFixed(3), h: +c.h.toFixed(2), occ: c.occ })) };
        };
        const free = (dx, i = 0) => engine.collision.walkable([x + 5 + i * 6 + dx, 0, z + 8]);
        const refused = content => { try { engine.content.load(content); return null; } catch (e) { return e.message; } };
        const box = [...engine.collision.boxes].filter(b => Math.hypot(b.x - (x + 17), b.z - (z + 8)) < 3).map(b => ({ hw: b.hw, hd: b.hd, h: b.h }));
        return {
          lamp: circle('pc-lamp', 0), tree: circle('pc-tree', 1), thin: circle('pc-thin', 3), solid: circle('pc-solid', 4), prop: circle('pc-prop', 5),
          boulder: circle('pc-boulder', 6), lantern: circle('pc-lantern', 7), turned: circle('pc-turned', 8), box,
          walk: { underArm: free(1), onPole: free(0), besideTree: free(1, 1) },
          bad: { template: refused({ templates: { pcBad: { model: 'pcLamp', collide: { circl: 0.25 } } } }), zero: refused({ templates: { pcBad2: { model: 'pcLamp', collide: { circle: 0 } } } }),
            prop: refused({ props: [{ id: 'pc-bad', model: 'pcLamp', x, z, collide: { circle: 0.25, occluder: 'no' } }] }), word: refused({ templates: { pcBad3: { model: 'pcLamp', collide: 'sphere' } } }) },
          saved: Object.keys(W.toJSON().changed).filter(k => k.startsWith('pc-')),
          explained: engine.thing('pc-thin').explain().rules.blocksMovement,
        };
      }, models.toString().replace(/^\(\) => /, '() => '));
      const one = c => c.near.length === 1 ? c.near[0] : {}, J = JSON.stringify;
      const lamp = one(r.lamp), tree = one(r.tree), thin = one(r.thin), solid = one(r.solid), prop = one(r.prop), boulder = one(r.boulder), lantern = one(r.lantern), turned = one(r.turned);
      check('default circle of a lamp: the pole\'s radius on the pole, full height (the arm adds neither width nor an offset)', lamp.r === 0.1 && lamp.dx === 0 && lamp.dz === 0 && lamp.h === 5, J(r.lamp));
      check('default circle of a tree: the trunk, not the crown', tree.r === 0.3 && tree.dx === 0, J(r.tree));
      check('walking: under the arm is free, the pole still stops, beside the trunk under the crown is free', r.walk.underArm && !r.walk.onPole && r.walk.besideTree, J(r.walk));
      check('a model buried to its middle is measured at the ground line, not on its buried tip', boulder.r > 0.6, J(r.boulder));
      check('a model with nothing near the ground is measured at its own lowest part', lantern.r === 0.3, J(r.lantern));
      check('the base sits beside the origin: the circle follows it through rot and scale', turned.r === 1 && turned.dz === -4 && turned.dx === 0, J(r.turned));
      check('template { circle, occluder: false }: on the pole, radius follows scale, camera ignores it', thin.r === 0.5 && thin.dx === 0 && thin.occ === false, J(r.thin));
      check('template { circle } without occluder blocks the camera as before', solid.r === 0.25 && solid.occ === true, J(r.solid));
      check('a plain prop takes the same form', prop.r === 0.3 && prop.occ === false, J(r.prop));
      check("'box' keeps the model's bounds", r.box.length === 1 && r.box[0].hw === 1 && r.box[0].hd === 0.5 && r.box[0].h === 2, J(r.box));
      check('mistyped collide is refused at load and says what to write (template, prop, zero radius, unknown word)',
        Object.values(r.bad).every(m => /collide must be one of false, "box", "circle" or \{ circle/.test(m ?? '')), J(r.bad));
      check('a collide object stays out of the save (unchanged props are not saved)', r.saved.length === 0, J(r.saved));
      check('thing.explain reports the collide object as written', r.explained?.circle === 0.25 && r.explained?.occluder === false, J(r.explained));
    },
  },
];
