# engine.post (PostFX)

- `post.add(_effect: PostEffect, _opts?: { slot?, order?, enabled? }) → never` — (experimental) Renamed in 0.2: throws and names the new call (engine.look.post.patch / engine.look.post.replace, recipes/52-look.md)
- `post.get(name: string) → PostHandle | undefined` — (experimental) Read-only record of an added effect (name, slot, order, enabled, params), or undefined. Change one with engine.look.post.set({ 'bloom.strength': 0.6 })
- `post.enable(_name: string, _on: boolean) → never` — (experimental) Renamed in 0.2: throws and names the new call (engine.look.post.set({ 'bloom.enabled': on }); MSAA: engine.post.setAntialias(on))
- `post.setAntialias(on: boolean)` — (experimental) Turn MSAA (antialiasing of the post chain) on or off. It is a render target setting, not a look part. Example: `engine.post.setAntialias(false);`
- `post.list() → { name, slot, order, enabled }[]` — (experimental) Effects in render order: [{ name, slot, order, enabled }]
- Properties:
  - `antialias: boolean` MSAA on (read-only; switch with post.setAntialias(on))
  - `active: boolean` Whether any post work runs (antialias or an enabled effect)
