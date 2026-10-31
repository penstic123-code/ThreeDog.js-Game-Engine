// Wait for the engine in the page to be ready (shared by the dev bridge, npm test, npm run shot and the pack check).
// A timeout does not just say "Timeout 90000ms exceeded": it waits in two stages and says the reason and fix for the one that failed.
//   Stage 1 (grace, 40 s by default): the page must have window.engine. Forgetting this line in main.js is the most common cause, so there is no point waiting 90 s
//   Stage 2 (timeout): engine is attached, wait for its stateApplied / ready. A cold start with software rendering + world generation can take a minute, so this stage is long
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIX = 'in main.js, before await engine.start(), write: window.engine = engine; (under the dev server engine.start() attaches it automatically, but npm test / the built version do not)';

/** The last few page errors: the errors array the caller collected, or .threedog/errors.log under dir (written by the dev server) */
function recentErrors(dir, errors) {
  if (errors?.length) return errors.slice(-3).map(s => '    ' + String(s).split('\n')[0].slice(0, 160));
  const log = dir && join(dir, '.threedog/errors.log');
  if (!log || !existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(l => l.trim()).slice(-4).map(l => '    ' + l.slice(0, 160));
}

/**
 * @param {import('playwright').Page} page
 * @param {{ field?: 'stateApplied'|'ready', timeout?: number, grace?: number, dir?: string, errors?: string[] }} [o]
 *   field: which engine field to wait for to be true; dir is where to find .threedog/errors.log; errors are the page errors the caller already collected
 */
export async function waitEngine(page, { field = 'stateApplied', timeout = 90000, grace = 40000, dir, errors } = {}) {
  const fail = async (why, fix) => {
    const s = await page.evaluate(() => ({ url: location.href, has: !!window.engine, ready: window.engine?.ready, applied: window.engine?.stateApplied })).catch(() => ({ url: page.url(), has: false }));
    const errs = recentErrors(dir, errors);
    throw new Error([`timed out waiting for the engine in the page: ${why}`,
      `  page ${s.url} · window.engine ${s.has ? 'attached' : 'missing'}${s.has ? ` · engine.ready=${s.ready} · stateApplied=${s.applied}` : ''}`,
      errs.length ? '  recent page errors:\n' + errs.join('\n') : '  no page errors recorded',
      '  Fix: ' + fix].join('\n'));
  };
  const g = Math.min(grace, timeout);
  try { await page.waitForFunction(() => !!window.engine, null, { timeout: g }); }
  catch { await fail(`no window.engine on the page within ${Math.round(g / 1000)} s`, `${FIX}; or this page is not a game page (it creates no engine); fix any errors first`); }
  // a critical asset that failed stops start() for good: stop waiting at once and say which file (engine.loading, core/Loading.js)
  try { await page.waitForFunction(f => window.engine?.[f] || window.engine?.loading?.view().blocked, field, { timeout }); }
  catch { await fail(`window.engine exists, but ${field} stayed falsy for ${Math.round(timeout / 1000)} s`,
    'engine.start() did not finish or is stuck: check the errors above first; not calling await engine.start() has the same effect' + (field === 'stateApplied' ? '; a very large wait= in the URL also waits long' : '')); }
  const failed = await page.evaluate(() => (window.engine.loading?.view().blocked ? window.engine.loading.view().failed : null));
  if (failed) await fail(`start() is blocked: ${failed.map(f => `${f.kind} "${f.name}" ${f.error.url ?? ''} ${f.error.message}`).join('; ').slice(0, 300)}`,
    'fix the path or the file; if the game can run without it, remove critical: true from its manifest entry (threedog loading shows every failure)');
}
