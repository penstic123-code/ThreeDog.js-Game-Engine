// R33 code makes nothing a save would duplicate, and does not manage world models: flags only what would break.
// Why only these: a startup engine.add / collision.addBox / interactions.add is rebuilt by code on every start, so it never needs saving and is fine
// (engine.thing says what each object keeps). What breaks is a startup call that creates something saved whole: the save restores it and the code
// makes it again (a duplicate after every load, or a dupId error). That, and code moving a model world places every frame, are what this rule reports.
// Detection (TypeScript AST, not regex), each fix names content or an op:
//   error: world.add (without { save: false }), engine.spawn, inventory.spawnPickup, npcs.add, entities.spawn made at setup time:
//     module top level, a callback of events.on/once('engine:ready' | 'level:loaded' | 'session:start'), an install / init method, or a same-file
//     function called from one of those (one level of call graph). Array callbacks (forEach, map…) and IIFEs take the context around them.
//   error: world.add(…, { initial: true }) anywhere: authored records come only from content loaders (saves diff against that baseline).
//   warn: a world.view(…) result (directly or through a const) handed to engine.add / scene.add, or its position / rotation / scale written
//     (assignment or .set / .copy…). present's update gets the model as its argument, so writes there are not flagged.
//   Not flagged: any other callback (ops.define run, onFixed, onFrame, world.simulate / present, clock, sky, timeline, input, other events) and a
//   line tagged `// runtime: <reason>` (the reason is required).
//   The runtime checks (engine.thing registry, recipe 41) cover what a static pass cannot: whether an id is stable, whether an object will be saved,
//   deeper call graphs and helper modules that take engine as an argument.
// Scope: game code (.js/.mjs) of the engine examples, the new-game templates and games/*; content/ folders, tests/, dist/ and bake.js are skipped.
// Level: the same everywhere (examples, templates and games/*): error for the saved-whole and initial findings, warn for world models.
import { walk, read, ts, P, rel, lineOf } from './_lib.mjs';

// Paths skipped with the reason
const SKIP = [
  [/(^|\/)content\//, 'content files are where placements belong'],
  [/(^|\/)tests\//, 'engine test pages and fixtures (tests/city, tests/coop…) build scenes in code on purpose: they test mechanisms, not level authoring'],
  [/(^|\/)bake\.js$/, 'bake lists only export model builders'],
];
const SETUP_EVENTS = new Set(['engine:ready', 'level:loaded', 'session:start']);
const PASS_THROUGH = new Set(['forEach', 'map', 'flatMap', 'filter', 'reduce', 'some', 'every', 'find']);
const CONTENT_HINT = 'it is saved whole, so the save restores it and this code makes it again after every load. Put it in content '
  + '(a template in content/templates.js plus a placement { id, template, place, x, z } in content/props.js), or create it inside an op during play';

// [callee regex, what it creates, extra fix]: calls that create something saved whole
const CALLEES = [
  [/\bworld\.add$/, 'a world record', 'authored records are props entries with an id (template = kind); a temporary record takes { save: false }'],
  [/\b(?:content|engine|e)\.spawn$/, 'a template instance', 'at setup it is authored: write it in content/props.js'],
  [/\bspawnPickup$/, 'a pickup', 'authored pickups go in content/pickups.js with an id'],
  [/\bnpcs\.add$/, 'an NPC', 'authored NPCs go in content/npcs.js'],
  [/\bentities\.spawn$/, 'an entity', 'authored things are template placements in content/props.js'],
];
const VIEW = /\bworld\.view$/, ADD = /^(?:engine|e|this\.engine)\.add$|\bscene\.add$/;
const XFORM = new Set(['position', 'rotation', 'scale', 'quaternion']);
const VIEW_FIX = "world places this model on its record every frame (and tears it down when far), so the change is lost: change the record with "
  + "ops.run('thing.set', { id, position }) or world.set / world.move, or write it in the present's update(rec, obj)";

const calleeText = call => call.expression.getText().replace(/\?\./g, '.').replace(/\s+/g, '');
const lastName = expr => ts.isPropertyAccessExpression(expr) ? expr.name.text : ts.isIdentifier(expr) ? expr.text : null;
const objArg = (call, key) => call.arguments.some(a => ts.isObjectLiteralExpression(a) && a.properties.some(p => p.name?.getText() === key
  && (!ts.isPropertyAssignment(p) || p.initializer.kind !== ts.SyntaxKind.FalseKeyword)));
const saveFalse = call => call.arguments.some(a => ts.isObjectLiteralExpression(a) && a.properties.some(p => p.name?.getText() === 'save'
  && ts.isPropertyAssignment(p) && p.initializer.kind === ts.SyntaxKind.FalseKeyword));
const isFn = n => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

/** Name a function is called by in this file (declaration or const f = () => …), else null */
function fnName(fn) {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
  return null;
}

/** 'setup' | 'runtime' for the code at node n. depth limits the same-file call graph. */
function contextOf(n, sf, depth = 1) {
  let fn = n.parent;
  while (fn && !isFn(fn)) fn = fn.parent;
  if (!fn) return 'setup';   // module top level
  // a method of an object literal: install / init are setup; otherwise the object's receiving call decides
  let holder = fn, key = null;
  if (ts.isMethodDeclaration(fn)) { key = fn.name?.getText(); holder = fn.parent; }
  else if (ts.isPropertyAssignment(fn.parent)) { key = fn.parent.name?.getText(); holder = fn.parent.parent; }
  if (key === 'install' || key === 'init') return 'setup';
  const arg = ts.isObjectLiteralExpression(holder) ? holder : fn;
  const call = arg.parent;
  if (call && ts.isCallExpression(call) && call.arguments.includes(arg)) {
    const name = lastName(call.expression);
    if (name === 'on' || name === 'once') {
      const ev = call.arguments[0];
      return ev && ts.isStringLiteral(ev) && SETUP_EVENTS.has(ev.text) ? 'setup' : 'runtime';
    }
    if (PASS_THROUGH.has(name)) return contextOf(call, sf, depth);
    return 'runtime';   // ops.define, onFixed, onFrame, world.present / simulate, clock, sky, timeline, input…
  }
  // IIFE: (() => { … })()
  let p = fn.parent; while (p && ts.isParenthesizedExpression(p)) p = p.parent;
  if (p && ts.isCallExpression(p) && p.expression !== fn && ts.isParenthesizedExpression(p.expression)) return contextOf(p, sf, depth);
  // a named function: setup when any call of it in this file is at setup
  const name = fnName(fn);
  if (!name || depth <= 0) return 'runtime';
  let setup = false;
  (function go(x) {
    if (setup) return;
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === name && contextOf(x, sf, depth - 1) === 'setup') setup = true;
    ts.forEachChild(x, go);
  })(sf);
  return setup ? 'setup' : 'runtime';
}

/** Names bound in this file to a world.view(…) result: const m = engine.world.view(id) */
function viewNames(sf) {
  const out = new Set();
  (function go(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isView(n.initializer, null)) out.add(n.name.text);
    ts.forEachChild(n, go);
  })(sf);
  return out;
}
/** Is expr a world model: a world.view(…) call, or a name bound to one */
function isView(expr, names) {
  while (expr && (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr))) expr = expr.expression;
  if (ts.isCallExpression(expr)) return VIEW.test(calleeText(expr));
  return !!names && ts.isIdentifier(expr) && names.has(expr.text);
}
/** model.position.x / model.rotation / model.scale.set: true when this access reaches a world model's transform */
function viewTransform(expr, names) {
  for (let x = expr; ts.isPropertyAccessExpression(x); x = x.expression) if (XFORM.has(x.name.text) && isView(x.expression, names)) return true;
  return false;
}
const K = ts.SyntaxKind;
const WRITE_OPS = new Set([K.EqualsToken, K.PlusEqualsToken, K.MinusEqualsToken, K.AsteriskEqualsToken, K.SlashEqualsToken]);
const WRITE_CALLS = new Set(['set', 'copy', 'add', 'sub', 'setScalar', 'multiplyScalar', 'lerp', 'setFromAxisAngle', 'setFromEuler', 'addScaledVector']);

/** Findings for one source text: [{ line, level, msg, fix }] (exported for the rule test) */
export function scan(sf) {
  const out = [], names = viewNames(sf);
  const warn = (n, msg) => out.push({ line: lineOf(n), level: 'warn', msg, fix: VIEW_FIX });
  (function go(n) {
    if (ts.isCallExpression(n)) {
      const text = calleeText(n), hit = CALLEES.find(([re]) => re.test(text));
      const worldAdd = /\bworld\.add$/.test(text), initial = worldAdd && objArg(n, 'initial');
      if (hit && (initial || (!(worldAdd && saveFalse(n)) && contextOf(n, sf) === 'setup'))) out.push({
        line: lineOf(n), level: 'error',
        msg: initial ? `${text}(…, { initial: true }) in game code: authored records come only from content loaders (saves diff against them)`
          : `${text}() creates ${hit[1]} at setup (module top level or a startup event)`,
        fix: initial ? 'write the record in content (content/props.js with an id); content.load adds it as authored' : `${CONTENT_HINT}; ${hit[2]}`,
      });
      if (ADD.test(text) && n.arguments.some(a => isView(a, names))) warn(n, `${text}() of a world.view() model: world already adds, places and tears down its models`);
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && WRITE_CALLS.has(callee.name.text) && viewTransform(callee.expression, names))
        warn(n, `${callee.expression.getText()}.${callee.name.text}(…) writes the transform of a world model`);
    }
    if (ts.isBinaryExpression(n) && WRITE_OPS.has(n.operatorToken.kind) && viewTransform(n.left, names))
      warn(n, `${n.left.getText()} = … writes the transform of a world model`);
    ts.forEachChild(n, go);
  })(sf);
  return out;
}

const parseText = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
/** scan() over a text (for tests); tag lines are honoured like in the rule */
export function scanText(text, file = 'main.js') {
  const L = text.split('\n');
  return scan(parseText(file, text)).filter(r => !runtimeTag(L, r.line));
}
/** `// runtime: <reason>` on the line or a whole-line comment just above; the reason must not be empty */
function runtimeTag(L, line) {
  for (const n of [line, line - 1]) {
    const s = L[n - 1] || '';
    if (n === line - 1 && !/^\s*\/\//.test(s)) continue;
    if (/\/\/.*\bruntime:\s*\S/.test(s)) return true;
  }
  return false;
}

/** Game code files in scope (relative to the repo root) */
export function placementFiles() {
  const dirs = P.MODE === 'game' ? P.gameDirs().map(d => rel(d) || '.') : [P.EXAMPLES_REL, `${P.TOOLS_REL}/templates`, P.GAMES_REL];
  return [...new Set(dirs.flatMap(d => walk(d, ['.js', '.mjs'])))].filter(f => !SKIP.some(([re]) => re.test(f)));
}

export default {
  id: 'R33', title: 'Code creates nothing a save would duplicate, and leaves world models alone', game: true,
  run() {
    const out = [];
    for (const f of placementFiles()) {
      const L = read(f).split('\n');
      for (const r of scan(parseText(f, read(f)))) if (!runtimeTag(L, r.line)) out.push({ file: f, ...r });
    }
    return out;
  },
};
