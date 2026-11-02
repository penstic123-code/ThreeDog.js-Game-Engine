# @threedog/tools

The command line and build tooling for [threedog](https://www.npmjs.com/package/threedog) games: the `threedog` CLI, a vite preset, the test runner, rule checks, doc generators, headless screenshots and an MCP server for AI assistants.

```sh
npm install threedog three@~0.187.0
npm install -D @threedog/tools
npx threedog new-game my-game          # or: npx threedog init  (sets up the current folder, never overwrites a file)
```

Common commands (run in the game folder; the full list is `node_modules/threedog/docs/COMMANDS.md`):

| Command | What it does |
|---|---|
| `threedog dev` / `build` / `preview` | vite with the threedog preset |
| `threedog check` | rule checks, content validation, types, generated docs up to date |
| `threedog test [name]` | the game's tests (headless browser) |
| `threedog shot` | a headless screenshot plus the game state and look numbers |
| `threedog map` | regenerate GAMEMAP.md |
| `threedog examples list` / `pull <name>` | copy a technique example into the game |

vite preset: `import { gameConfig } from '@threedog/tools/vite'; export default gameConfig(import.meta.dirname);`

Headless commands use Playwright's Chromium (`npx playwright install chromium` once). Peer dependencies: `threedog`; optional `tweakpane` (dev panel) and `@gltf-transform/cli` (asset optimisation). MIT license.
