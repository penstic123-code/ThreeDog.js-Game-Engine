// R15 no Chinese text hard-coded in engine code (error): developer-facing text in engine source (index.js, core, modules, render, ui) is
// English; player-facing text goes in the locale tables and is shown through engine.t(). A Chinese string in code is a player string that
// skipped the tables, so an English game shows it untranslated.
// Not flagged: comment lines, error and log messages (console.*, throw new Error, new Error(...)), string tables (STRINGS = {...},
// i18n.add({...}): R12 checks what they show), a module's display label (only a fallback; the loading screen reads module.<name>, R3),
// the files that are string tables, and the debug panel (a dev tool).
import { lines, engineFiles, reE } from './_lib.mjs';

const CJK = /[一-鿿]/, CJK_STRING = /(['"`])[^'"`]*[一-鿿][^'"`]*\1/;
// [path regex, reason]
const ALLOW = [
  [reE('modules\\/debug\\/'), 'the debug panel is a dev tool'],
  [/strings\.js$/, 'string tables: this is where the text lives'],
  [reE('core\\/I18n\\.js$'), 'the core locale tables'],
];
/** A line without its // and /* *\/ comments; quotes are kept, since the strings are what this rule reads */
const noComments = line => line.replace(/(['"`])(?:\\.|(?!\1).)*\1|\/\/.*$|\/\*.*?\*\//g, m => m.startsWith('/') ? '' : m);

export default {
  id: 'R15', title: 'No Chinese text hard-coded in engine code (player text goes in the locale tables)',
  run() {
    const out = [];
    for (const f of engineFiles()) {
      if (ALLOW.some(([r]) => r.test(f))) continue;
      let inStrings = 0;   // depth inside a STRINGS = { ... } / i18n.add({ ... }) table
      lines(f).forEach((raw, i) => {
        if (/^\s*(\*|\/\*|\/\/)/.test(raw)) return;
        if (/STRINGS\s*=\s*\{.*\};?\s*$/.test(raw)) return;   // a table written on one line
        if (/STRINGS\s*=\s*\{|i18n\.add\(\{/.test(raw)) inStrings = 1;
        if (inStrings) { inStrings += (raw.match(/\{/g) || []).length - (raw.match(/\}/g) || []).length; if (inStrings <= 1 && /\};?\s*$/.test(raw)) inStrings = 0; return; }
        const code = noComments(raw);
        if (!CJK.test(code) || !CJK_STRING.test(code) || /console\.(warn|error|log|info)|throw new Error|new Error\(/.test(code)) return;
        if (/label:\s*'|rigModule\('/.test(code)) return;   // a module's display label: only a fallback (R3)
        out.push({ level: 'error', file: f, line: i + 1, msg: `hard-coded Chinese text: ${raw.trim().slice(0, 70)}`,
          fix: 'put the text in the locale tables (zh-CN and en) and show it with engine.t(\'key\')' });
      });
    }
    return out;
  },
};
