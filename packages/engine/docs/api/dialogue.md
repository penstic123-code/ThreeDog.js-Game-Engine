# engine.dialogue — dialogue(opts?: DialogueOptions)

Dialogue (dialogue() module). Ops: `dialogue.advance` (finish typing the line, else go on to the next one) and `dialogue.choose { index }` (pick visible choice index, 0-based) are the only ways keys, clicks, tests and the dev bridge move a conversation on: `engine.ops.run('dialogue.choose', { index: 0 })`

- Options `DialogueOptions`:
  - `charsPerSecond?: number` Typing speed (characters/second, game time: advanced by engine.step), default 40
  - `advanceActions?: string[]` Actions that advance the dialogue, default ['confirm'] (a basic key); e.g. ['confirm', 'interact'] to also advance on the game's interact key. Choices: the cursor, clicks, and the actions choice1..choice9 (context 'dialog', no keys of their own: presets.bindings.dialogNumbers binds 1-9)
  - `holdSeconds?: number` A bubble line stays this many seconds plus its reading time (about 15 characters a second) unless say() gives seconds, default 2

## Methods and properties
- `dialogue.define(speaker: string, nodes: DialogueScript)` — Define a dialogue (the name is usually the speaker)
- `dialogue.start(speaker: string, nodeId?: string, onEnd?: (() => void) | null, opts?: { channel?, at?, onCancel? })` — Start a dialogue: from node nodeId (default 'start'), onEnd is called when it ends. Main channel (default): locks game input and takes Esc; its choices take the UI choice cursor. onCancel: what the back key (Esc) does while it is on top of the UI focus stack (default: nothing). channel: 'bubble' plays the script as bubble lines over at (no lock, no choices; a running conversation is untouched). Ending the playthrough (engine.session newGame / load / quit) closes it without calling onEnd. Example: `engine.dialogue.start('guard', 'start', null, { channel: 'bubble', at: guard.root })`
- `dialogue.say(text: string | DialogueScript, opts?: { speaker?, node?, channel?, onCancel? } & BubbleOptions) → SayPromise` — Say a one-off line (no need to define first); the Promise resolves when it is done. channel: 'bubble' = over at while the player keeps playing (barks, shop chatter, radio); several speakers at once, queued per speaker. When the playthrough ends (engine.session) the line is dropped and the Promise never resolves, so code awaiting it does not run in the next playthrough. Example: `await engine.dialogue.say('Reloading!', { speaker: 'Mira', channel: 'bubble', at: mira.root })`
- `dialogue.bubbles() → { speaker, text, queued }[]` — Lines on the bubble channel now
- `dialogue.end()` — End the main dialogue
- Properties:
  - `state: DialogueState` Story state: state.flags is engine.vars.flags (autosaved)
  - `scripts: Map<string, DialogueScript>` (experimental) All scripts
  - `active: { speaker, nodes, node?, id?, onEnd } | null` The dialogue in progress (null when none). speaker: the script name; node: the current node OBJECT (its fields: text, choices, data...); id: that node's id string ('start', 'ask'); both are set once the first line shows. Read-only: drive it with start / end / the dialogue ops. Example: `const atAsk = engine.dialogue.active?.id === 'ask';   // the node id; active.node.data holds the node's own fields`
  - `speaking: string | null` (experimental) The script the main dialogue is playing
  - `charsPerSecond: number` (experimental) Typing speed (characters/second)

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
