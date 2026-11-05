// ── intent: the optional "Picture intent:" line of DESIGN.md, the one place a game declares what its picture wants ──
// Why a line of listed words and nothing else: free text read by keywords missed a rephrased wish ("lamps must not blind") silently, and two
// ways to declare could disagree. A word the list does not know is reported, never guessed.
export const INTENT_WORDS = {
  'bright': { want: 'bright' }, 'dark': { want: 'dark' }, 'high-contrast': { want: 'highContrast' }, 'low-contrast': { want: 'lowContrast' },
  'saturated': { want: 'saturated' }, 'muted': { want: 'muted' }, 'strong-light': { want: 'strongLight' },
  'dark-nights': { want: 'dark', when: 'night' }, 'bright-nights': { want: 'bright', when: 'night' },
  'no-glare': { want: 'noGlare' }, 'no-pitch-black': { want: 'noBlack' },
};
const INTENT_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?picture intent(?:\*\*)?\s*(?:\([^)]*\))?\s*(?:\*\*)?[ \t]*[:：][ \t]*(?:\*\*)?[ \t]*(.*)$/im;
const OPPOSITE = { bright: 'dark', dark: 'bright', highContrast: 'lowContrast', lowContrast: 'highContrast', saturated: 'muted', muted: 'saturated' };

/**
 * Declared picture words of a DESIGN.md text, from its "Picture intent:" line: [{ want, word, row: 'Picture intent', clause, when: 'night' | null }].
 * No line, or only "(none)": [] (numbers only, no judgement). An unlisted word comes back as want 'unknown'. Opposite words in one time
 * context are dropped (no clear intent).
 */
export function readIntent(text) {
  const line = (String(text ?? '').match(INTENT_LINE)?.[1].trim() ?? '').replace(/^\(.*\)$/, '');   // "(none yet)" is no intent, however many words it has
  const words = line.toLowerCase().split(/[\s,;，；、]+/).filter(w => w && !/^\(.*\)$/.test(w));
  return dropOpposites(words.map(w => INTENT_WORDS[w]
    ? { want: INTENT_WORDS[w].want, word: w, row: 'Picture intent', clause: w, when: INTENT_WORDS[w].when ?? null }
    : { want: 'unknown', word: w, row: 'Picture intent', clause: w, when: null }));
}
const dropOpposites = out => out.filter(a => !out.some(b => b.want === OPPOSITE[a.want] && (b.when === a.when || !b.when || !a.when)));
/** "differs from DESIGN.md: you wrote ..." for a declared wish, '' without one */
export const wrote = a => a ? `differs from DESIGN.md: you wrote '${a.clause}' (${a.row}); ` : '';
