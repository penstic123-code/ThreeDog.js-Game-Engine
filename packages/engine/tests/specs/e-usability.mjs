// Usability bits: openWorld camera option, engine.describe.add, engine.random.seeded. Same format as the other files here.
import { openWorld, rtsCamera } from '../../index.js';

export const specs = [
  {
    name: 'E openWorld camera 选项、describe.add 登记游戏状态、random.seeded 独立随机（小城）',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      // openWorld just returns a module array, so inspect it in node (the test page is a bundle and cannot reach the raw modules)
      const rigOf = opts => openWorld(opts).filter(m => m && m.name === 'cameraRig');
      const rigs = [{ camera: 'follow' }, { camera: 'firstPerson' }, { camera: 'rts' }, { camera: 'fixed' }, { camera: rtsCamera({ height: 60 }) }].map(o => rigOf(o).length);
      let bad = ''; try { openWorld({ camera: 'sky' }); } catch (err) { bad = err.message; }
      const r = await ev(async () => {
        engine.pause();
        // check the camera kind in the page via describe().camera.type; switch back to the original after setCamera
        const type0 = engine.describe().camera.type, cams = {};
        for (const k of ['follow', 'firstPerson', 'rts', 'fixed']) { engine.setCamera(k); cams[k] = engine.describe().camera.type; }
        engine.setCamera(type0);
        let score = 1;
        const h = engine.describe.add('range', () => ({ score }));
        const a = engine.describe().range;
        score = 5; const b = engine.describe().range, text = engine.describeText().includes('range');
        let dup = ''; try { engine.describe.add('range', () => 1); } catch (err) { dup = err.message; }
        let std = ''; try { engine.describe.add('player', () => 1); } catch (err) { std = err.message; }
        const bangs = engine.describe.add('boom', () => { throw new Error('炸了'); });
        const boom = engine.describe().boom;
        h.remove(); bangs.remove();
        const gone = engine.describe().range === undefined && engine.describe().boom === undefined;

        const before = JSON.stringify(engine.random.toJSON());
        const r1 = engine.random.seeded(7), r2 = engine.random.seeded(7);
        const seq1 = [r1.next(), r1.next(), r1.next()], seq2 = [r2.next(), r2.next(), r2.next()];
        return { cams, a, b, text, dup, std, boom, gone, same: seq1.join() === seq2.join(), untouched: before === JSON.stringify(engine.random.toJSON()) };
      });
      check('openWorld camera: every form installs exactly one camera module, and setCamera switches to the matching kind', rigs.every(n => n === 1) && Object.entries(r.cams).every(([k, t]) => k === t), JSON.stringify([rigs, r.cams]));
      check('openWorld camera with a wrong name: throws and lists the valid options', bad.includes('follow') && bad.includes('firstPerson'), bad);
      check('describe.add: return value goes to describe().<name>, is recomputed per call, and describeText includes it', r.a?.score === 1 && r.b?.score === 5 && r.text, JSON.stringify([r.a, r.b, r.text]));
      check('describe.add: a duplicate or core-field name throws; a throwing fn does not break describe; gone after remove', r.dup.includes('range') && r.std.includes('player') && r.boom?.error === '炸了' && r.gone, JSON.stringify([r.dup, r.std, r.boom, r.gone]));
      check('random.seeded: same seed gives the same sequence and leaves engine.random state untouched', r.same && r.untouched);
    },
  },
  {
    name: 'E recipe 18 world data: crops grow by clock.now and dispose is called on harvest (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const T = engine.THREE, GROW = 120, growth = rec => Math.min(1, (engine.clock.now - rec.plantedAt) / GROW);
        let disposed = 0;
        engine.world.present('e-crop', {
          build: () => new T.Mesh(new T.ConeGeometry(0.25, 0.8, 6), new T.MeshBasicMaterial()),
          update: (rec, obj) => obj.scale.setScalar(0.3 + 0.7 * growth(rec)),
          dispose: (rec, obj) => { disposed++; engine.remove(obj); },
        });
        const p = engine.player.position, rec = engine.world.add({ kind: 'e-crop', position: { x: p.x + 2, y: p.y, z: p.z }, plantedAt: engine.clock.now });
        engine.step(1);
        const young = engine.world.view(rec.id)?.scale.x;
        engine.step(130);
        const old = engine.world.view(rec.id)?.scale.x, ripe = growth(rec);
        engine.world.remove(rec.id); engine.step(0.1);
        return { young, old, ripe, disposed, gone: engine.world.view(rec.id) == null };
      });
      check('freshly planted is small, fully grown after fast-forwarding 130 game seconds', r.young < 0.5 && Math.abs(r.old - 1) < 0.01 && r.ripe === 1, JSON.stringify(r));
      check('after the record is removed dispose(rec, obj) is called and the model is gone', r.disposed === 1 && r.gone, JSON.stringify(r));
    },
  },
];
