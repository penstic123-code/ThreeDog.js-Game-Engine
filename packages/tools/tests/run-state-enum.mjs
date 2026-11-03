// The MCP server instructions list the engine.runState states by hand (mcp-extra.mjs); this keeps that list equal to the states core/holds.js can produce.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE } from '../paths.mjs';
import { RUN_STATES } from '../threedog/mcp-extra.mjs';

export const name = 'MCP runState enum matches core/holds.js';

export async function run({ check }) {
  const src = readFileSync(join(ENGINE, 'core/holds.js'), 'utf8');
  const body = src.slice(src.indexOf('get runState()'));
  const stmt = body.slice(body.indexOf('const state ='), body.indexOf(';', body.indexOf('const state =')));
  const fromCore = [...new Set([...stmt.matchAll(/[?:]\s*'([a-z-]+)'/g)].map(m => m[1]))].sort();
  const fromMcp = [...RUN_STATES].sort();
  check('found the states in holds.js', fromCore.length >= 5, fromCore.join(', '));
  check('mcp-extra.mjs RUN_STATES equals the states runState returns', JSON.stringify(fromCore) === JSON.stringify(fromMcp), `core: ${fromCore.join(', ')} · mcp: ${fromMcp.join(', ')}`);
}
