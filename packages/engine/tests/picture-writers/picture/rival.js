export function createRival(engine) {
  return { update() {
    if (window.mode === 'fight') engine.scene.fog.far = 90;                   // the same frame as sky.js: a fight
    if (window.mode === 'duel' && window.tick % 2 === 1) window.game.speed = 2;   // lights.js writes it on the other frames
    if (window.mode === 'nightOnly') engine.scene.fog.near = 2;               // sky.js writes it in the day state: two files, never one frame, no fight
  } };
}
