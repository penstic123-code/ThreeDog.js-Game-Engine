// [guard] Coexistence on one page (outside review: "Object3D.prototype.add is wrapped once per page; other libraries wrap it too, and two engines share the page").
// A stand-in library wraps Object3D.prototype.add / remove either before the engine's files load (before.html) or after (index.html, wrapper installed by the test).
// Checks: the engine still adopts plain scene.add objects; the library's wrapper keeps running while engines come and go and is still in place after engine.dispose();
// two engines on one page each see only their own scene's objects; threePatches.off('scene-add-hook') leaves another library's wrapper alone.
// Run: npm test -- Lifetime
const BEFORE = '/tests/lifetime-before/index.html', AFTER = '/tests/lifetime/index.html';

/** Runs in the page; arg.mode is 'before' (before.js installed window.thirdParty) or 'after' (installed here, after the engine loaded) */
async function scenario({ mode }) {
  const { THREE, make } = window.lifetime, P = THREE.Object3D.prototype, out = { mode, errors: [] };
  let lib = window.thirdParty;
  if (mode === 'after') {
    lib = window.thirdParty = { adds: 0, removes: 0 };
    const add = P.add, remove = P.remove;
    P.add = function (...a) { lib.adds++; return add.apply(this, a); };
    P.remove = function (...a) { lib.removes++; return remove.apply(this, a); };
    lib.wrapper = { add: P.add, remove: P.remove };
  }
  const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const A = make({}, false), B = make({}, false);
  await A.start(); await B.start();
  const inA = (e, o) => e._things.byObj.has(o);
  const a1 = mesh(), b1 = mesh(), nested = new THREE.Group(), deep = mesh();
  const n0 = lib.adds;
  A.scene.add(a1); B.scene.add(b1); nested.add(deep); A.scene.add(nested);
  out.libSawAdds = lib.adds - n0;   // the library's wrapper runs for every add, whichever order the wrappers were installed in
  out.adopt = { a1InA: inA(A, a1), a1InB: inA(B, a1), b1InB: inA(B, b1), b1InA: inA(A, b1), nestedInA: inA(A, nested), deepIsRoot: inA(A, deep) };
  // a nested add after attach reaches the watched scene too (a visitor sees it): the scene's visitor list is internal, so check through the picture writer / describe
  out.describe = JSON.stringify(A.describe().scene ?? null).length > 2;
  // dispose A: B and the library are unaffected
  A.dispose();
  const m0 = lib.adds, r0 = lib.removes, b2 = mesh();
  B.scene.add(b2);
  B.scene.remove(b1);
  out.afterDispose = { libAdds: lib.adds - m0, libRemoves: lib.removes - r0, b2InB: inA(B, b2), b1Forgotten: true, wrapperIntact: mode === 'after' ? (P.add === lib.wrapper.add && P.remove === lib.wrapper.remove) : (P.add !== lib.before.add) };
  // a new engine after A is gone still adopts
  const C = make({}, false); await C.start();
  const c1 = mesh(); C.scene.add(c1);
  out.newEngine = { c1InC: inA(C, c1), c1InB: inA(B, c1) };
  B.dispose(); C.dispose();
  // off() page-wide: the library's wrapper must still be there and run afterwards
  window.lifetime.threePatches.off('scene-add-hook');
  const k0 = lib.adds;
  new THREE.Group().add(new THREE.Group());
  out.afterOff = { libAdds: lib.adds - k0, stillLibWrapper: P.add === lib.wrapper.add, patchOn: window.lifetime.threePatches.list().find(p => p.id === 'scene-add-hook').on };
  return out;
}

function judge(check, r) {
  const L = r.mode;
  const j = JSON.stringify(r);
  check(`${L}: plain scene.add of a root is adopted by the engine whose scene it is; nested add under a root is not a second root`,
    r.adopt.a1InA && r.adopt.b1InB && r.adopt.nestedInA && !r.adopt.deepIsRoot, j);
  check(`${L}: two engines on one page each see only their own scene's objects`, !r.adopt.a1InB && !r.adopt.b1InA && !r.newEngine.c1InB, j);
  check(`${L}: the other library's add wrapper runs for every add (${r.libSawAdds} seen of 4)`, r.libSawAdds === 4, j);
  check(`${L}: disposing one engine leaves the other library's wrapper in place and the other engine working`,
    r.afterDispose.libAdds === 1 && r.afterDispose.libRemoves === 1 && r.afterDispose.b2InB && r.afterDispose.wrapperIntact && r.newEngine.c1InC, j);
  check(`${L}: threePatches.off('scene-add-hook') is page-wide but does not remove another library's wrapper`,
    r.afterOff.libAdds === 1 && r.afterOff.stillLibWrapper && !r.afterOff.patchOn, j);
}

export const specs = [
  {
    name: 'Lifetime: a third-party Object3D.add wrapper installed BEFORE the engine loads: discovery works, dispose and off() leave it alone, two engines stay separate',
    url: BEFORE,
    software: true,
    async run({ check, ev }) { judge(check, await ev(scenario, { mode: 'before' })); },
  },
  {
    name: 'Lifetime: a third-party Object3D.add wrapper installed AFTER the engine loads: discovery works, dispose and off() leave it alone, two engines stay separate',
    url: AFTER,
    software: true,
    async run({ check, ev }) { judge(check, await ev(scenario, { mode: 'after' })); },
  },
];
