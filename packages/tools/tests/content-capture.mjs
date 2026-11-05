// `threedog content capture` against a real page over the real dev bridge (dev server on the engine package, its world example; a free port).
// Why a browser test: what capture reads only exists in a running game. The promises checked are that placement comes out with the named model of each
// child (a .clone() included), that anything content cannot hold stops the capture by name with nothing written, and that the file feeds stamp.
import { createServer } from 'vite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ENGINE, viteOptions } from '../paths.mjs';
import { bridgeDriver } from '../threedog/connect.mjs';
import { capture, stamp } from '../content-stamp.mjs';

export const name = 'content capture: a named group in the running game becomes an arrangement; children with no named model stop it by name';

// runs in the page: engine.THREE and a code-built model by name, as a game that started in plain three.js and named its models would have them
const SETUP = `async () => {
  const e = window.engine, T = e.THREE, box = () => new T.Mesh(new T.BoxGeometry(1, 1, 1));
  e.assets.manifest({ name: 'cap', models: { capBox: { build: box } } });
  const a = await e.assets.model('capBox');
  a.name = 'crate'; a.position.set(1, 0, -2); a.rotation.y = 2.5;   // past 90 degrees: an Euler y alone would read it wrong
  const b = a.clone(); b.name = ''; b.position.set(3, 0.5, 0); b.rotation.set(0, 0, 0); b.scale.setScalar(2);
  const g = new T.Group(); g.name = 'capStall'; g.position.set(20, 0, 5); g.rotation.y = 1.6; g.add(a, b); e.scene.add(g);
  const lamp = box(); lamp.name = 'lamp';
  const leaning = a.clone(); leaning.name = 'leaning'; leaning.rotation.set(0.4, 0, 0);
  const stretched = a.clone(); stretched.name = 'stretched'; stretched.rotation.set(0, 0, 0); stretched.scale.set(1, 3, 1);
  const fine = a.clone(); fine.name = 'fine'; fine.rotation.set(0, 0, 0);
  const bad = new T.Group(); bad.name = 'capBad'; bad.add(lamp, leaning, stretched, fine); e.scene.add(bad);
  return true;
}`;

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'td-capture-'));
  mkdirSync(join(dir, 'content'), { recursive: true });
  writeFileSync(join(dir, 'main.js'), '\n');
  const server = await createServer(await viteOptions(ENGINE, { server: { port: 0, host: 'localhost' }, logLevel: 'error' }));
  await server.listen();
  try {
    const driver = bridgeDriver(ENGINE);
    await driver.evaluate(SETUP);
    const file = join(dir, 'content/arrangements/stall.js');

    const none = await capture(dir, { group: 'capNope', as: 'stall', driver });
    check('no such group: lists the named groups', !none.ok && /capStall/.test(none.error), none.error);

    const bad = await capture(dir, { group: 'capBad', as: 'stall', driver });
    const says = n => bad.problems?.some(p => p.includes(`'${n}'`));
    check('children content cannot hold: each named with a fix, nothing written', !bad.ok && bad.problems?.length === 3 && says('lamp') && says('leaning') && says('stretched')
      && /assets\.model/.test(bad.problems.find(p => p.includes('lamp'))) && !existsSync(file), JSON.stringify(bad));

    const dry = await capture(dir, { group: 'capStall', as: 'stall', driver, dry: true });
    check('--dry: shows the text, writes nothing', dry.ok && dry.text.includes('capBox') && !existsSync(file), JSON.stringify(dry));

    const r = await capture(dir, { group: 'capStall', as: 'stall', driver });
    check('capture: ok', r.ok, r.error);
    const text = readFileSync(file, 'utf8');
    check('a copy from assets.model: position and turn relative to the group, its name as part',
      JSON.stringify(r.entries[0]) === JSON.stringify({ part: 'crate', model: 'capBox', x: 1, z: -2, rot: 2.5 }), text);
    check('a .clone() of that copy keeps its model; no name: the part is the model name; y and scale kept',
      JSON.stringify(r.entries[1]) === JSON.stringify({ part: 'capBox', model: 'capBox', x: 3, z: 0, y: 0.5, scale: 2 }), text);
    check('the file names the group and holds no geometry', text.includes("group 'capStall'") && !/attributes|position:|vertices/.test(text), text);
    check('where the group stood is reported for the stamp line', JSON.stringify(r.stands) === '[{"x":20,"z":5,"rot":1.6}]', JSON.stringify(r.stands));

    const twice = await capture(dir, { group: 'capStall', as: 'stall', driver });
    check('an existing arrangement is not replaced without --force', !twice.ok && /--force/.test(twice.error), twice.error);

    const s = await stamp(dir, { arrangement: 'stall', id: 'stall-1', ...r.stands[0] });
    check('the captured file stamps', s.ok && s.entries.map(e => e.id).join() === 'stall-1-crate,stall-1-capBox', s.error);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
