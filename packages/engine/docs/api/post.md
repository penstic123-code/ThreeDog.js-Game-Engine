# engine.post (PostFX)

- `post.add(effect: PostEffect, { slot, order, enabled }?: { slot?, order?, enabled? }) → PostHandle` — (experimental) Add a named effect; returns its handle. Slot and order come from the effect unless given here. Example: `import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js'; const pixels = engine.post.add({ name: 'pixelate', slot: 'scene', params: { size: 4 }, create: ({ scene, camera, width, height, params }) => new RenderPixelatedPass(params.size, scene, camera), update: (pass, p) => pass.setPixelSize(p.size) }); pixels.set({ size: 6 }); pixels.enable(false); pixels.remove();`
- `post.get(name: string) → PostHandle | undefined` — (experimental) Handle of an added effect, or undefined: engine.post.get('bloom')?.set({ strength: 0.6 })
- `post.enable(name: string, on: boolean) → boolean` — (experimental) Turn an effect, or 'antialias' (MSAA), on or off; false (and a dev warning naming the effects) when no such effect is added. Example: `engine.post.enable('bloom', false); engine.post.enable('antialias', true);`
- `post.list() → { name, slot, order, enabled }[]` — (experimental) Effects in render order: [{ name, slot, order, enabled }]
- Properties:
  - `antialias: boolean` MSAA on (read-only; switch with post.enable('antialias', on))
  - `active: boolean` Whether any post work runs (antialias or an enabled effect)
