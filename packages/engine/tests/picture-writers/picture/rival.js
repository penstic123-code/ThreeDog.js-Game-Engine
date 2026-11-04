export function createRival(engine) {
  return { update() {
    if (window.mode === 'fight') engine.scene.fog.far = 90;                   // the same frame as sky.js: a fight
    if (window.mode === 'nightOnly') engine.scene.fog.near = 2;               // sky.js writes it in the day state: two files, never one frame, no fight
  } };
}
