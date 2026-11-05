// The names and help lines of the bridge commands: plain data, so bin/threedog.mjs can read the list without loading the commands themselves.

/** The commands of commands.mjs: they need a running page */
export const COMMANDS = {
  describe: 'compact scenario description (--full for the describeText summary, --all for everything, describe player.x for one item, --max characters)',
  step: 'advance N game seconds: step 2',
  skip: 'jump the clock like sleeping: skip to=06:00 / skip seconds=600 (engine.skip; optional fade= save=)',
  press: 'press a key or action: press interact / press KeyE / press e (held 0.1 s, then renders 1/60 s; --for 0.02 shortens the hold)',
  hold: 'hold for N seconds: hold moveForward 1.5',
  state: 'change the scenario: state time=18:30 weather=rain pos=40,-20',
  eval: 'evaluate an expression in the page (engine is available, await works; multi-line statements need their own return): eval ' +
    '"engine.calendar.timeOfDay"; long scripts: eval --file path (a script that calls assert(cond, msg) / expect(v).toBe(x) is run as checks: short pass/fail report, exit 1 on failure, --verbose for passes; --wait <seconds>, default 120: how long a script may wait on a page that looks stopped)',
  js: 'alias of eval (the command has no eval in it, so the Bash sandbox does not block it): js "engine.calendar.timeOfDay" / js --file path',
  'snap-describe': 'describe snapshot instead of a screenshot: snap-describe save|diff name [--only a,b] [--ignore x.y] [--tolerance 0.5]',
  snap: 'save a screenshot to .threedog/shots/name.png and run the picture check on the page, as threedog shot does (snap name, or snap path/to/file.png used as given; --play first leaves the title as shot --play; --width N scales the returned image down, the saved file stays full size; --no-picture skips the check)',
  errors: 'page errors with id, time, tick, source and count: errors = new since the last read; errors latest [N] = the last N, repeatable; errors --since E5 = after id 5 (known classes come with the cause and the doc page)',
  reload: 'reload the page',
  resume: 'resume real-time running (the page is halted after step / press)',
  ops: 'what the player can do now (each op offer checked with can): ✓ shop.buy shop=bakery item=bread · ✗ … (reason)',
  op: 'run an op as source bridge (no time passes): op shop.buy shop=bakery item=bread n=2 (values converted by the op args shape)',
  inspect: 'what is around the player (or inspect npc_3 / inspect 10,-4) and which ops it can do now, with reasons; inspect materials = every material: textures, size, color space (wrong ones first), VRAM estimate, engine/game, patches, shared-by; inspect perf = draw calls, triangles, programs, texture MB, JS ms, compile stalls, each against a budget with the next call',
  scene: 'the mesh exists but is not drawn: counts, one line of reasons over every Mesh / Points / Line / Sprite, then the first 6 undrawn ones (surprising before plain view culling) with WHY (visible=false up the parents, layers, material flags, scale 0 / NaN, empty geometry, behind camera, beyond far, outside the view, fog...): scene [--hidden (only undrawn)] [--limit N | --full (40)] [--json]',
  pick: 'what is at screen pixel x,y (from the canvas top-left): pick 480,270 -> record id, kind, template, where it is defined (content file:line), fields',
  thing: 'everything about one id as JSON: thing player-chest (definition file:line, template, model, materials, state, collision rules, related ops, save status, how to change it)',
  explain: 'why: explain op shop.buy shop=bakery item=bread (can it run; --full adds its last attempt) / explain quest first-light (where it is stuck) / explain picture fog.far (which line last changed it)',
  scenario: 'run one scenario test (tests/scenarios/<name>.json) on this page: scenario barter (prints failed checks; the scenario leaves the page halted)',
  catalog: 'what the game can do, from its registrations: catalog = a line per module with ops or problems, the rest named on one line (--full: a line each); catalog shop = one module ' +
    '(dependencies, params + defaults, ops with args and failure codes, saved parts, time hooks, problems, doc / recipe / source files); catalog shop.buy ' +
    '= one op; catalog --find throw; --json for the raw data',
  loading: 'what loading waits for / what failed / does it block the start (answers while start() is stuck); loading hero: one task with its manifest and path',
};

/** Commands of dispatch.mjs: they work (or explain why not) without a running page */
export const EXTRA = {
  play: 'start the game for the AI: starts the dev server if none runs, waits for the bridge and the engine, prints the page address (play --stop stops it)',
  status: 'is it ready: engine ready / loading / page errors / halted or frozen, or which of five causes keeps the bridge from answering',
  'picture-palette': 'measure a reference picture, no game needed: picture-palette art/reference/ref.png [--n 8] [--average] [--ignore-ui] [--region x,y,w,h] (same as threedog picture palette)',
  'picture-compare': 'numbers for two pictures, no game needed: picture-compare ref.png .threedog/shots/snap.png [--region x,y,w,h] [--out side.png] (same as threedog picture compare)',
  verify: 'run a scenario (tests/scenarios/<name>.json) and report what it tested and what it never touched: verify barter',
};
