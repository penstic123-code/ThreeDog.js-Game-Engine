// The one word list of `threedog how` (how.mjs reads it; nothing else holds synonyms or extra stop words).
// Why a list and not more doc words: an AI types the task the way a player says it ("game is slow", "fps drops", "side-scroller"), the docs name
// the engine's word for it ("perf", "sideScroller", "rigid"). Adding the player's words to every doc row would bloat AI.md (it has a size limit) and
// spread one synonym over many files. A group here joins them in one place: typing any word of a group also matches the others.
// How to add: put the docs' own word in the group (so the group reaches a row), keep a group to one meaning; a word that means two things
// ("light" = lamp or weight) stays out. Check with packages/tools/tests/how.mjs: add the failing query there with the hit it must give first.

/** Words that carry no task meaning in a typed sentence ("game is slow, find why fps drops": is, find, why) */
export const STOP = [
  'the', 'a', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'how', 'do', 'does', 'is', 'are', 'be', 'an', 'make', 'with', 'my', 'our', 'your', 'i', 'we',
  'it', 'its', 'this', 'that', 'these', 'there', 'what', 'why', 'when', 'where', 'which', 'who', 'can', 'could', 'should', 'would', 'will', 'want',
  'need', 'find', 'get', 'use', 'using', 'some', 'any', 'all', 'from', 'into', 'at', 'by', 'so', 'then', 'just', 'also', 'like', 'way', 'thing',
  'things', 'stuff', 'help', 'me', 'out', 'up', 'not', 'no', 'over', 'let', 'lets', 'have', 'has', 'than', 'more', 'very', 'really', 'one',
];

/** Synonym groups: each inner list is one meaning; the first word is the docs' word (printed when a query finds nothing) */
export const SYNONYMS = [
  ['perf', 'performance', 'slow', 'slowdown', 'fps', 'framerate', 'lag', 'laggy', 'stutter', 'stutters', 'hitch', 'jank'],
  ['2d', 'sidescroller', 'scroller', 'platformer', 'orthographic', 'ortho', 'sprite', 'sprites'],
  ['rigid', 'physics', 'push', 'pushing', 'shove', 'boxes', 'crate', 'crates', 'ragdoll'],
  ['rain', 'rainy', 'raining', 'rainfall'],
  ['saves', 'save', 'saving', 'savegame', 'persist', 'checkpoint'],
  ['grids', 'grid', 'tile', 'tiles', 'cells', 'plot', 'plots'],
  ['crop', 'crops', 'farm', 'farming', 'harvest', 'sow'],
  ['shop', 'store', 'merchant', 'sell', 'buy', 'gold'],
  ['outline', 'outlines', 'silhouette', 'contour'],
  ['toon', 'cel', 'cartoon', 'bands', 'banded', 'ramp'],
  ['toast', 'popup', 'notification', 'notify', 'banner', 'message'],
  ['grading', 'grade', 'lut', 'paletteLut', 'tint'],
  ['lightPool', 'lamps', 'lamp', 'torches', 'torch', 'streetlights'],
  ['vehicle', 'vehicles', 'car', 'cars', 'drive', 'driving'],
  ['ride', 'rides', 'riding', 'boat', 'boats', 'raft', 'ferry', 'lift', 'lifts', 'elevator', 'elevators', 'carried', 'carry'],
  ['climb', 'climbing', 'ladder', 'ladders', 'stairs', 'scramble'],
  ['playthrough', 'walkthrough', 'headless'],
  ['enemy', 'enemies', 'monster', 'monsters', 'mob', 'mobs'],
  ['npc', 'npcs', 'villager', 'villagers'],
  ['dialogue', 'dialog', 'conversation'],
  ['inventory', 'backpack', 'bag'],
  ['shader', 'shaders', 'glsl', 'applyEffects', 'patches'],
  ['probes', 'volumes', 'lightmaps'],
  ['post', 'postfx', 'postprocessing'],
  ['multiplayer', 'coop', 'online', 'net'],
  ['settings', 'options', 'preferences', 'quality'],
  ['off', 'disable', 'disabled', 'disabling'],
  ['polish', 'prettier', 'pretty', 'nicer', 'beautiful', 'gorgeous'],
];
