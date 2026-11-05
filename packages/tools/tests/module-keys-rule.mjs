// Rule R51 on fixture texts: a module that needs a key and has none is a warning; any bind, a rebind, [] and an unreadable binding are not.
import { scanGame, findings } from '../rules/R51-module-keys.mjs';
import { ts } from '../rules/_lib.mjs';

export const name = 'rule R51: a module that needs a key has one';
const groups = { walk: { run: [], jump: [] }, interact: { interact: [] }, quests: { quests: [] } };   // the shape of presets.bindings
const scan = (...texts) => {
  const parseFile = f => ts.createSourceFile(f, texts[+f], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return findings(scanGame(texts.map((_, i) => String(i)), groups, parseFile), groups);
};
const head = "import { createEngine, presets, interactions, quests } from 'threedog';\n";
const use = 'engine.use(interactions({ pick: "nearest" }));\n';

export function run({ check }) {
  const none = scan(head + "const engine = createEngine({ bindings: presets.bindings.walk });\n" + use);
  check('no key: a warning, never an error, that names the action and the preset', none.length === 1 && none[0].level === 'warn' && none[0].msg.includes("'interact'") && none[0].fix.includes('presets.bindings.interact'), JSON.stringify(none));
  check('the preset binds it', !scan(head + "createEngine({ bindings: { ...presets.bindings.walk, ...presets.bindings.interact } });\n" + use).length);
  check('another key is fine', !scan(head + "createEngine({ bindings: { interact: ['KeyF'] } });\n" + use).length);
  check('[guard] the fix names [] as the way to say no key on purpose', none[0].fix.includes("engine.input.bind('interact', [])"), none[0].fix);
  check('[] is no key on purpose', !scan(head + "createEngine({ bindings: { interact: [] } });\n" + use).length);
  check('input.bind in another file counts', !scan(head + use, "engine.input.bind('interact', 'KeyF');\n").length);
  check('a bindings variable may cover it: quiet', !scan(head + "createEngine({ bindings: myKeys });\n" + use).length);
  check('a custom action is checked by its own name', scan(head + "createEngine({ bindings: presets.bindings.interact });\n" + use + "engine.interactions.add(d, { action: 'lock' });\n").length === 1);
  check('the option names the action', scan(head + "createEngine({ bindings: presets.bindings.interact });\nengine.use(interactions({ action: 'use' }));\n").length === 1);
  check('quests() needs its key too', scan(head + "createEngine({ bindings: presets.bindings.interact });\n" + use + 'engine.use(quests());\n').length === 1);
  check('a function of the same name not from threedog is ignored', !scan("const interactions = () => 1;\ninteractions();\n").length);
}
