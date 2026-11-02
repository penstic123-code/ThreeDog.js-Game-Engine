// Read 'file.js:50' places out of an Error stack: where a thing was added (things.js) and which game line set a look value (look/layers.js).
// Why one file: the two copies of the frame regex drifted apart once already (a query string after the file name, a Windows path), and a fix made in
// one never reached the other. Both read V8 and Firefox / Safari frame lines ("at f (http://host/src/main.js?v=1:50:7)" and "f@http://host/src/main.js:50:7").
const FRAME = /\(?((?:[a-z]+:\/\/[^/\s]+)?[^\s()]+?\.[cm]?[jt]sx?)(?:\?[^:\s)]*)?:(\d+):\d+\)?\s*$/i;
const FUNC = /^[^@\s/]*@(?=[a-z]+:\/\/)/i;

/**
 * The frames of a stack text that name a source file, outermost call last: [{ file, line }]. file keeps its URL host (so a caller can tell engine
 * files from game files by path) with Windows backslashes turned into slashes.
 * @param {string} stack @returns {{ file: string, line: number }[]}
 */
export function stackFrames(stack) {
  const out = [];
  // FUNC: a Firefox / Safari line puts the function name before the URL ("add@http://..."); dropped only before a scheme, so '/@scope/' paths stay
  for (const l of String(stack ?? '').split('\n')) { const f = FRAME.exec(l); if (f) out.push({ file: f[1].replace(FUNC, '').replace(/\\/g, '/'), line: +f[2] }); }
  return out;
}

/** 'src/main.js:50' for a frame: the URL host and leading slashes dropped, so the text matches the repository path @param {{ file: string, line: number }} f */
export const frameText = f => `${f.file.replace(/^[a-z]+:\/\/[^/]+\//i, '').replace(/^\/+/, '')}:${f.line}`;
