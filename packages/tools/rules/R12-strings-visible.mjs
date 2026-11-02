// R12 text in a STRINGS table shown to the player → warning, it must go through i18n (heuristic)
// Background: the hard-rule check (item 3 of check.mjs) lets code inside STRINGS = {...} tables through, because dev hints (console warnings, describe text) may be in one language only.
//       But if text from the same table is shown to the player, it bypasses localization: after switching language it still shows the wrong one.
// Criteria: in packages/engine/, a constant whose name contains STRINGS (or an alias such as const S = XX_STRINGS) with an object-literal initializer that is not the { 'zh-CN': …, en: … } multi-language shape;
//   walk up the syntax tree from table.key (continuing through wrappers like fmt(…)) to the statement; passing any of these "player-visible" places → warning:
//   arguments of toast(…) / alert(…) / createTextNode(…) / makeWindow(…); right-hand sides of .textContent / .innerHTML / .innerText / .title / .placeholder assignments;
//   values of label / title / prompt fields. Passing console.* / warnOnce stops the walk (dev hints may be in one language only).
// Limitation: only the same statement; text stored in a variable and shown elsewhere is not followed (e.g. a describe text built up and left to the caller to show).
import { ts, parse, visit, engineFiles, lineOf } from './_lib.mjs';

// Allowlist: [file, 'table.key', reason]
const ALLOW = [];
const SINK_CALL = /(^|\.)(toast|alert|createTextNode|makeWindow|setTitle|setLabel)$/;
const SINK_PROP = /^(textContent|innerHTML|innerText|title|placeholder)$/;
const SINK_FIELD = /^(label|title|prompt)$/;
/** Walk up from table.key to the statement; return a description when a "player-visible" place is passed */
function sinkOf(n) {
  for (let c = n, p = n.parent; p && !ts.isStatement(p); c = p, p = p.parent) {
    if (ts.isCallExpression(p) && p.arguments.includes(c) && SINK_CALL.test(p.expression.getText())) return `${p.expression.getText()}(…)`;
    if (ts.isBinaryExpression(p) && p.right === c && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(p.left) && SINK_PROP.test(p.left.name.text)) return `.${p.left.name.text} =`;
    if (ts.isPropertyAssignment(p) && p.initializer === c && SINK_FIELD.test(p.name.getText())) return `${p.name.getText()}:`;
    if (ts.isCallExpression(p) && /(^|\.)(warnOnce|warn|error|log|info)$/.test(p.expression.getText())) return null;   // dev hint
  }
  return null;
}

const isI18nShape = obj => obj.properties.some(p => p.name && (p.name.text ?? p.name.getText()) === 'zh-CN');
function stmtOf(n) { let p = n; while (p.parent && !ts.isStatement(p) && !ts.isPropertyAssignment(p.parent?.parent ?? p)) p = p.parent; while (p.parent && !ts.isStatement(p)) p = p.parent; return p; }

export default {
  id: 'R12', title: 'STRINGS text shown to the player (should go through i18n)',
  run() {
    const out = [];
    for (const f of engineFiles()) {
      const sf = parse(f), tables = new Set();
      visit(sf, n => {
        if (!ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name) || !n.initializer) return;
        const name = n.name.text;
        if (/STRINGS/.test(name) && ts.isObjectLiteralExpression(n.initializer) && !isI18nShape(n.initializer)) tables.add(name);
      });
      if (!tables.size) continue;
      visit(sf, n => {   // alias const S = RULE_STRINGS
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isIdentifier(n.initializer) && tables.has(n.initializer.text)) tables.add(n.name.text);
      });
      const seen = new Set();
      visit(sf, n => {
        if (!(ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) || !ts.isIdentifier(n.expression) || !tables.has(n.expression.text)) return;
        const st = stmtOf(n);
        if (ts.isVariableStatement(st) && st.declarationList.declarations.some(d => tables.has(d.name.getText()))) return;   // the table itself
        const sink = sinkOf(n);
        if (!sink) return;
        const text = st.getText();
        const key = n.getText();
        if (ALLOW.some(([af, k]) => af === f && k === key)) return;
        const at = `${lineOf(n)}|${key}`;
        if (seen.has(at)) return;
        seen.add(at);
        out.push({ level: 'warn', file: f, line: lineOf(n), msg: `string table ${key} is used where the player can see it (${sink}): ${text.replace(/\s+/g, ' ').slice(0, 70)}`,
          fix: `move this text into a multi-language table: e.i18n.add({ 'zh-CN': { 'module.key': '…' }, en: { 'module.key': '…' } }), and show it with e.t('module.key')` });
      });
    }
    return out;
  },
};
