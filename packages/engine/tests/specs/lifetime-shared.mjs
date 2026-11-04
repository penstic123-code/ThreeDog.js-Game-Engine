// [guard] Shared resources across engine.dispose() (outside review: "a material, geometry or texture used by several meshes, kept by the game, or shared by two engines").
// engine.dispose() disposes every geometry / material / texture in its scene; three.js frees GPU copies per renderer and re-uploads on the next draw,
// so a resource shared with a living engine or kept by the game must keep drawing, and a second dispose must not throw.
// Run: npm test -- Lifetime
const PAGE = '/tests/lifetime/index.html';

export const specs = [
  {
    name: 'Lifetime: a material / geometry / texture shared by two engines and kept by the game still draws after one engine is disposed; double dispose is quiet',
    url: PAGE,
    software: true,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE, make } = window.lifetime, out = { errors: [] };
        const onErr = ev => out.errors.push(String(ev.message || ev));
        window.addEventListener('error', onErr);
        const tex = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1); tex.needsUpdate = true;
        const mat = new THREE.MeshBasicMaterial({ map: tex });
        const geo = new THREE.PlaneGeometry(4, 4);
        const build = async () => { const e = make({}, false); await e.start(); e.camera.position.set(0, 0, 3); e.camera.lookAt(0, 0, 0); e.scene.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, mat)); return e; };
        // center pixel after a step (read in the same task as the draw)
        const center = e => { e.step(1 / 30); const gl = e.renderer.getContext(), b = new Uint8Array(4); const s = e.renderer.getDrawingBufferSize(new THREE.Vector2()); gl.readPixels(s.x >> 1, s.y >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return [...b]; };
        const A = await build(), B = await build();
        out.a0 = center(A); out.b0 = center(B);
        try { A.dispose(); A.dispose(); out.doubleOk = true; } catch (e) { out.doubleOk = String(e); }
        out.b1 = center(B);   // B shares mat / geo / tex with the disposed A
        B.dispose();
        // the game kept the same resources: a new engine after both are gone draws them again
        const C = await build();
        out.c0 = center(C);
        out.shared = { texAlive: !!tex.image, matType: mat.type, geoAttr: !!geo.attributes.position };
        try { C.dispose(); C.dispose(); } catch (e) { out.doubleC = String(e); }
        window.removeEventListener('error', onErr);
        return out;
      });
      const red = c => c[0] > 200 && c[1] < 60 && c[2] < 60;
      check('baseline: both engines draw the shared red texture', red(r.a0) && red(r.b0), JSON.stringify(r));
      check('double dispose does not throw', r.doubleOk === true && !r.doubleC, JSON.stringify(r));
      check('the other engine keeps drawing the shared material / geometry / texture after the first is disposed', red(r.b1), JSON.stringify(r));
      check('a new engine draws the resources the game kept after earlier engines disposed them', red(r.c0), JSON.stringify(r));
      check('no page errors', r.errors.length === 0, JSON.stringify(r.errors));
    },
  },
];
