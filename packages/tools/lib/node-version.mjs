// The Node versions the tools run on: the range vite 8 needs (its engines field). The "engines" of every package.json in the repository and the
// new-game template carry this same string (tests/cli-surface.mjs checks it).
// Why: on an older Node vite fails deep inside its own code with an unrelated-looking error; this check names the version and the fix first.

export const NODE_RANGE = '^20.19.0 || >=22.12.0';
/** Why vite cannot work from this folder, or null. It reads a path as a URL, so a # ends the path: the build stops and the dev page never gets its game. Measured on vite 8, build and dev @param {string} dir */
export const pathProblem = dir => dir.includes('#') ? `${dir}: the path has a #, and vite cannot build or serve a folder like that. Rename the folder (or the folder above it) without the #` : null;

export const NODE_FIX = 'install the current Node LTS from https://nodejs.org (Windows: winget install OpenJS.NodeJS.LTS), then close and reopen the terminal';

/** True when `version` ("20.19.1" or "v22.12.0") is inside NODE_RANGE */
export function nodeSupported(version) {
  const [maj, min] = version.replace(/^v/, '').split('.').map(Number);
  return maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19);
}

/** null when the running Node is supported, otherwise the message to print: found version, required range, fix */
export function nodeProblem(version = process.versions.node) {
  return nodeSupported(version) ? null : `Node ${version} is not supported (threedog needs Node ${NODE_RANGE}, which vite 8 requires)`;
}
