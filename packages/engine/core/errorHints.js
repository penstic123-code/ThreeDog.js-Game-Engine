// Error hints: a table of "message pattern -> likely cause + which doc to read", so an AI that sees an error knows the next step
// without searching. Appended to engine.error (errors.js), warnOnce (validate.js), .threedog/errors.log (vite-error-relay) and
// the dev bridge `errors` command, all through hintText() / withHint().
//
//   hintFor('world data must be plain values (...)')   // { id: 'world-plain', cause: '...', docs: ['recipes/18-world.md', ...] }
//   withHint(message)                                  // message + "\n  Code: world-plain\n  Possible cause: ...\n  Read: recipes/18-world.md, api/world.md"
//   throw codedError('clock-interval', 'clock.every(0): ...')   // err.code, err.fix, err.docs; the message ends with [clock-interval]
//
// Codes: an error the engine raises by name carries a stable code (a key of ERROR_CODES, or an ERROR_HINTS id) as err.code and as a "[code]"
// tag at the end of its message, so logs, engine.error and the dev bridge `errors` command show it; a message matched only by pattern gets the hint's id.
//
// Doc paths are relative to the package docs (recipes/..., api/..., CONVENTIONS.md), same as the shipped docs.
// Plain data (it imports only errorCodes.js, also plain data), so node tools can load it too. To add a class: append an entry (first match wins, so put specific ones first).
import { ERROR_CODES } from './errorCodes.js';
import { RENAMED } from './renamed.js';
export { RENAMED };


/** @typedef {{ id: string, match: RegExp, cause: string, docs: string[] }} ErrorHint */

/** @type {ErrorHint[]} */
export const ERROR_HINTS = [
  // ---- module install / dependencies ----
  { id: 'module-requires', match: /module \S+ requires module "?\S+"?/i,
    cause: 'A module needs another module that is not installed yet, or is installed after it. Add the missing module, or ' +
      'put it earlier in engine.use(...) (a typo is suggested in the message).',
    docs: ['recipes/14-custom-module.md', 'api/engine.md'] },
  { id: 'module-cycle', match: /module order forms a cycle/,
    cause: 'before / after constraints of two or more modules point at each other. Remove one of them or give a module a different stage.',
    docs: ['recipes/14-custom-module.md'] },
  { id: 'module-stage', match: /has stage ".*", which is not a stage|sets order, which is not supported/,
    cause: 'Modules sort by stage (+ before / after), not by number. Use one of the listed stage names.',
    docs: ['recipes/14-custom-module.md'] },
  { id: 'module-name', match: /clashes with an existing engine property/,
    cause: 'The module name becomes engine.<name>; it must not be an existing engine property or another module name.',
    docs: ['recipes/14-custom-module.md'] },
  { id: 'module-called', match: /received the module function \S+ itself/,
    cause: 'engine.use() takes the module object: write engine.use(sky()), not engine.use(sky).',
    docs: ['recipes/01-new-game.md', 'api/engine.md'] },
  { id: 'describe-name', match: /describe\.add\(.*\): this name is already taken/,
    cause: 'describe.add names share one namespace with the standard fields and module names. Pick a unique name.',
    docs: ['recipes/16-dev-bridge.md', 'api/engine.md'] },

  // ---- world data ----
  { id: 'world-missing', match: /world\(\) (installed )?first|world\(\) module|use\(world\(\)\)|world\(\) (is|must)/,
    cause: 'The feature stores its data in engine.world, but the world() module is not installed or comes after it. ' +
      'engine.use(world(), ...) first; the openWorld() preset already includes it.',
    docs: ['recipes/18-world.md', 'api/world.md'] },
  { id: 'world-plain', match: /world data must be plain values/,
    cause: 'A record holds a three.js object, function or class instance. World data must be JSON-like (it is saved and ' +
      'may go to a worker). Keep the model in world.present(), the logic in world.simulate().',
    docs: ['recipes/18-world.md', 'api/world.md'] },
  { id: 'frozen-definition', match: /Cannot (assign to read only property|add property .*not extensible|delete property)/,
    cause: 'Definitions (content templates, items, entity types) are shared by every instance and frozen. Keep per-instance ' +
      'state on the world record (engine.world.set(id, { opened: true })) or in its container; define another template for a different kind of thing.',
    docs: ['recipes/30-templates.md', 'recipes/18-world.md'] },
  { id: 'pickup-prop-id', match: /[Pp]ickup id .* already used|Prop id ".*" is already used|Pickup data lives in world/,
    cause: 'A pickup / prop id collides with other data, or world() is not ordered before inventory(). Use distinct ids; ' +
      'stable ids are what saves match on.',
    docs: ['recipes/03-items-pickups.md', 'api/inventory.md'] },
  { id: 'world-id', match: /\bid ["'][^"']+["'] (already exists|is already used)|an NPC named ".*" already exists/,
    cause: 'Two records share one id. Omit id to auto-number, give each its own id, or use world.set(id, patch) to update an existing record.',
    docs: ['recipes/18-world.md', 'api/world.md'] },
  { id: 'world-record', match: /world\.\w+\(\): no record with id/,
    cause: 'The id was never added, was removed, or is misspelled. world.query({ kind }) lists what exists.',
    docs: ['recipes/18-world.md', 'api/world.md'] },
  { id: 'world-add', match: /world\.add\(\) needs a kind|needs a stable id|patch must not contain id/,
    cause: 'world.add({ kind, position, ... }) needs a kind; initial records need a stable id; id and kind of an existing ' +
      'record cannot be changed by set().',
    docs: ['recipes/18-world.md', 'api/world.md'] },
  { id: 'world-present', match: /world\.present\(|build of world\.present/,
    cause: 'present(kind, { build }) must return a three.js object (or use show: rec => false to hide). Errors inside build also land here.',
    docs: ['recipes/18-world.md', 'api/world.md'] },
  { id: 'bad-position', match: /position is not a valid number|array position must be \[x, y, z\]/,
    cause: 'A position was NaN or the wrong shape: a Vector3 used like an array (v[0]), a missing field, or a division by ' +
      'zero upstream. Use [x, y, z], { x, z } or the Vector3 itself.',
    docs: ['CONVENTIONS.md', 'api/world.md'] },

  // ---- content / items / npcs ----
  { id: 'content-place', match: /Place ".*" not found|content has props or pickups/,
    cause: 'content.load references a place that has no coordinates, or needs world() for props / pickups. Give the place ' +
      'in content.load({ places }) or add the marker to the level.',
    docs: ['recipes/20-content-actions-save.md', 'api/content.md'] },
  { id: 'container', match: /inventory\.(container|transfer)|container\.on events|cannot be removed/,
    cause: 'Container id / capacity / count was invalid, or a container used in transfer was never created. Create it ' +
      'first with inventory.container(id, { capacity }).',
    docs: ['recipes/03-items-pickups.md', 'api/inventory.md'] },
  { id: 'npc-behavior', match: /no NPC behavior named/,
    cause: 'The schedule / behavior name is unknown. Register it with engine.npcs.behavior(name, { near, far }) before ' +
      'npcs.add, or use a listed built-in.',
    docs: ['recipes/02-npc.md', 'api/characters.md'] },

  // ---- API misuse caught by validate ----
  { id: 'unknown-option', match: /unknown option "/,
    cause: 'An options key is misspelled or does not exist for this call (ignored, so the feature silently does nothing). ' +
      'Use the suggested key or one of the listed options.',
    docs: ['api/engine.md', 'CONVENTIONS.md'] },
  { id: 'unknown-name', match: /does not exist, (did you mean|\(available)|does not exist \(available/,
    cause: 'A name (action, item, asset, weather, text key, ...) was never registered or has a typo. The message lists the registered names.',
    docs: ['CONVENTIONS.md', 'api/engine.md'] },
  { id: 'options-object', match: /the second argument must be an options object/,
    cause: 'The old positional form was used. In this engine a position is one argument and the rest goes in an options object.',
    docs: ['CONVENTIONS.md'] },
  { id: 'event-typo', match: /was never emitted or listened to/,
    cause: 'The event name is probably a typo of an engine event (the engine emits no event you did not subscribe to under this name).',
    docs: ['api/events.md'] },
  { id: 'owned-prop', match: /is recomputed every frame/,
    cause: 'A module rewrites this property every frame, so a direct assignment is lost. Use the module API named in the message (e.g. sky.modify).',
    docs: ['recipes/08-weather-sky.md', 'api/sky.md'] },
  { id: 'camera-kind', match: /has no camera kind/,
    cause: 'setCamera() got an unknown camera kind. Use one of the listed kinds; for a camera of your own, take it with engine.takeCamera(owner) and place engine.camera yourself (recipes/21-camera.md).',
    docs: ['recipes/21-camera.md', 'api/cameraRig.md'] },
  { id: 'movement', match: /movement\.\w+ must be a positive number/,
    cause: 'A movement parameter was zero, negative or not a number (a typo in a name gives undefined).',
    docs: ['api/characters.md', 'api/engine.md'] },
  { id: 'commit-fallback', match: /commits\.request\(\) needs a fallback/,
    cause: 'Async results apply at fixed steps; the fallback is the deterministic main-thread computation used when the result is late.',
    docs: ['api/jobs.md'] },

  // ---- resources / platform ----
  { id: 'asset-critical', match: /Startup blocked: \d+ critical item/,
    cause: 'An asset marked critical: true in the manifest (or an engine.loading.track step) failed, so start() stopped instead of starting ' +
      'a broken game. The line names the file, HTTP status and manifest. Fix the path or the file; if the game can run without it, drop critical ' +
      'so it falls back. engine.loading.list({ phase: "failed" }) or threedog loading shows every failure.',
    docs: ['recipes/05-props-bake.md', 'api/assets.md'] },
  { id: 'asset-missing-ref', match: /Asset loaded with missing references/,
    cause: 'The model file loaded, but a file it references (texture image or .bin) is missing, usually after moving the .gltf without its ' +
      'folder or a case mismatch in the referenced name. Export as .glb (everything in one file) or copy the referenced files next to it.',
    docs: ['recipes/05-props-bake.md', 'api/assets.md'] },
  { id: 'asset-load', match: /Asset failed to load|Audio file failed to load|Failed to load <(img|script|link|audio)/,
    cause: 'The file was not found (404) or is not valid. Check the path (files under public/ are served from /), the ' +
      'extension, and the case of the name. A registered file that is not critical now shows its fallback; engine.loading.get(name) has the details.',
    docs: ['api/assets.md', 'recipes/05-props-bake.md'] },
  { id: 'audio-unsupported', match: /Audio is not supported/,
    cause: 'No AudioContext in this browser / test environment. Guard calls with typeof AudioContext, or skip audio in headless tests.',
    docs: ['api/audio.md'] },
  { id: 'indexeddb', match: /indexedDB is unavailable/,
    cause: 'Saves use IndexedDB, which is blocked in private windows and some embedded browsers. Test in a normal window, ' +
      'or export / import the save as a file.',
    docs: ['api/saves.md', 'recipes/20-content-actions-save.md'] },

  // ---- runtime failures reported by the error tiers (errors.js) ----
  { id: 'gameplay-frozen', match: /threw and gameplay is frozen/,
    cause: 'In dev / tests a gameplay error freezes the game on purpose, so half-applied state is not mistaken for normal. ' +
      'Read the error printed with it (engine.error has where + message), fix it, reload.',
    docs: ['recipes/16-dev-bridge.md', 'recipes/14-custom-module.md'] },
  { id: 'module-disabled', match: /presentation module \S+ threw and was disabled/,
    cause: 'A presentation-only module (particles, ambience, music...) threw and was switched off; the game keeps running ' +
      'without it. The error printed with it is the real cause.',
    docs: ['recipes/14-custom-module.md'] },
  { id: 'not-installed', match: /Cannot read properties of (undefined|null) \(reading '[\w$]+'\)|engine\.[\w$]+(\.[\w$]+)* is undefined/,
    cause: 'Usually engine.<module> was used but the module is not installed (engine.use(...)), or it ran before ' +
      'engine.start() finished. Check the stack for the line, and that the module is in engine.use().',
    docs: ['recipes/01-new-game.md', 'api/engine.md'] },
  { id: 'not-function', match: /[\w$.]+ is not a function/,
    cause: 'The method name is wrong, or the module is not installed (the property is then undefined). Check spelling against api/<module>.md.',
    docs: ['api/engine.md', 'CODEMAP.md'] },
];


const TAG = /\[([a-z]+(?:-[a-z0-9]+)+)\]/;

/** The hint for a message: its "[code]" tag first (ERROR_CODES or a hint id), else the first pattern that matches; null if none. @param {unknown} message */
export function hintFor(message) {
  const s = String(message ?? ''), tag = TAG.exec(s)?.[1], c = tag && ERROR_CODES[tag];
  return (c ? { id: tag, cause: c.fix, docs: c.docs } : tag && ERROR_HINTS.find(h => h.id === tag)) || ERROR_HINTS.find(h => h.match.test(s)) || null;
}

/**
 * Machine-readable view of any error: its code, the fix and the pages to read (err.code first, else the hint for its message; nulls when unknown).
 * @param {any} err
 * @returns {{ code: string | null, fix: string | null, docs: string[] }}
 */
export function errorInfo(err) {
  const h = hintFor(err?.code ? `[${err.code}]` : err?.message ?? err);
  return { code: err?.code ?? h?.id ?? null, fix: err?.fix ?? h?.cause ?? null, docs: err?.docs ?? h?.docs ?? [] };
}

/**
 * An Error with a stable code: err.code, err.fix (what to do), err.docs (pages to read); the message ends with "[code]".
 * @param {string} code  a key of ERROR_CODES or an ERROR_HINTS id
 * @param {string} message  English: what is wrong and how to fix it
 * @param {ErrorConstructor} [Type]  Error by default (TypeError for a wrong argument type)
 * @returns {Error & { code: string, fix: string | null, docs: string[] }}
 * @example throw codedError('clock-interval', 'clock.every(0): seconds must be > 0');
 */
export function codedError(code, message, Type = Error) {
  const err = /** @type {any} */ (new Type(coded(code, message)));
  return Object.assign(err, errorInfo({ code }));
}

/** The stub every removed old name becomes: throws `<old> was renamed: <new call>` [renamed-api]. @param {keyof RENAMED} key @param {string} [oldOverride] @returns {never} */
export function renamed(key, oldOverride) { throw codedError('renamed-api', `${oldOverride ?? RENAMED[key].old} was renamed: ${RENAMED[key].now}`); }

/** A message tagged with its code, for warnings: warnOnce(coded('save-refused', text)). @param {string} code @param {string} message */
export function coded(code, message) { return `${message} [${code}]`; }

/** Indented lines "Code" (when the message has no [code] tag) + "Possible cause" + "Read"; '' if no hint matches. @param {unknown} message */
export function hintText(message) {
  const h = hintFor(message);
  if (!h) return '';
  return (TAG.test(String(message)) ? '' : `\n  Code: ${h.id}`) + `\n  Possible cause: ${h.cause}\n  Read: ${h.docs.join(', ')}`;
}

/** message + its hint (unchanged if none matches or it already has one). @example withHint('world data must be plain values (...)') @param {string} message */
export function withHint(message) {
  return /\n\s*Possible cause:/.test(message) ? message : message + hintText(message);
}
