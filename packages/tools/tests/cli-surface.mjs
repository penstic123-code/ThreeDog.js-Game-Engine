// The CLI surface an AI meets first: page arguments, options, which workspace a bridge command talks to, the art-code scope of R1, and COMMANDS.md.
// Why a unit test: each of these failed silently in a real session (Git Bash turned "/" into "C:/Git/", `shot --out` was ignored, `threedog catalog`
// at the repo root said "no dev server" while a game's ran, a 21 KB art generator was "too big", `threedog hold` was missing from COMMANDS.md).
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { ROOT, ENGINE, TOOLS, workspaceFor, workspaces, isArtFile } from '../paths.mjs';
import { devServerInfo } from '../devinfo.mjs';
import { pagePath, parseOptions } from '../lib/cli-args.mjs';
import { SCRIPTS, BRIDGE, VITE, main } from '../bin/threedog.mjs';
import { BRIEF } from '../threedog/pageFns.mjs';
import { oneLine, ONE_LINE_MAX } from '../lib/oneline.mjs';
import { NODE_RANGE, nodeSupported } from '../lib/node-version.mjs';

export const name = 'cli surface: MSYS page paths, unknown options, live dev server pick, R1 art files, every command in COMMANDS.md, Node version preflight';

const throws = fn => { try { fn(); return ''; } catch (e) { return e.message; } };

export async function run({ check }) {
  // ── page paths rewritten by Git Bash ──
  const git = p => p === 'C:/Git/usr/bin/msys-2.0.dll' || p === 'C:/Program Files/Git/usr/bin/msys-2.0.dll';
  check('"C:/Git/" (Git Bash\'s "/") becomes "/"', pagePath('C:/Git/', { exists: git, env: {} }) === '/');
  check('a page and its query survive', pagePath('C:/Program Files/Git/styletest.html?view=room', { exists: git, env: {} }) === '/styletest.html?view=room');
  check('a normal page path is left alone', pagePath('/tests/city/index.html') === '/tests/city/index.html' && pagePath('styletest') === 'styletest');
  check('no Git root found: the error names the three ways out', /without the slash.*MSYS_NO_PATHCONV=1.*PowerShell/.test(throws(() => pagePath('D:/x/y.html', { exists: () => false, env: {} }))));
  // npm run hands its children Git Bash's environment: EXEPATH names the root even where no msys dll is found under it
  const bash = { MSYSTEM: 'MINGW64', EXEPATH: 'D:\\Tools\\Git\\bin' }, none = () => false;
  check('EXEPATH root undone without the dll lookup ("/", a page with a query, any case)', pagePath('D:/Tools/Git/', { exists: none, env: bash }) === '/'
    && pagePath('d:/tools/git/index.html?play', { exists: none, env: bash }) === '/index.html?play');
  check('EXEPATH only counts under Git Bash (MSYSTEM set) and only as a whole folder', /Windows path/.test(throws(() => pagePath('D:/Tools/Git/x', { exists: none, env: { EXEPATH: bash.EXEPATH } })))
    && /Windows path/.test(throws(() => pagePath('D:/Tools/Github/x', { exists: none, env: bash }))));
  const po = parseOptions(['styletest', '--play'], { page: '/', flags: ['play'] }), pd = parseOptions([], { page: '/' });
  check('parseOptions keeps the argument as typed next to the page (shot names an undone rewrite), null when none was given', po.pageArg === 'styletest' && po.opt.play === true && pd.pageArg === null, JSON.stringify([po, pd]));

  // ── the one-line brief of a bridge command: engine.error is an object (printed "engine error [object Object]" once) ──
  const brief = BRIEF({ describe: () => ({ error: { where: 'onFixed', message: 'x is not iterable', code: 'some-code', at: 'at tick (main.js:91:12)' } }) }).join(' ');
  check('brief: an engine error shows code, where, message and the line that threw', brief.includes('engine error [some-code] onFixed: x is not iterable (at tick (main.js:91:12))') && !brief.includes('[object Object]'), brief);

  // ── one-line error summaries keep the end of the message (the requirement and the [code]); 为什么：重复行截到 120 字，"ending at 1" 被截掉 ──
  const sky = 'Error: style.sky.keyframes must be [time, zenith, horizon, lightColor, lightIntensity, ambientIntensity] rows sorted by time, starting at 0 and ending at 1, with no time repeated; got times [0, 0.25, 0.5, 0.75, 0.88] [sky-option]';
  check('oneLine: an engine validation message stays whole', oneLine(sky + '\n    at x (a.js:1:1)') === sky);
  const long = oneLine('x'.repeat(900) + ' ending at 1 [some-code]');
  check('oneLine: a longer one keeps its start and its end', long.length === ONE_LINE_MAX && long.endsWith('ending at 1 [some-code]') && long.includes(' … '), long.slice(-40));
  const cutters = ['threedog', 'vite'].flatMap(d => readdirSync(join(TOOLS, d)).filter(f => /\.m?js$/.test(f)).map(f => join(d, f))).concat('wait-engine.mjs')
    .filter(f => /(message|msg|String\(s\))\.split\([^)]*\)\[0\]\.slice\(0,/.test(readFileSync(join(TOOLS, f), 'utf8')));
  check('no error summary cuts the message tail itself (use lib/oneline.mjs oneLine)', !cutters.length, cutters.join(', '));

  // ── options: unknown ones fail instead of being ignored ──
  const spec = { flags: ['keep', 'look'], values: ['out', 'time'] };
  const ok = parseOptions(['/x.html', '--out', 'day.png', '--look', '--time=18:30'], { ...spec, page: '/' });
  check('values (both spellings), switches and the page are read', ok.opt.out === 'day.png' && ok.opt.look === true && ok.opt.time === '18:30' && ok.page === '/x.html');
  check('an unknown option fails with did-you-mean', /unknown option --ot; did you mean --out\?/.test(throws(() => parseOptions(['--ot', 'x.png'], spec))));
  check('a value option without its value fails', /--out needs a value/.test(throws(() => parseOptions(['--out', '--look'], spec))));
  check('a command without pages refuses a stray argument', /takes only options/.test(throws(() => parseOptions(['x'], { ...spec, page: null }))));
  const many = parseOptions(['a', '-j4', 'b', '-w', 'g', '--', '--c'], { positional: true, values: ['jobs'], short: { j: 'jobs' }, workspace: true });
  check('short spellings, -w, plain arguments and everything after -- are read', many.opt.jobs === '4' && many.workspace === 'g' && many.rest.join() === 'a,b,--c', JSON.stringify(many));
  check('-w is refused by a command that takes no workspace', /unknown option -w/.test(throws(() => parseOptions(['-w', 'g'], spec))));
  // 为什么：第二个页面参数以前悄悄顶掉第一个（shot a b 拍的是 b），被另一个选项架空的选项（shot --ref x --no-look）什么也不做也不说
  check('[guard] a second page argument fails instead of replacing the first', /one page argument.*"\/a\.html".*"b"/.test(throws(() => parseOptions(['/a.html', 'b'], { ...spec, page: '/' }))));
  // why: a repeated value option used to keep only the last one (check --rule R10 --rule R2 ran R2 alone and said 0 errors)
  check('[guard] a value option given twice fails naming both values', /--out given twice \("a\.png" and "b\.png"\)/.test(throws(() => parseOptions(['--out', 'a.png', '--out=b.png'], spec))));
  check('a list option given twice keeps both, comma-joined', parseOptions(['--rule', 'R10', '--rule=R2'], { values: ['rule'], lists: ['rule'] }).opt.rule === 'R10,R2');
  const off = { ...spec, flags: [...spec.flags, 'no-look'], values: [...spec.values, 'ref'], conflicts: [['ref', 'no-look', 'the reference is compared in the look check']] };
  check('[guard] an option another one switches off fails naming why', /--ref does nothing with --no-look: the reference is compared in the look check/.test(throws(() => parseOptions(['--ref', 'r.png', '--no-look'], off)))
    && parseOptions(['--ref', 'r.png'], off).opt.ref === 'r.png');
  const shot = readFileSync(join(ROOT, 'packages/tools/shot.mjs'), 'utf8');
  check('shot reads --out and parses through the shared parser', /\bcli\(process\.argv/.test(shot) && /shotFile\(dir, opt\.out/.test(shot));
  // [guard] one reading of options and -w: a tool that looks up its own switches in argv (argv.includes('--x')) or its own -w
  // (=== '-w') silently ignores a typo again. The allowed few read a switch that crosses process boundaries, each with its reason
  const HAND_OK = {
    'browser.mjs': '--gpu / --software are read where the browser starts, under every command that declared them',
    'lib/scope.mjs': '--tally-json is passed by check to types, which declares it',
    'rules/R10-duplicates.mjs': '--r10-anon is passed through check, which declares it',
    'rules/R18-doc-refs.mjs': 'reads -w inside command lines quoted in docs, not its own arguments',
  };
  const toolFiles = dir => readdirSync(join(TOOLS, dir), { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? (['tests', 'templates', 'node_modules'].includes(e.name) ? [] : toolFiles(join(dir, e.name))) : /\.m?js$/.test(e.name) ? [join(dir, e.name).split('\\').join('/')] : []);
  const byHand = toolFiles('.').map(f => f.replace(/^\.\//, '')).filter(f => f !== 'lib/cli-args.mjs' && !HAND_OK[f])
    .filter(f => /argv\.(includes|indexOf|find(Index)?)\(|===? '-w'|=== '--workspace'/.test(readFileSync(join(TOOLS, f), 'utf8')));
  check('[guard] no tool parses its own options or -w (paths.mjs cli() / command(), lib/cli-args.mjs parseOptions)', !byHand.length, byHand.join(', '));

  // ── bridge commands at the repo root: the running dev server, not the engine fallback ──
  const before = workspaces().filter(w => devServerInfo(w).state === 'live');
  if (before.length) check('live pick (skipped: a real dev server runs here)', true);
  else {
    const gamesDir = join(ROOT, 'games'), hadGames = existsSync(gamesDir), made = ['zz-live-a', 'zz-live-b'];
    const fake = g => { const d = join(gamesDir, g); mkdirSync(join(d, '.threedog'), { recursive: true }); writeFileSync(join(d, 'package.json'), `{"name":"${g}","private":true}\n`); return d; };
    try {
      const a = fake('zz-live-a');
      writeFileSync(join(a, '.threedog/dev.json'), JSON.stringify({ port: 5999, pid: process.pid }));
      fake('zz-live-b');
      check('one live dev server: the bridge talks to it from the repo root', workspaceFor(undefined, { cwd: ROOT, live: true }) === a);
      check('without live (shot, build tools) the fallback stays', workspaceFor(undefined, { cwd: ROOT }) === ENGINE);
      writeFileSync(join(gamesDir, 'zz-live-b/.threedog/dev.json'), JSON.stringify({ port: 5998, pid: process.pid }));
      check('two live dev servers: the error lists both and says -w', /2 dev servers are running \(games\/zz-live-a, games\/zz-live-b\): pick one with -w/.test(throws(() => workspaceFor(undefined, { cwd: ROOT, live: true }))));
    } finally {
      for (const g of made) rmSync(join(gamesDir, g), { recursive: true, force: true });
      if (!hadGames && existsSync(gamesDir) && !readdirSync(gamesDir).length) rmSync(gamesDir, { recursive: true });
    }
  }

  // ── R1: art code has the error limit only ──
  check('art files: style/, art/, assets.js, art.js; gameplay files are not', ['games/g/style/index.js', 'games/g/art/tree.js', 'games/g/assets.js', 'games/g/art.js', 'style/index.js'].every(isArtFile)
    && !['games/g/main.js', 'games/g/content/items.js', 'games/g/party.js'].some(isArtFile));
  {
    const gamesDir = join(ROOT, 'games'), hadGames = existsSync(gamesDir), d = join(gamesDir, 'zz-size');
    const body = n => '// filler\n' + 'export const v = [' + '0.123, '.repeat(n) + '];\n';
    try {
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'package.json'), '{"name":"zz-size","private":true}\n');
      writeFileSync(join(d, 'art.js'), body(3000));    // ~21 KB: under the 48 KB error limit
      writeFileSync(join(d, 'logic.js'), body(3000));
      writeFileSync(join(d, 'assets.js'), body(8000));  // ~56 KB: over it
      const R1 = (await import('../rules/R01-file-size.mjs')).default.run().filter(r => r.file.startsWith('games/zz-size/'));
      const at = f => R1.find(r => r.file === `games/zz-size/${f}`);
      check('a 21 KB art.js gets no size warning; the same size in a gameplay file still does', !at('art.js') && at('logic.js')?.level === 'warn', JSON.stringify(R1));
      check('art code over 48 KB is still an error', at('assets.js')?.level === 'error', JSON.stringify(R1));
    } finally {
      rmSync(d, { recursive: true, force: true });
      if (!hadGames && existsSync(gamesDir) && !readdirSync(gamesDir).length) rmSync(gamesDir, { recursive: true });
    }
  }

  // ── COMMANDS.md lists every CLI command (generated tables in bin/threedog.mjs are the source) ──
  const doc = readFileSync(join(ENGINE, 'docs/COMMANDS.md'), 'utf8');
  const esc = s => s.replace(/[-.]/g, '\\$&');
  const missing = [...Object.keys(SCRIPTS), ...BRIDGE, ...VITE, 'map'].filter(c => !new RegExp(`(threedog(\\.mjs)?|npm run|npm) ${esc(c)}(?![\\w-])`).test(doc));
  check('every threedog command appears in COMMANDS.md as `threedog <cmd>` or `npm run <cmd>`', !missing.length, 'missing: ' + missing.join(', '));
  // options too, for the tools that declare them through cli() (the declaration is the source): an option nobody can find is not there
  const flagGaps = [];
  for (const tool of ['shot', 'capture', 'gallery']) {
    const src = readFileSync(join(ROOT, `packages/tools/${tool}.mjs`), 'utf8'), decl = src.match(/\bcli\(process\.argv\.slice\(2\), \{([\s\S]*?)\}\s*\)/)?.[1] ?? '';
    const opts = [...decl.matchAll(/'([\w-]+)'/g)].map(m => m[1]);
    if (!opts.length) flagGaps.push(`${tool}: cli() declaration not found`);
    for (const o of opts) if (!new RegExp(`--${esc(o)}(?![\\w-])`).test(doc)) flagGaps.push(`${tool} --${o}`);
  }
  check('every option shot / capture / gallery declare appears in COMMANDS.md as --<option>', !flagGaps.length, 'missing: ' + flagGaps.join(', '));

  // ── .gitignore: tool output (.threedog/) stays out, a game's own shots/ folder can be committed (0.5 acceptance: a bare `shots` ignored it) ──
  if (existsSync(join(ROOT, '.git'))) {
    const ignored = p => spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: ROOT }).status === 0;
    check('.gitignore: .threedog/shots ignored, games/<game>/shots not', ignored('packages/engine/.threedog/shots/a.png') && ignored('games/g/.threedog/shots/a.png') && !ignored('games/g/shots/a.png'));
  }

  // ── --help prints the script's header and runs nothing (threedog test --help used to start the whole suite) ──
  const log = console.log, said = [];
  console.log = (...a) => said.push(a.join(' '));
  let codes;
  try { codes = ['test', 'shot', 'map'].map(c => main([c, '--help'])); } finally { console.log = log; }
  check('--help: test / shot / map print their header and exit 0 without running', codes.every(c => c === 0) && /One-shot test/.test(said[0] ?? '') && /screenshot/.test(said[1] ?? '') && said.length === 3, said.map(t => t.split('\n')[0]).join(' | '));

  // ── Node version: one range everywhere, and the vite commands stop on an old Node with the version, the range and the fix ──
  const pkgFiles = ['package.json', 'packages/engine/package.json', 'packages/tools/package.json', 'packages/post-effects/package.json', 'packages/terrain-noise/package.json', 'packages/tools/templates/game/package.json'];
  const ranges = pkgFiles.map(f => `${f}: ${JSON.parse(readFileSync(join(ROOT, f), 'utf8')).engines?.node}`);
  check('engines.node is NODE_RANGE in every package.json and the template', ranges.every(r => r.endsWith(`: ${NODE_RANGE}`)), ranges.join(' | '));
  const viteEngines = JSON.parse(readFileSync(join(dirname(createRequire(join(TOOLS, 'package.json')).resolve('vite/package.json')), 'package.json'), 'utf8')).engines?.node;
  check('NODE_RANGE is the installed vite\'s engines.node', viteEngines === NODE_RANGE, `vite: ${viteEngines}`);
  check('nodeSupported: 20.19 / 22.12 / 24 yes, 20.11 / 21.7 / 22.11 / 18 no',
    ['20.19.0', 'v22.12.0', '24.1.0'].every(nodeSupported) && !['20.11.1', '21.7.0', '22.11.0', 'v18.20.0'].some(nodeSupported));
  const realNode = process.versions.node, err = console.error, errs = [];
  Object.defineProperty(process.versions, 'node', { value: '20.11.0', configurable: true });
  console.error = (...a) => errs.push(a.join(' '));
  let oldCodes;
  try { oldCodes = ['dev', 'build', 'test', 'shot', 'perf'].map(c => main([c])); } finally { console.error = err; Object.defineProperty(process.versions, 'node', { value: realNode, configurable: true }); }
  check('faked Node 20.11: dev / build / test / shot / perf exit 1 before starting anything, naming the version, the range and the fix',
    oldCodes.every(c => c === 1) && errs.length === 5 && errs.every(e => e.includes('Node 20.11.0') && e.includes(NODE_RANGE) && e.includes('nodejs.org')), errs[0]);
  check('doctor reports the Node version through the same check', /nodeProblem\(\)/.test(readFileSync(join(TOOLS, 'doctor.mjs'), 'utf8')));
}
