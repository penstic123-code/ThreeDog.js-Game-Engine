// __NAME__ style: EMPTY on purpose. With nothing here the engine shows its neutral gray placeholders; the game has no look yet.
// Fill it one section at a time (recipes/09-style-pack.md, recipes/52-look.md). To try another look, copy this folder and point main.js at the copy.
// Looks only: no gameplay data, no terrain shape.
// @ts-check
/** @type {import('threedog').Style} */
export default {
  name: '__NAME__',
  // exposure: 1,                 // overall brightness
  // toneMapping: 'neutral',      // 'aces' | 'agx' | 'neutral' | 'none'
  // background: 0xc8d0d8,        // color behind everything when there is no sky
  // materials: {},               // material per role (default, terrain, vegetation, character, water, pickup, prop): { type: 'lambert', color }
  // palette: {},                 // colors that procedural models read (only if you add models)
  // sky: { keyframes: [] },      // day-cycle keyframes: each row [time, zenith, horizon/fog, sun color, sun intensity, ambient], time 0..1 with the first row at 0 and the last at 1 (both midnight); columns: api/style.md "keyframes"; none = a neutral gray day with dark nights.
  //                              // The ambient column also dims the PBR environment light at night (recipe 08 "Day and night brightness")
  // terrain: {},                 // ground type colors (names come from the terrain generator)
  // water: {},                   // water surface look
  // weather: {},                 // rain / snow / wind look
  // clouds: {},                  // cloud look and shadows
  // wind: {},                    // how vegetation sways
  // seasons: {},                 // season tints
  // Character bodies are assets, not style: createPlayer({ model: … }) (recipe 13); style colors them through material roles
  // pickup: {},                  // pickups on the ground
  // particles: {},               // particle look
  // grid: {},                    // grid cells look
  // triggers: {},                // trigger volume look
  // post: [],                    // post effects in order, e.g. bloom() from @threedog/post-effects
  // ui: {},                      // { bg, fg, muted, accent, line, font, radius: '12px' } (CSS strings; radius needs its unit)
};
