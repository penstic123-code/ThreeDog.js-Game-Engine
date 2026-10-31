# engine.dialogue — dialogue(opts?: DialogueOptions)

Dialogue (dialogue() module)

- Options `DialogueOptions`:
  - `charsPerSecond?: number` Typing speed (characters/second, game time: advanced by engine.step), default 40
  - `advanceActions?: string[]` Actions that advance the dialogue, default ['confirm', 'interact'] (interact only when the game bound it)
  - `choiceKeys?: boolean` Number keys 1-9 pick choices (read only while a locking dialogue runs; rebind them as actions choice1...choice9), false = click / op only. Default true
  - `holdSeconds?: number` A non-locking line (lock: false) moves on this many seconds after it is fully typed, default 2

## Methods and properties
- `dialogue.define(speaker: string, nodes: DialogueScript)` — Define a dialogue (the name is usually the speaker)
- `dialogue.start(speaker: string, nodeId?: string, onEnd?: (() => void) | null, opts?: { lock?, onCancel? })` — Start a dialogue: from node nodeId (default 'start'), onEnd is called when it ends. lock (default true) locks game input and takes Esc; lock: false lets the player keep playing (lines move on by themselves) and never cuts into a locking dialogue. onCancel: what the back key (Esc) does while this locking dialogue is on top of the UI focus stack (default: nothing). Ending the playthrough (engine.session newGame / load / quit) closes the dialogue without calling onEnd. Example: `engine.dialogue.start('guard', 'start', null, { lock: false })`
- `dialogue.say(text: string | DialogueScript, opts?: { speaker?, node?, lock?, onCancel? }) → SayPromise` — Say a one-off line (no need to define first); the Promise resolves when it is done. lock: false = said while the player keeps playing (barks, radio chatter). When the playthrough ends (engine.session) the line is dropped and the Promise never resolves, so code awaiting it does not run in the next playthrough. Example: `await engine.dialogue.say('Reloading!', { speaker: 'Mira', lock: false })`
- `dialogue.end()` — End the current dialogue
- Properties:
  - `state: DialogueState` Story state: state.flags is engine.vars.flags (autosaved)
  - `scripts: Map<string, DialogueScript>` All scripts
  - `active: { speaker, nodes, node?, onEnd, lock } | null` The dialogue in progress (null when none)
  - `speaking: string | null` The script currently speaking
  - `cps: number` Typing speed (characters/second)

## Data structures
- **DialogueScript** = `Record<string, DialogueNode>` — Dialogue script: node name -> node, starting from 'start'
- **DialogueNode** Dialogue node
  - `text: string | ((state: DialogueState, engine: Engine) => string)` Line of dialogue, or a function returning one
  - `speaker?: string` Change the speaker (the script name by default)
  - `next?: string` Next node (omit = end; 'end' also means end)
  - `choices?: DialogueChoice[]` Choices (next has no effect when there are choices)
  - `do?: (state: DialogueState, engine: Engine) => void` Run when this line is shown (change story flags, give items...)
  - `data?: Record<string, any>` The game's own fields (portrait, mood, voice clip, camera shot...): handed to the 'dialogue' UI part and the 'dialogue:line' event. Other unknown keys are reported as typos, so a misspelled next does not silently end the dialogue. Example: `{ text: 'Hm.', data: { portrait: 'fisher', mood: 'tired', voice: 'fisher_03.mp3' } }`
- **DialogueChoice** Dialogue choice
  - `text: string | ((state: DialogueState, engine: Engine) => string)` Choice text
  - `next?: string` Which node to go to after choosing (omit = end)
  - `if?: (state: DialogueState, engine: Engine) => boolean` Condition: when it returns false this choice is not shown
  - `do?: (state: DialogueState, engine: Engine) => void` Run after choosing
  - `data?: Record<string, any>` The game's own fields (icon, tone...): handed to the UI part as choices[i].data. Other unknown keys are reported as typos
- **DialogueState** Story state: flags are story flags (this is engine.vars.flags, autosaved)
  - `flags: Record<string, any>`
