// Node-side scan for tests/specs (no browser): every error code the engine source raises by a literal name, and where.
// Read by the "[guard] error codes" spec in tests/specs/core-review.mjs: a code thrown but missing from ERROR_CODES has no fix and no docs
// (err.fix null), which is the part of the error an AI needs most, so a missing entry must fail the suite instead of shipping.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'tests', 'docs', 'public', 'examples', 'dist', 'types']);
// codedError('x', ...) / coded('x', ...), and a message that ends with or starts with a literal [x] tag (hand-built errors)
const CALL = /\b(?:codedError|coded)\(\s*'([a-z0-9-]+)'/g;
const TAG = /\s\[(?!data-)([a-z0-9]+(?:-[a-z0-9]+)+)\]['"`]/g;   // after a space, not data-*: '[data-nav]' CSS selectors are not codes
const LEAD = /(?:Error|warnOnce|warn)\(\s*['"`]\[([a-z0-9]+(?:-[a-z0-9]+)+)\]/g;

/** @returns {Map<string, string[]>} code -> files that raise it */
export function usedCodes() {
  const out = new Map(), files = [];
  const walk = d => { for (const n of readdirSync(d)) { if (SKIP.has(n)) continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.js')) files.push(p); } };
  walk(ROOT);
  for (const f of files) {
    const s = readFileSync(f, 'utf8'), rel = relative(ROOT, f).replace(/\\/g, '/');
    for (const re of [CALL, TAG, LEAD]) for (const m of s.matchAll(re)) out.set(m[1], [...new Set([...(out.get(m[1]) || []), rel])]);
  }
  return out;
}

/** Codes raised in the source but not registered, as "code (files)" lines */
export async function unregistered() {
  const { ERROR_CODES } = await import(new URL('../core/base/errorCodes.js', import.meta.url).href);
  return [...usedCodes()].filter(([k]) => !ERROR_CODES[k]).map(([k, f]) => `${k} (${f.join(', ')})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log((await unregistered()).join('\n') || 'all registered');
