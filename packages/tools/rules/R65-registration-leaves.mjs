// R65 a registration leaves with its module (error). world.present, world.simulate, rays.addProvider, input.touchButton and assets.onSwap take no ctx, so nothing removes
// them when the module goes: a dropped handle keeps calling into a module that left. Why static: the bug only shows on a swap or an unuse, which a game rarely tries.
// A call passes inside ctx.track(...) / track(...) on the same statement, or with a `// released: <where>` comment naming the line that gives the handle back.
// World's own methods of the same name only forward, so a method passing a call of its own name on is not a registration.
// Known limits: a handle that was tagged and never removed passes; the tag is a promise read in review. Reads modules/ only, core has no module life to outlive.
import { ts, parse, visit, lineOf, lineTag, engineFiles, P } from './_lib.mjs';

const REGISTRARS = /^(present|simulate|addProvider|touchButton|onSwap)$/;

/** @param {any} n a call @returns {boolean} is it inside a track call, or a forwarder: a method of the same name */
function held(n) {
  for (let p = n.parent; p && !ts.isBlock(p); p = p.parent) if (ts.isCallExpression(p) && /(^|\.)track$/.test(p.expression.getText())) return true;
  for (let p = n.parent; p; p = p.parent) if (ts.isMethodDeclaration(p)) return p.name.getText() === n.expression.name.text;
  return false;
}

/** The registrations a file makes with nothing tying them to the module's life, as { line, name }. input.simulate presses a key and registers nothing @param {any} source a parsed file */
export function loose(source) {
  const out = [];
  visit(source, n => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    const name = n.expression.name.text;
    if (!REGISTRARS.test(name) || name === 'simulate' && /input$/i.test(n.expression.expression.getText()) || held(n)) return;
    out.push({ line: lineOf(n), name });
  });
  return out;
}

export const moduleFiles = () => engineFiles().filter(f => f.startsWith(`${P.ENGINE_REL}/modules/`));

export default {
  id: 'R65', title: 'A registration leaves with its module',
  run() {
    return moduleFiles().flatMap(file => loose(parse(file)).filter(r => !lineTag(file, r.line, ['released:'])).map(r => ({
      level: /** @type {const} */ ('error'), file, line: r.line, msg: `${r.name}(...) outlives its module: nothing removes it on unuse or replaces`,
      fix: 'wrap it in ctx.track(...), or keep the handle and add `// released: <where>` naming the line that removes it',
    })));
  },
};
