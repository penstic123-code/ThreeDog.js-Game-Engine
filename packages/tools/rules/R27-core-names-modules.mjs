// Detection: R27 core names no concrete module, and imports none (an import from ../modules/ is an error too). Core (packages/engine/core) is what every game has; it must not know the shape of a particular module
// (timeline.runs, rigid.bodies...): a module rename or refactor would break core silently, because ?. turns a broken access into "absent".
// Flags code (not comments or strings) in core that reads e.<module> / engine.<module> / this.<module> for a module name defined in packages/engine/modules
// (the names come from the module definitions: name: '...', label: ...). Core reaches modules through hooks instead: describe, counts, skip, isReady,
// events such as session:end, and the ground interface (ground.viewRange).
// Known limits: only those receiver names; a module reached through another variable (const m = engine.modules.get(...)) is not seen. Allowlist below, each with its reason.
import { walk, lines, codeOnly, P } from './_lib.mjs';

// [core file, module, reason]
const ALLOW = [
  ['thingExplain.js', 'content', 'explain reads the template definition (collide, interact) of a content template instance'],
  ['skip.js', 'calendar', 'engine.skip({ to: "06:00" }) reads the calendar clock it skips to and its next clock mark (only the fields of modules/calendar/contract.js)'],
  ['skip.js', 'flow', 'a fading skip goes through flow.transition when flow is installed, so it queues with other transitions'],
];
// render/ files that import a module file: [file, reason] (the import check has no module name to allow by). Empty: keep it so
const IMPORT_ALLOW = [];
// A module's display name ('module.terrain': '地形') is the module's own text: it registers it with its other strings, so core/base/I18n.js holds none
const NAME_KEY = /'module\.(\w+)':/g;

// What every game has, with or without modules: core, the renderer layer and the UI layer (review 0.4 E: the check used to scan core/ only)
const DIRS = [P.CORE_REL, `${P.ENGINE_REL}/render`, `${P.ENGINE_REL}/ui`];
// A module name in a string is the same dependency as e.<module> (engine.modules.get('weather'), engine.has('terrain')): flagged too
const NAMED = /\b(?:modules\.get|has)\('(\w+)'\)/g;

/** Module names from the module definitions in packages/engine/modules */
function moduleNames() {
  const names = new Set();
  for (const f of walk(P.MODULES_REL)) for (const m of lines(f).join('\n').matchAll(/\bname: '(\w+)',[^\n]*?\blabel: '/g)) names.add(m[1]);
  return names;
}

export default {
  id: 'R27', title: 'Core names no concrete module (reach modules through hooks and events)',
  run() {
    const out = [], names = moduleNames();
    const re = /\b(?:e|engine|this)\.(\w+)\b/g;
    for (const f of DIRS.flatMap(d => walk(d))) {
      const base = f.slice(P.ENGINE_REL.length + 1).replace(/^core\/[^/]+\//, '');   // core files keep their bare name in ALLOW; render/ and ui/ files are 'render/x.js'
      lines(f).forEach((raw, i) => {
        if (/^\s*\*/.test(raw)) return;   // JSDoc body line
        // an import of a module file is the hard form of the same dependency: core would not even load without that module
        if (/from\s+['"](\.\.\/)+modules\//.test(raw.replace(/\/\/.*$/, '')) && !IMPORT_ALLOW.some(([file]) => file === base)) out.push({ level: 'error', file: f, line: i + 1, msg: 'core imports a module',
          fix: 'core must load without any module: move the shared code into core, or let the module register itself through a hook' });
        const code = codeOnly(raw);
        for (const m of code.matchAll(re)) {
          if (!names.has(m[1]) || ALLOW.some(([file, mod]) => file === base && mod === m[1])) continue;
          out.push({ level: 'error', file: f, line: i + 1, msg: `core reads the ${m[1]} module directly (${m[0]})`,
            fix: 'let the module do it through a hook (describe, counts, skip, isReady) or an event (session:end, engine:ready); if core truly needs it, add [file, module, reason] to ALLOW in R27' });
        }
        if (base === 'I18n.js') for (const m of raw.replace(/\/\/.*$/, '').matchAll(NAME_KEY)) if (names.has(m[1]))
          out.push({ level: 'error', file: f, line: i + 1, msg: `core holds the display name of the ${m[1]} module ('module.${m[1]}')`,
            fix: `the module registers its own name with its other text: engine.i18n.add({ 'zh-CN': { 'module.${m[1]}': '…' }, en: { ... } }) in install` });
        for (const m of raw.replace(/\/\/.*$/, '').matchAll(NAMED)) {
          if (!names.has(m[1]) || ALLOW.some(([file, mod]) => file === base && mod === m[1])) continue;
          out.push({ level: 'error', file: f, line: i + 1, msg: `core names the ${m[1]} module (${m[0]})`,
            fix: 'let the module register what core needs (a hook, a describe / counts entry, an event); if core truly needs it, add [file, module, reason] to ALLOW in R27' });
        }
      });
    }
    out.note = `module names: ${names.size}; allowlist: ${ALLOW.length}`;
    return out;
  },
};
