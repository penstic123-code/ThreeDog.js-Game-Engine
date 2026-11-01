// The ONE list of names renamed in 0.2: plain data with no imports (errorHints.js re-exports it for the stubs; rule R39 reads it through 'threedog/error-hints').
/**
 * The ONE list of names renamed in 0.2 (recipes/52-look.md "Renamed in 0.2"): key -> { old call, new call, find = a regex source that spots a
 * use of the old name in source text }. The throwing stubs read `old` / `now` through renamed(key); rule R39 reads `find` to keep the old names out of the repo.
 * `find: null` = no safe text pattern (the old name is a field name shared with unrelated objects).
 * @type {Record<string, { old: string, now: string, find: string | null }>}
 */
export const RENAMED = {
  setExposure: { old: 'engine.setExposure(v)', now: 'engine.look.tone.set({ exposure: v })', find: '\\bsetExposure\\b' },
  setToneMapping: { old: 'engine.setToneMapping(kind)', now: "engine.look.tone.set({ mapping: 'aces' })", find: '\\bsetToneMapping\\b' },
  setEnvironment: { old: 'engine.sky.setEnvironment(o)', now: "engine.look.env.replace('sky') then engine.look.env.set({ intensity, rotation }); engine.look.env.replace(false) turns it off", find: '\\bsetEnvironment\\b' },
  setShadow: { old: 'engine.sky.setShadow(o)', now: 'engine.look.shadow.set(o)', find: '\\bsetShadow\\b' },
  weatherDefine: { old: 'engine.weather.define(field, spec)', now: 'engine.look.weather.replace({ [field]: spec })', find: '\\bweather\\??\\.define\\b' },
  postAdd: { old: 'engine.post.add(effect)', now: 'engine.look.post.add(effect, { owner }) for one pass (returns { remove() }), patch(name, { glsl }) for a color effect, or replace([...effects]) for the whole chain', find: '(?<!look\\.)\\bpost\\??\\.add\\b' },
  postEnable: { old: 'engine.post.enable(name, on)', now: "engine.look.post.set({ 'bloom.enabled': on }); MSAA: engine.post.setAntialias(on)", find: '\\bpost\\??\\.enable\\b' },
  postHandle: { old: 'engine.post.get(name).set / .enable / .remove', now: "engine.look.post.set({ 'bloom.strength': 0.6 }); read with engine.post.get(name)", find: '\\bpost\\??\\.get\\([^)]*\\)\\??\\.(set|enable|remove)\\b' },
  lookClouds: { old: 'engine.look.clouds', now: 'engine.look.cloudShadow', find: '\\blook\\.clouds\\b' },
  cameraOverride: { old: 'engine.cameraOverride = {...}', now: "const cam = engine.takeCamera('owner', { focus }); cam.remove() releases it", find: '\\bcameraOverride\\s*=(?!=)' },
  viewsPos: { old: "views.define(name, { pos })", now: 'views.define(name, { position: [x, y, z] })', find: null },
  characterBody: { old: 'style.character.create / .model / .colors (a character body or tint from the style pack)', now: "character bodies are assets: createPlayer({ model: 'yourBody' }) (a generator from an asset pack via engine.assets.manifest(yourAssets)), any GLB asset name, or { rig } for a ready body; part colors are the style's material roles skin / cloth / trousers / hair, or { colors } per character", find: '\\bstyle\\.character\\??\\.(create|model|colors)\\b|\\bcharacter:\\s*\\{[^}]*\\b(create|colors):' },
  reason: { old: 'result.reason (ops.run / can / undo failures), ops.recent() / catalog(op).last / net:result .reason', now: 'result.code (the same name in history, catalog and net:result)', find: null },
};
