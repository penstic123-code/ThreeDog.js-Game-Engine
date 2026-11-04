// Read 'file.js:50' places out of an Error stack: where a thing was added (things.js) or took
// a shared point (sharedPoint.js: the conflict error names both sides' lines).
// Why one file: the two copies of the frame regex drifted apart once already (a query string after the file name, a Windows path), and a fix made in
// one never reached the other. Both read V8 and Firefox / Safari frame lines ("at f (http://host/src/main.js?v=1:50:7)" and "f@http://host/src/main.js:50:7").
import { DEV } from './validate.js';
const FRAME = /\(?((?:[a-z]+:\/\/[^/\s]+)?[^\s()]+?\.[cm]?[jt]sx?)(?:\?[^:\s)]*)?:(\d+):\d+\)?\s*$/i;
const FUNC = /^[^@\s/]*@(?=[a-z]+:\/\/)/i;
const NAME = /^\s*(?:at\s+(?:async\s+)?([^\s(]+(?: \[as [^\]]+\])?)\s+\(|([^@\s/]+)@)/;   // V8 "at name (file" / Firefox "name@file"; none for an anonymous function

/**
 * The frames of a stack text that name a source file, outermost call last: [{ file, line, fn }]. fn: the function name, '' when anonymous. file keeps its URL host (so a caller can tell engine
 * files from game files by path) with Windows backslashes turned into slashes.
 * @param {string} stack @returns {{ file: string, line: number, fn: string }[]}
 */
export function stackFrames(stack) {
  const out = [];
  // FUNC: a Firefox / Safari line puts the function name before the URL ("add@http://..."); dropped only before a scheme, so '/@scope/' paths stay
  for (const l of String(stack ?? '').split('\n')) { const f = FRAME.exec(l); if (f) { const n = NAME.exec(l); out.push({ file: f[1].replace(FUNC, '').replace(/\\/g, '/'), line: +f[2], fn: n?.[1] ?? n?.[2] ?? '' }); } }
  return out;
}

/** 'src/main.js:50' for a frame: the URL host and leading slashes dropped, so the text matches the repository path @param {{ file: string, line: number }} f */
export const frameText = f => `${f.file.replace(/^[a-z]+:\/\/[^/]+\//i, '').replace(/^\/+/, '')}:${f.line}`;

const ENGINE_FRAME = /(?:engine|threedog)\/(?:core|modules|render|ui)\//;   // engine code (engine.mod called from inside the engine) is skipped: `at` names the game's line
const ENGINE_PARTS = /^(?:core|modules|render|ui)\//;
// the engine's own folder as this page's server names it. Why not only the path pattern above: a page served from the engine's folder (its tests) has
// /core/x.js with no 'engine' in it, and a game's own core/ folder must not pass for the engine's. String work, not new URL('..', import.meta.url): a bundler reads that form as an asset
const engineDir = () => import.meta.url.replace(/\?.*$/, '').replace(/[^/]*\/[^/]*$/, '');

/** Is this frame file the engine's own code? @param {string} file a frame's file */
export function engineFile(file) {
  const dir = engineDir();
  return ENGINE_FRAME.test(file) || (file.startsWith(dir) && ENGINE_PARTS.test(file.slice(dir.length)));
}

/** 'main.js:50' of the first caller outside the engine (dev only: release builds keep no stacks) */
export function callerAt() {
  if (!DEV) return null;
  const E = /** @type {ErrorConstructor & { stackTraceLimit?: number }} */ (Error);   // stackTraceLimit is V8's (Chrome), not in the DOM typings
  const lim = E.stackTraceLimit; E.stackTraceLimit = 14;
  const stack = String(new Error().stack ?? ''); E.stackTraceLimit = lim;
  const f = stackFrames(stack).find(x => !engineFile(x.file));
  return f ? frameText(f) : null;
}
