// The "art" folder of the dev panel: what the running game has really loaded. It answers what a static scan cannot: a name built at run time, a material
// inside a .glb. Reads three.js objects and engine.assets only, so it does not care how the game's picture is written.
// loadedArt also runs in the page through the dev bridge (`threedog art board --live`), sent as its source text: it must stay one function that uses
// nothing outside itself.

/** What is loaded right now: { assets, materials, unnamedMaterials, textures } @param {any} engine */
export function loadedArt(engine) {
  const assets = [...engine.assets.entries].map(([key, e]) => ({ name: e.name ?? key, type: e.type, url: typeof e.url === 'string' && e.url !== e.name ? e.url : null,
    loaded: !!(e.value || e.promise), builtIn: !!e.builtIn }));
  const mats = new Map(), texs = new Map();
  const urlOf = t => { const d = t.source?.data; return d?.currentSrc || d?.src || null; };
  const tex = (t, slot, m) => texs.set(t, { name: t.name || null, url: urlOf(t), slot, material: m.name || m.type });
  engine.scene.traverse(o => {
    for (const m of [].concat(o.material || [])) {
      if (!m || m.userData?._dbgOf) continue;
      const row = mats.get(m) ?? mats.set(m, { name: m.name || null, type: m.type, shader: !!m.isShaderMaterial, meshes: 0 }).get(m);
      row.meshes++;
      for (const [slot, v] of Object.entries(m)) if (v?.isTexture) tex(v, slot, m);
      for (const [slot, u] of Object.entries(m.uniforms ?? {})) if (u?.value?.isTexture) tex(u.value, slot, m);
    }
  });
  const rows = [...mats.values()];
  return { assets, materials: rows.filter(r => r.name), unnamedMaterials: rows.filter(r => !r.name).length, textures: [...texs.values()] };
}

/** One text line per thing, for the panel and for pasting to the AI */
function lines(a) {
  const loaded = a.assets.filter(x => x.loaded && !x.builtIn);
  return [`loaded assets (${loaded.length}):`, ...loaded.map(x => `  ${x.type} ${x.name}${x.url ? ` (${x.url})` : ''}`),
    `materials in the scene (${a.materials.length} named, ${a.unnamedMaterials} unnamed):`, ...a.materials.map(m => `  ${m.type} ${m.name} on ${m.meshes} mesh(es)`),
    `textures in the scene (${a.textures.length}):`, ...a.textures.map(t => `  ${t.name || t.url || '(made in code)'} in ${t.material}.${t.slot}`)].join('\n');
}

/** Add the folder to an open panel. @param {any} pane @param {any} engine */
export function addArtFolder(pane, engine) {
  const f = pane.addFolder({ title: '美术资源 art (loaded now)', expanded: false }), out = { text: '' };
  const mon = f.addBinding(out, 'text', { readonly: true, multiline: true, rows: 10, label: '' });
  const show = () => { out.text = lines(loadedArt(engine)); mon.refresh(); return out.text; };
  f.addButton({ title: '刷新 refresh' }).on('click', show);
  f.addButton({ title: '复制 copy for the AI' }).on('click', () => { navigator.clipboard?.writeText(show()).catch(() => {}); });
  show();
}
