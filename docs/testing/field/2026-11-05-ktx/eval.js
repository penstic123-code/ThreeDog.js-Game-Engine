(async () => {
  for (let i = 0; i < 600 && !window.__ktx; i++) await new Promise(r => setTimeout(r, 100));   // the game sets window.__ktx once the model is in
  for (const el of document.querySelectorAll('[class*="title"], [id*="title"]')) el.style.display = 'none';   // the start screen would cover the picture
  await window.__t.frames(30);
  const d = window.engine.describe();
  return { ktx: window.__ktx, renderer: d.renderer, textures: window.engine.renderer.info.memory.textures };
})()
