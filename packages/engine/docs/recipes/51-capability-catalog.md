# Capability catalog: ask what the game can do before reading docs

`engine.catalog()` answers "which modules are here, what can they do, what do they save, how do they keep time" from the registrations
that already exist: module definitions (`requires`, `optional`, `stage`, hooks), `engine.ops.define`, `engine.saves.register`,
`engine.describe.add` and params schemas. There is no second list to keep in sync: a removed op is gone from the catalog at once.

## 1. Ask
```js
engine.catalog();                  // short list: [{ id: 'sky', kind: 'module', state: 'running', stage: 'environment', ops: [], saves: ['sky'], time: 'fixed+skip' }, ...]
engine.catalog('shop');            // one module expanded (below)
engine.catalog('shop.buy');        // one op: args schema, reasons, can / offers / undo / net, its last attempt
engine.catalog({ find: 'throw' }); // the short list filtered by id, label, op or save name
engine.catalog('core');            // what the engine registered itself (time.skip, clock, random...); 'game': what game code registered outside modules
```
From the dev bridge: `threedog catalog`, `threedog catalog shop`, `threedog catalog --find buy` (`--json` for the data). The bridge prints the
same data and adds the files: `source` (where `name: 'shop'` or `define('shop.buy'` is written), `api` (the generated api page), `recipes` and
`examples` that use `engine.shop`. The MCP server has one `catalog` tool with the same arguments.

A module entry has: `state`, `stage`, `runIndex` (place in `engine.moduleOrder`), `critical`, `requires`, `optional` (`{ name, installed, lost }`),
`params` (schema, default and the value in use), `ops` (`{ name, desc, args, failures }`), `saves` (`{ key, version, migrates }`),
`time` (`hooks`, `step: 'fixed' | 'frame' | 'none'`, `skip`), `queries` (`describe().<id>`, names added with `describe.add`, the api's public names) and
`problems`, such as "fixed hook but no skip hook" or an `optional` module that is missing.

`threedog catalog <id>` lists each param as `key:type=default — sentence`: the type (for `any` params) and sentence are read from the module's api page (its options typedef JSDoc), so the schema keeps only names, defaults and checks; a param with no sentence shows `(no doc)` and counts as a problem (rule R38 lists the modules).

Who owns what: an op, save part or describe name registered while a module's `install()` or `init()` runs belongs to that module; so does an op named
`<module>.verb` or a save part keyed by the module name. Everything registered before the first `engine.use` is `core`; the rest is `game`.

## 2. Declare args once (ops)
An op arg is `'int?'` or the full schema `{ type, default, min, max, values, desc, optional }`. The same object validates the call in dev, fills the
default before `can` and `run`, and is what the catalog and `threedog catalog` show, so the code never needs `n = 1` in two places.
```js
engine.ops.define('shop.buy', {
  args: { item: 'string', n: { type: 'int', default: 1, min: 1, max: 99, desc: 'how many' } },
  can: (e, { item, n }) => e.inventory.count('gold') >= n * PRICE[item] ? true : 'noMoney',
  run: (e, { item, n }) => e.inventory.add(item, n),
  reasons: { noMoney: 'Not enough gold' },   // the failure codes the catalog lists
});
engine.ops.run('shop.buy', { item: 'bread', n: 0 });   // dev: throws "n must be >= 1"; release: returns { ok: false, code: 'badArgs' } (run never starts)
```

## 3. Declare module options once (`readParams`)
```js
import { readParams } from 'threedog';
const PARAMS = { radius: { type: 'number', default: 2, min: 0, desc: 'pickup reach in m' }, sound: 'string?' };
export const magnet = (opts) => {
  const o = readParams('magnet', PARAMS, opts);   // wrong type / out of range throws [module-params] with the fix; an unknown key throws in dev and warns once in a release build
  return { name: 'magnet', params: PARAMS, options: o, stage: 'gameplay', install(e) { return { radius: o.radius }; } };
};
```
`params` and `options` on the definition are what `engine.catalog('magnet').params` reads; `engine.use` re-checks them in dev for a definition built by hand.
The schema types are those of op args plus `object`, `array` and `function` (options may hold callbacks; op args may not).

## 4. Debugging with it
"Why does the throw fail": `threedog catalog combat.throw` shows its args, the failure codes it can return and its last attempt with the reason;
`threedog explain op combat.throw ...` (recipe 23) then says why for given args. "Does sleeping advance my crops": `threedog catalog crops` shows the
time hooks; a `fixed` hook without `skip` is listed under problems (recipe 49).

## 5. "How do I get this effect": `threedog how`
`threedog how "rain"` scores the words of the task against the AI.md task rows and the recipe headings with their first sentence, and prints the
top five: the API in the row, the recipe path with section (`recipes/08-weather-sky.md §1`) and a one-line snippet. It reads the docs only, so it works with no page
and prints the same list every run. When a dev page runs it adds up to three live catalog modules whose name matches the first English word. Words match at a word
start (`rain` does not hit `terrain`). No hit means rephrase, or read AI.md.
