// R3 every engine module has a display name in both languages (error): the loading screen names the module that is loading with
// module.<name>, once in zh-CN and once in en. The module registers it with its own text (engine.i18n.add in install, or its STRINGS table), so
// the key is looked for in the module's folder; the few names core/I18n.js still holds for other passes count too (R27 lists them). The label is a fallback.
// Modules are the definitions `name: '<id>', label` in packages/engine/modules (plus the camera rig, defined through rigModule()).
import { lines, walk, read, P } from './_lib.mjs';

export default {
  id: 'R3', title: 'Every module has a display name module.<name> in both languages',
  run() {
    const out = [], tables = read(P.I18N_CORE_REL), folders = new Map();
    const folderOf = f => f.slice(P.MODULES_REL.length + 1).split('/')[0];
    for (const f of walk(P.MODULES_REL)) folders.set(folderOf(f), (folders.get(folderOf(f)) ?? '') + read(f));
    for (const f of walk(P.MODULES_REL)) {
      const text = lines(f).join('\n');
      const names = [...text.matchAll(/name: '(\w+)',\s*(?:type: '\w+',\s*)?(?:provides: \[[^\]]*\],\s*)?label\b/g)].map(m => m[1]);
      if (/rigModule\(/.test(text) && /export function \w+Camera/.test(text)) names.push('cameraRig');
      const own = folders.get(folderOf(f));
      for (const n of new Set(names)) if (own.split(`'module.${n}':`).length < 3 && tables.split(`'module.${n}':`).length < 3)
        out.push({ level: 'error', file: f, line: 0, msg: `module "${n}" has no display name module.${n} in both languages`,
          fix: `register it with the module's text in install: e.i18n.add({ 'zh-CN': { 'module.${n}': '…' }, en: { 'module.${n}': '…' } })` });
    }
    return out;
  },
};
