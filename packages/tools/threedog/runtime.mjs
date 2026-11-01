// What state the running game is in, as data (runtime) and as one plain sentence (trailer). Every bridge command result carries it, so an AI that
// just pressed a key knows at once whether the game now runs, is paused (and how to resume) or is frozen by a menu, without a second command.
//   runtime = { ready, mode: 'running' | 'paused' | 'frozen' | null, tick, headless, blockedBy: string[] }
//   mode null = no engine could be read (server down, page still loading); blockedBy entries are "window:settings", "dialogue", "cutscene", "error", "loading".

/** Runs in the page (self-contained, sent as source). Reads only public engine fields, never waits, never throws. */
export const RUNTIME_FN = () => {
  const e = window.engine;
  if (!e) return { attached: false };
  let d = {};
  try { d = e.describe(); } catch { /* describe can throw before start() finishes */ }
  const by = [];
  for (const w of d.ui?.windows ?? []) by.push('window:' + (w.id || w));
  if (d.ui?.dialogue) by.push('dialogue');
  if (d.cutscene) by.push('cutscene');
  if (e.error) by.push('error');
  const lv = e.loading?.view?.();
  if (lv?.blocked) by.push('loading');
  return { attached: true, ready: !!e.stateApplied, paused: !!e.paused, frozen: !!e.frozen, headless: !!e.headless, tick: e.tick ?? null, blockedBy: by,
    loading: lv ? { done: lv.done, waiting: lv.waiting, failed: lv.failed.length, blocked: !!lv.blocked } : null, page: location.pathname + location.search };
};

const NONE = { ready: false, mode: null, tick: null, headless: false, blockedBy: [] };

/** Raw page reading → runtime. Without an engine: ready false, mode null */
export function toRuntime(raw) {
  if (!raw?.attached) return { ...NONE };
  return { ready: raw.ready, mode: raw.frozen ? 'frozen' : raw.paused ? 'paused' : 'running', tick: raw.tick, headless: raw.headless, blockedBy: raw.blockedBy };
}

/** Read it through a driver; a driver that cannot answer (page reloading, bridge down) gives the empty runtime, never an exception */
export async function readRuntime(driver, ms = 5000) {
  try {
    const raw = await Promise.race([driver.evaluate(RUNTIME_FN.toString()), new Promise((_, no) => setTimeout(no, ms).unref())]);
    return { runtime: toRuntime(raw), raw };
  } catch { return { runtime: { ...NONE }, raw: null }; }
}

/** What each blocker means for the player and how to clear it */
const BLOCK = (b) => {
  if (b.startsWith('window:')) return `the ${b.slice(7)} window is open (press menu or its close action closes it)`;
  return { dialogue: 'a dialogue is open (finish it: press interact, or op dialogue.choose)', cutscene: 'a cutscene is playing (threedog state cutscene=skip)',
    error: 'the engine froze gameplay on an error (threedog errors)', loading: 'startup is blocked by a failed asset (threedog loading)' }[b] ?? b;
};

/** One sentence: the state and the way back to normal, in plain words */
export function trailer(rt) {
  if (rt.mode === null) return 'No engine answered: the page is still loading or no game page is connected (threedog status says which).';
  const at = rt.tick === null ? '' : `, tick ${rt.tick}`, why = rt.blockedBy.map(BLOCK);
  if (!rt.ready) return `Engine still starting${at}: assets are loading or state is being applied (threedog loading shows what it waits for).`;
  if (rt.mode === 'frozen') return `Gameplay frozen${at}: game time and movement stop while the picture keeps rendering${why.length ? '; ' + why.join('; ') : ''}.`;
  const open = why.length ? ` Open: ${why.join('; ')}.` : '';
  if (rt.mode === 'paused') return (rt.headless ? `Headless page paused${at}: time moves only on step / press / hold, no resume needed.`
    : `Game paused${at}: threedog resume restores real-time running.`) + open;
  return `Game running in real time${at}: step / press / hold pause it first.` + open;
}

/**
 * Which commands move game time. Shown at the front of every MCP tool description and used by `threedog help`-style listings.
 * advances: step, press, hold (and scenario, which uses them); op / state / eval / ops run between steps and move no game time.
 */
export const TIME = {
  advances: ['step', 'press', 'hold', 'scenario', 'verify'],
  frozenTimeSafe: ['op', 'state', 'eval', 'js', 'resume', 'reload'],
  observes: ['describe', 'ops', 'inspect', 'scene', 'pick', 'explain', 'loading', 'errors', 'snap', 'snap-describe', 'status'],
};
