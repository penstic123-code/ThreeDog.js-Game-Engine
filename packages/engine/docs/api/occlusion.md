# engine.occlusion (Occlusion)

- Properties:
  - `enabled: boolean` Occlusion culling of hlod cells and batched groups; describe().render.occlusion says what it saved
  - `stats: { watched, hidden, trianglesSkipped }` What it does now: { watched, hidden, trianglesSkipped } (items, items hidden this frame, triangles not drawn this frame)
