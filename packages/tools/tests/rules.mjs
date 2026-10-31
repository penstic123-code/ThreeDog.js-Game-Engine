// Rule tests (no browser): R7 reads the cancel convention from .claude/rules/api-design.md and must report an error, never skip silently, when it cannot find it.
// The parser is fed fixture texts here, so the test does not depend on the real doc.
import { conventionFromText } from '../rules/R07-naming.mjs';

export const name = 'rule R7: cancel convention parser';

const doc = line => `# API design\n\nintro\n\n## Interface conventions\n\n- Position arguments are objects.\n${line}\n- Other line.\n\n## Other section\n\nCancel convention: returns a cancel function off()\n`;

export async function run({ check }) {
  check('"handle with remove()" → handle', conventionFromText(doc('Cancel convention: returns a handle with remove()')).kind === 'handle');
  check('"handle" alone → handle', conventionFromText(doc('Cancel convention: a handle')).kind === 'handle');
  check('"cancel function off()" → off', conventionFromText(doc('Cancel convention: returns a cancel function off()')).kind === 'off');
  check('"stop()" → stop', conventionFromText(doc('Cancel convention: returns { stop() }')).kind === 'stop');
  check('no "## Interface conventions" section → error', !!conventionFromText('# API design\n\nCancel convention: a handle\n').error);
  check('the line must be inside that section, not in a later one', !!conventionFromText('## Interface conventions\n\n- x\n\n## Later\n\nCancel convention: a handle\n').error);
  check('section without a "Cancel convention:" line → error', !!conventionFromText(doc('- no cancel line here')).error);
  check('a line naming none of the three → error', !!conventionFromText(doc('Cancel convention: call dispose()')).error);
}
