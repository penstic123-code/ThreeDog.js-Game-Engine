# engine.quests — quests(opts?: QuestsOptions)

Quests (quests() module)

- Options `QuestsOptions`:
  - `action?: string` Action name that opens the quest log, default 'quests'
  - `keys?: string[]` Keys, default ['KeyJ']
  - `padKeys?: string[]` Gamepad button, default ['PadSelect']
  - `checkInterval?: number` Check interval (game seconds, checked in the fixed step; not checked while frozen / paused), default 0.5
  - `notify?: boolean | ((msg) => void)` Messages on quest start / step / done: true a toast with kind 'quest' (default) · false none · a function to show them your way. Example: `quests({ notify: false })   quests({ notify: ({ type, text }) => type === 'done' && myBanner(text) })`

## Methods and properties
- `quests.define(id: string, def: QuestDef)` — Define a quest (chainable)
- `quests.start(id: string)` — Start a quest
- `quests.isActive(id: string) → boolean` — Started, not done and not failed
- `quests.isFailed(id: string) → boolean` — Its fail condition held (start(id) begins it again)
- `quests.check()` — Check completion conditions once immediately
- `quests.list() → { id, title, desc?, done, failed, steps }[]` — Quest list (for custom UI)
- Also: `quests.isDone(id: string) → boolean`, `quests.counter(name: string) → number`, `quests.bump(name: string, n?: number) → number`
- Properties:
  - `state: Record<string, { step: number; done: boolean; failed?: bool…` Quests in progress / completed / failed: id -> { step (current step), done, failed?, parts? }
  - `win: { open, toggle, refresh }` The quest log (UI part 'questLog'): open, toggle(on?), refresh()

## Data structures
- **QuestDef** Quest definition
  - `title: string` Title
  - `desc?: string` Description
  - `steps: (QuestStep | QuestParallelStep)[]` Steps (completed in order); a step may be parallel goals { all: [...] }
  - `reward?: (e: Engine) => void` Called on completion (give rewards)
  - `fail?: (e: Engine) => boolean` Checked while active; true fails the quest (quest:fail; start(id) can begin it again). Example: `fail: e => e.vars.flag('caravanLost')`
  - `onFail?: (e: Engine) => void` Called when the quest fails
- **QuestStep** One quest step: text is the displayed text, done the completion condition (checked every half second), target the objective (a marker is shown when hud is installed)
  - `id?: string` Stable id: saves store progress by it, so steps can be inserted or reordered later (default: the step's position)
  - `text: string`
  - `done: (e: Engine) => boolean`
  - `target?: HudTarget` Objective: a place name (content.place), object, character, { x, z }, { nearest: itemId } or a function returning an objective; with the hud module the current step shows a marker automatically
