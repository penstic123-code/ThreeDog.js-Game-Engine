#!/usr/bin/env node
// Runs run.mjs over a list of cases, one fresh Chrome each, appending one JSON line per case to the output file (a case that times out is recorded as such).
//   node sweep.mjs <out.jsonl> <backend> <method> '<json list of arg objects>' [timeoutSeconds=330]
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [out, backend, method, list, secs = '330'] = process.argv.slice(2);
const run = fileURLToPath(new URL('./run.mjs', import.meta.url));
for (const params of JSON.parse(list)) {
  const r = spawnSync(process.execPath, [run, method, JSON.stringify(params), `--backend=${backend}`, '--no-build'], { encoding: 'utf8', timeout: +secs * 1000, maxBuffer: 1 << 26 });
  const line = (r.stdout ?? '').trim().split('\n').at(-1);
  appendFileSync(out, (line && line.startsWith('{') ? line : JSON.stringify({ method, backend, params, failed: r.error ? String(r.error.message) : 'no output', stderr: (r.stderr ?? '').slice(-300) })) + '\n');
}
appendFileSync(out, 'DONE\n');
