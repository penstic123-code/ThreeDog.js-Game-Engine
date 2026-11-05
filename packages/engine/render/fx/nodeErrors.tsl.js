// Naming the game's TSL code when it fails later, inside three's node build (WebGPU route): shader patches (patchNodes.tsl.js) and post effect
// nodes (postWebGPU.tsl.js) run the game's code to get a node, and three builds that node only when it first draws. An error then (a null
// input: "Cannot read properties of null (reading 'build')") comes out of three's own build loop with no trace of the game's code, and the
// mesh silently draws as three's default material. Two checks for the code the engine runs:
//   nameNodeBuild: the returned node's build / getNodeType rethrow any error with the owner's label ("[threedog] patch 'x' (slot y)"), so
//     three's 'TSL:' log names it. Every call from a parent node to a child goes through one of the two, so an error anywhere under the
//     node passes through them; the innermost label wins (a patch's node holds the previous patch's value as an input).
//   lostStatements: TSL statements (Loop, If, assign, break) need a current stack, which only exists inside an Fn or while three builds.
//     Outside one three drops a Loop with no error (Stack() does nothing without a stack), and the effect silently vanishes. In dev the code
//     runs with a probe stack and a warning names the owner if a statement landed on it (it is still dropped, as three does). Why the caller
//     says "outside the build" instead of reading getCurrentStack(): a build that threw leaves three's current stack set to a dead stack.
import * as TSL from 'three/tsl';
import { DEV, warnOnce } from '../../core/base/validate.js';
import { codedError, coded } from '../../core/base/errorHints.js';

// what lands on a stack only as a statement (plain nodes made while a stack is current are listed on it too, and are harmless)
const STATEMENTS = new Set(['LoopNode', 'AssignNode', 'ConditionalNode', 'ExpressionNode']);
// three's exported nodes (materialColor, positionLocal ...) are shared by every material: never labelled, a patch returning one owns none of it
const SHARED = new Set(Object.values(TSL).filter(x => /** @type {any} */ (x)?.isNode));
const LABELLED = /^\[threedog\] (patch|post effect) '/;

/**
 * Label errors raised while three builds `node` (and everything under it) with `label`; returns the node. A node already labelled, one of
 * three's shared nodes, or `same` (the value the code was handed, returned unchanged) is left alone.
 * @internal render/fx/patchNodes.tsl.js, render/fx/postWebGPU.tsl.js
 * @template T @param {T} node @param {string} label  "[threedog] patch 'x' (slot y)" @param {any} [same] @returns {T}
 */
export function nameNodeBuild(node, label, same) {
  const n = /** @type {any} */ (node);
  if (!n?.isNode || n === same || Object.hasOwn(n, 'build') || SHARED.has(n)) return node;
  for (const k of ['build', 'getNodeType']) {
    const own = n[k];
    // not enumerable: three walks a node's enumerable properties for its children and cache key
    Object.defineProperty(n, k, { configurable: true, writable: true, enumerable: false, value: function (...a) {
      try { return own.apply(this, a); } catch (e) { throw labelled(e, label); }
    } });
  }
  return node;
}

/** @param {any} e @param {string} label */
function labelled(e, label) {
  const msg = String(e?.message ?? e);
  if (LABELLED.test(msg)) return e;
  const err = /** @type {any} */ (Object.assign(codedError('shader-patch', `${label}: ${msg} (raised while three built the node it returned; `
    + 'often a node made for another material or slot, or a null input)'), { cause: e }));
  // three's 'TSL:' log points at the first non-three frame of stackTrace (the node's creation site when Node.captureStackTrace is on)
  if (e?.stackTrace) err.stackTrace = e.stackTrace;
  if (e?.stack) err.stack = `${err.name}: ${err.message}\n${String(e.stack).split('\n').slice(1).join('\n')}`;
  return err;
}

/**
 * Run fn (the game's TSL code, called outside three's build); in dev, warn naming `label` when it issued statements no stack holds (three drops them).
 * @internal render/fx/patchNodes.tsl.js, render/fx/postWebGPU.tsl.js
 * @template T @param {string} label @param {() => T} fn @returns {T}
 */
export function lostStatements(label, fn) {
  if (!DEV) return fn();
  const probe = /** @type {any} */ (TSL.stack()), prev = TSL.getCurrentStack();
  TSL.setCurrentStack(probe);
  try { return fn(); } finally {
    TSL.setCurrentStack(prev);
    const kinds = [...new Set(probe.nodes.map(n => n.type).filter(t => STATEMENTS.has(t)))];
    if (kinds.length) warnOnce(coded('tsl-misuse', `${label}: TSL statements outside an Fn (${kinds.join(', ')}) are dropped by three with no error, `
      + 'so what they compute never reaches the picture. Put the code that uses Loop / If / assign inside Fn(() => { ...; return result; })() (recipe 56 "Mistakes")'));
  }
}
