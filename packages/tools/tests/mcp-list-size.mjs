// The MCP tool list stays small: it is loaded into every session, so a block repeated per tool is paid 29 times.
// Why: every tool declared the full result schema as its outputSchema (one identical 1.2 KB object, 72% of the 49.6 KB list). The result shape is
// now explained once in the server instructions; each tool keeps only a minimal outputSchema (object + required keys), which the protocol allows.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { ROOT, TOOLS } from '../paths.mjs';
import { RUN_STATES } from '../threedog/mcp-extra.mjs';

export const name = 'MCP tools/list: no per-tool copy of the result schema, the shape is in the instructions once, the list stays under 20 KB';

const listOf = () => new Promise((res, rej) => {
  const c = spawn(process.execPath, [join(TOOLS, 'bin', 'threedog.mjs'), 'mcp'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
  const got = {}, t = setTimeout(() => { c.kill(); rej(new Error('no answer within 60 s')); }, 60000);
  createInterface({ input: c.stdout }).on('line', l => { const m = JSON.parse(l); got[m.id] = m.result; if (got[1] && got[2]) { clearTimeout(t); c.kill(); res(got); } });
  c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
  c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
});

export async function run({ check }) {
  const { 1: info, 2: list } = await listOf();
  const bytes = Buffer.byteLength(JSON.stringify(list)), schema = Math.max(...list.tools.map(t => JSON.stringify(t.outputSchema ?? {}).length));
  check('tools/list is under 20 KB', bytes < 20000, `${bytes} bytes`);
  check('each outputSchema is minimal (an object with the required keys, under 200 characters)', list.tools.every(t => t.outputSchema?.type === 'object'
    && ['ok', 'code', 'summary', 'runtime'].every(k => t.outputSchema.required?.includes(k))) && schema < 200, `largest ${schema} characters`);
  check('the instructions explain the result shape once: the codes and the run states', ['blocked', 'not-ready', 'no-server', 'command-error', ...RUN_STATES].every(w => info.instructions.includes(w)),
    info.instructions.slice(0, 400));
}
