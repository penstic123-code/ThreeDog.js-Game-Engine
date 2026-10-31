// R33 no authored placement in game code: a level is content, code holds only rules.
// Detection (TypeScript AST, not regex): calls that put a thing into the level (engine.add, engine.scene.add, world.add, stream.add,
//   collision.addBox|addCircle|addObject, rigid.addBox|addBall|addHull|addVehicle, interactions.add, rays.addStatic, inventory.spawnPickup,
//   npcs.add, entities.spawn, content.spawn, grids.add, inventory.container with an items option) made at setup time:
//   module top level, a callback of events.on/once('engine:ready' | 'level:loaded' | 'session:start'), an install / init method,
//   or a same-file function that is called from one of those (one level of call graph). Array callbacks (forEach, map…) and IIFEs
//   take the context of the code around them.
//   Not flagged: any other callback (ops.define run, onFixed, onFrame, world.simulate / present, clock, sky, timeline, input, other events),
//   a line tagged `// runtime: <reason>` (the reason is required), and level({ scene }) (the allowed way to hand a code-built ground to the engine).
//   world.add with { initial: true } is flagged anywhere: authored records come only from content loaders.
// Scope: game code (.js/.mjs) of the engine examples, the new-game templates and games/*; content/ folders, tests/, dist/ and bake.js are skipped.
// Level: error for the examples and templates (they teach), warn for games/*.
// Known limits: call graphs deeper than one level, a game's helper module that takes engine as an argument, dynamic property access.
import { walk, read, ts, P, rel, lineOf } from './_lib.mjs';

// Paths skipped with the reason
const SKIP = [
  [/(^|\/)content\//, 'content files are where placements belong'],
  [/(^|\/)tests\//, 'engine test pages and fixtures (tests/city, tests/coop…) build scenes in code on purpose: they test mechanisms, not level authoring'],
  [/(^|\/)bake\.js$/, 'bake lists only export model builders'],
];
const SETUP_EVENTS = new Set(['engine:ready', 'level:loaded', 'session:start']);
const PASS_THROUGH = new Set(['forEach', 'map', 'flatMap', 'filter', 'reduce', 'some', 'every', 'find']);
const CONTENT_HINT = 'move it into content: a template in content/templates.js plus a placement { id, template, place, x, z } in content/props.js; '
  + 'if it appears during play, create it inside an op with engine.content.spawn(name, at)';

// [callee regex, what it places, extra fix]
const CALLEES = [
  [/^(engine|e)\.add$/, 'scenery', 'a whole code-built ground or block goes in level({ scene })'],
  [/\bscene\.add$/, 'scenery', 'a whole code-built ground or block goes in level({ scene })'],
  [/\bworld\.add$/, 'a world record', 'authored records are props entries with an id (template = kind)'],
  [/\bstream\.add$/, 'a streamed object', 'streamed scenery is a props entry; it streams through world.present'],
  [/\bcollision\.(addBox|addCircle|addObject)$/, 'a collider', 'a template carries collide: \'box\' | \'circle\''],
  [/\brigid\.(addBox|addBall|addHull|addVehicle)$/, 'a physics body', 'create the body in the world.present build of the record\'s kind, so the record (and its saved position) comes from content'],
  [/\binteractions\.add$/, 'an interaction', 'a template carries interact: { label, op }'],
  [/\brays\.addStatic$/, 'a ray target', 'template and props models are ray targets already (static)'],
  [/\binventory\.spawnPickup$/, 'a pickup', 'authored pickups go in content/pickups.js with an id'],
  [/\bnpcs\.add$/, 'an NPC', 'authored NPCs go in content/npcs.js'],
  [/\bentities\.spawn$/, 'an entity', 'authored things are template placements in content/props.js'],
  [/\bcontent\.spawn$/, 'a template instance', 'at setup it is authored: write it in content/props.js'],
  [/\bgrids\.add$/, 'a grid', 'grid layout is content data'],
  [/\binventory\.container$/, 'a container with goods', 'authored containers go in content/containers.js'],
];

const calleeText = call => call.expression.getText().replace(/\?\./g, '.').replace(/\s+/g, '');
const lastName = expr => ts.isPropertyAccessExpression(expr) ? expr.name.text : ts.isIdentifier(expr) ? expr.text : null;
const objArg = (call, key) => call.arguments.some(a => ts.isObjectLiteralExpression(a) && a.properties.some(p => p.name?.getText() === key
  && (!ts.isPropertyAssignment(p) || p.initializer.kind !== ts.SyntaxKind.FalseKeyword)));
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

/** Findings for one source text: [{ line, msg, fix }] (exported for the rule test) */
export function scan(sf) {
  const out = [];
  (function go(n) {
    if (ts.isCallExpression(n)) {
      const text = calleeText(n), hit = CALLEES.find(([re]) => re.test(text));
      if (hit && !(hit[0].source.includes('container') && !objArg(n, 'items'))) {
        const initial = /\bworld\.add$/.test(text) && objArg(n, 'initial');
        const ctx = initial ? 'setup' : contextOf(n, sf);
        if (ctx === 'setup') out.push({
          line: lineOf(n),
          msg: initial ? `${text}(…, { initial: true }) in game code: authored records come only from content loaders`
            : `${text}() places ${hit[1]} at setup (module top level or a startup event): the level is content, code holds only rules`,
          fix: `${CONTENT_HINT}; ${hit[2]}`,
        });
      }
    }
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
  id: 'R33', title: 'No authored placement in game code', game: true,
  run() {
    const out = [];
    for (const f of placementFiles()) {
      const L = read(f).split('\n');
      const level = f === P.GAMES_REL || f.startsWith(P.GAMES_REL + '/') ? 'warn' : 'error';
      for (const r of scan(parseText(f, read(f)))) if (!runtimeTag(L, r.line)) out.push({ level, file: f, ...r });
    }
    return out;
  },
};
