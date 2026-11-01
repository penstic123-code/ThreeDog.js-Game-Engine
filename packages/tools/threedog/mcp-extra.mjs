// MCP tool definitions that sit next to the per-command ones in mcp.mjs: play, status, verify, and the "does it move time" label put in front of every tool
// description (the first words are what a client shows when it lists tools, so the rule that matters most goes first).
import { TIME } from './runtime.mjs';

const str = description => ({ type: 'string', description });

const LABEL = [
  [TIME.advances, 'ADVANCES GAME TIME.'],
  [TIME.frozenTimeSafe, 'Moves no game time.'],
  [TIME.observes, 'Observes only, changes nothing.'],
];
/** Tool name (underscore form) → label for the front of its description */
export const label = name => LABEL.find(([cmds]) => cmds.includes(name.replace('_', '-')))?.[1] ?? '';

/** The shape every tool result has (structuredContent), explained once at the front of the server instructions */
export const RESULT_SHAPE = 'Every result has text plus structuredContent { ok, code, summary, runtime: { ready, mode: running|paused|frozen|null, tick, headless, ' +
  'blockedBy[] }, data }. The text ends with one line on the game state and how to get back to normal play. ' +
  'step / press / hold / scenario / verify advance game time; op, state, eval and resume do not; everything else only observes.';

/** Declared for every tool: the same object comes back as structuredContent. data stays short; ask a narrower command for detail */
export const OUTPUT_SCHEMA = { type: 'object', required: ['ok', 'code', 'summary', 'runtime'], properties: {
  ok: { type: 'boolean' },
  code: { type: 'string', enum: ['ok', 'blocked', 'not-ready', 'no-server', 'starting', 'page-error', 'no-bridge', 'command-error'],
    description: 'blocked = the command ran and was refused or found a problem; not-ready = the page is not ready; no-server / starting / page-error / no-bridge = the tool cannot reach the game; command-error = bad arguments or an exception in the page' },
  summary: { type: 'string' },
  runtime: { type: 'object', required: ['ready', 'mode', 'tick', 'blockedBy'], properties: { ready: { type: 'boolean' }, mode: { enum: ['running', 'paused', 'frozen', null] },
    tick: { type: ['number', 'null'] }, headless: { type: 'boolean' }, blockedBy: { type: 'array', items: { type: 'string' } } } },
  data: { description: 'Short, command-specific; null when the text says it all' } } };

export const EXTRA_TOOLS = {
  play: {
    description: 'Start the game and connect: starts the dev server if none runs (detached), waits for the dev bridge and the engine, returns the page address and ' +
      'whether a headless or a live browser page is connected. Call this first when no game is running. stop: true stops the server play started.',
    schema: { type: 'object', properties: { stop: { type: 'boolean', description: 'Stop the dev server that play started' } }, required: [] },
    args: a => a.stop ? ['--stop'] : [],
  },
  status: {
    description: 'One call answers: is the engine ready, is loading done, are there page errors, is the game running / paused / frozen. When the bridge cannot answer ' +
      'it names the cause (no server, server still starting, page script error, no dev bridge installed) with the one next step.',
    schema: { type: 'object', properties: {}, required: [] },
    args: () => [],
  },
  verify: {
    description: 'Run a scenario file (tests/scenarios/<name>.json) and report pass or fail plus what it tested and what it never touched (ops never run, describe ' +
      'sections never compared, steps skipped after a failure), the tests related to an error code, and the command to re-run it. A page error during the run fails it.',
    schema: { type: 'object', properties: { name: str('Scenario file name without .json') }, required: ['name'] },
    args: a => [a.name],
  },
};
