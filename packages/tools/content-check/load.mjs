// The reading part of content validation (used by packages/tools/content-check.mjs and gamemap.mjs): find game folders, read content/ data, find duplicate keys in one object, infer a game's style pack and asset manifest.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, rel, abs, gameDirs, CONTENT_RULES_REL, STYLES_REL, ENGINE_PKG } from '../paths.mjs';

// The engine's content vocabulary (path read from paths.mjs); content-check.mjs and gamemap.mjs also take mergeRules etc. from here
const rules = await import(pathToFileURL(abs(CONTENT_RULES_REL)).href);
const { contentFiles, unknownContent } = rules;
export const { mergeRules, CLOCK_RE, describeCond, describeEffect, NO_GAME_EFFECTS, kindProblems } = rules;
export { ROOT, rel };

/** All game folders: those in packages/engine/examples/* and games/* that have a main.js (gameDirs in paths.mjs) */
export const findGames = gameDirs;

/** Read all content files of a game: { data: { items, … }, files: { items: path }, errors } */
export async function loadGame(dir) {
  const data = {}, files = {}, errors = [];
  const cdir = join(dir, 'content');
  if (!existsSync(cdir)) return { data, files, errors };
  // rules.js first: its kinds decide which other file names are known (the same contentFiles() the engine loader uses)
  const names = readdirSync(cdir).filter(f => f.endsWith('.js') && f !== 'index.js').map(f => f.slice(0, -3)).sort((a, b) => (b === 'rules') - (a === 'rules'));
  for (const name of names) {
    const path = join(cdir, name + '.js');
    if (!contentFiles(data.rules)[name]) { errors.push(`${rel(path)}: ${unknownContent(name, data.rules)}`); continue; }
    try {
      const mod = await import(pathToFileURL(path).href);
      data[name] = mod.default; files[name] = path;
      if (mod.startItems) { data.startItems = mod.startItems; files.startItems = path; }
    } catch (err) { errors.push(`${rel(path)}: the file cannot be loaded (most likely a syntax error, such as a missing comma or bracket): ${err.message}`); }
  }
  return { data, files, errors };
}

// Two identical keys in one object (JS silently lets the later one overwrite, so they must be found in the source)
export function dupKeys(src) {
  const out = [], stack = [];
  let i = 0, line = 1, last = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const j = src.indexOf('*/', i) + 2; line += src.slice(i, j).split('\n').length - 1; i = j; continue; }
    const top = stack[stack.length - 1];
    if (top?.keys && (last === '{' || last === ',')) {
      const m = /^(?:([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)|'([^'\\]*)'|"([^"\\]*)")\s*:/.exec(src.slice(i, i + 200));
      if (m) {
        const k = m[1] ?? m[2] ?? m[3];
        if (top.keys.has(k)) out.push({ key: k, line, first: top.keys.get(k) }); else top.keys.set(k, line);
        i += m[0].length; last = ':'; continue;
      }
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) { if (src[j] === '\\') j++; if (src[j] === '\n') line++; j++; }
      i = j + 1; last = 'v'; continue;
    }
    if (ch === '{') stack.push({ keys: new Map() });
    else if (ch === '[' || ch === '(') stack.push({});
    else if ('}])'.includes(ch)) stack.pop();
    last = ch; i++;
  }
  return out;
}

/**
 * Model names and level source a game uses (inferred statically from the game code):
 *   style        style pack name (main.js etc. import packages/engine/styles/<name>/), null if it cannot be inferred
 *   styleModels  model names in the style pack's models.js (a Set), null if there is no style pack
 *   manifest     model names registered by assets.manifest({ models: { name: … } })
 *   levelFile    the level is a file (level({ url })): markers are inside the .glb and cannot be read statically
 */
export function gameSetup(dir, code) {
  const style = code.match(/from\s+['"](?:\.\.\/)+styles\/([\w-]+)\//)?.[1] ?? code.match(new RegExp(`from\\s+['"]${ENGINE_PKG}/styles/([\\w-]+)['"/]`))?.[1] ?? null;
  const modelsFile = style && join(abs(STYLES_REL), style, 'models.js');
  const styleModels = modelsFile && existsSync(modelsFile) ? new Set([...readFileSync(modelsFile, 'utf8').matchAll(/^ {2}(\w+):/gm)].map(m => m[1])) : style ? new Set() : null;
  const manifest = new Set();
  for (const m of code.matchAll(/manifest\(\s*\{[\s\S]*?models:\s*\{([^}]*)\}/g)) for (const k of m[1].matchAll(/(?:^|,)\s*['"]?([\w\u4e00-\u9fff-]+)['"]?\s*:/g)) manifest.add(k[1]);
  const levelFile = /\blevel\(\s*\{[^}]*\burl\s*:/.test(code);
  return { style, styleModels, manifest, levelFile };
}

