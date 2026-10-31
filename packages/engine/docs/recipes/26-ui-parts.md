# UI parts: replace or turn off any piece of the engine's screen UI

Every piece of UI the engine draws is a named **part** with a plain default:
`loading`, `toast`, `title` (off by default), `touch` (on-screen stick and buttons),
`hud.marker`, `hud.counter`, `hud.bar`, `dialogue`, `prompt` ("E · Talk"), `questLog`, `inventory` (with the inventory module).
The engine keeps the behavior (when to show, the UI focus stack and Esc, input lock, i18n); a part only draws the data it gets.
Each name takes one value: `false` off · `true` default · `{ ...options }` default with options · `(engine, options) => ({ show, update, hide, dispose })` your own (any verb may be omitted).
Only want different colors / layout? Use the style pack (`style.ui` colors, `style.ui.css`, `style.ui.templates.*`), not a new part.

## 1. Pick at start (copy it)
```js
const engine = createEngine({
  canvas,
  ui: {
    loading: { title: 'My Game' },                 // default loading screen with a title
    title: { title: 'My Game' },                   // turn on the title screen: Continue (when a save exists) / Start / Settings
    toast: false,                                  // no pop-up messages at all
  },
});
```
`loading` can only be set here (it shows while the engine is built). The others may also be set with `engine.ui.set(name, value)` before `engine.start()`.
A misspelled name throws at `start()` and lists the names that exist.

## 2. Your own part (DOM, canvas, a UI library: anything)
```js
engine.ui.set('hud.bar', (engine) => {               // called once per bar
  const el = document.createElement('progress'); el.max = 1; engine.uiRoot.appendChild(el);   // build under engine.uiRoot: dispose cleans it up
  return {
    update: d => { el.value = d.value / (d.max ?? 1); el.title = d.label ?? d.id; },
    dispose: () => el.remove(),
  };
});
engine.hud.bar('hp', { value: 80, max: 100, label: 'HP' });   // game code does not change
```
What each part receives:
| Part | Created | Calls |
|---|---|---|
| `loading` | once | `show({ title })` · `update({ progress 0-1, text })` · `hide()` |
| `toast` | once | `show({ text, kind, ms })`; kind is `'info' 'quest' 'item' 'save' 'error'` |
| `title` | once | `show({ title, items: [{ id, label, run() }] })` · `hide()` (call `item.run()` on click) |
| `hud.marker` | per marker | `update({ x, y, onScreen, arrow, angle, label, icon, distance })` every frame · `hide()` · `dispose()` |
| `hud.counter` | per counter | `update({ id, label, icon, value, max })` · `dispose()` |
| `hud.bar` | per bar | `update({ id, label, value, max })` · `dispose()` |
| `inventory` | once (on first open; opened by its key or `engine.ui.open('inventory')`) | `show(d)` · `update(d)` while open · `hide()`; `d = { title, hint, items: [{ key, id, count, data, def }], capacity, used, weight, maxWeight }`; buttons run `inventory.use / drop / transfer` ops (recipe 03) |
| `touch` | once, if wanted (1) | `show(view)` · `update(view)` (buttons or language changed) |
| `prompt` | once | `update({ id, action, key, label, text, x, y, onScreen, use(), options })` every frame in reach · `hide()` |
| `questLog` | once, full screen (2) | `show(view)` · `update(view)` (quests changed while open) · `hide()` |
| `dialogue` | once | `show()` · `update(view)` per line, typed character, choices (section 4) · `hide()` |

(1) Only when a stick (`createEngine({ joystick })`: `'auto'` on touch devices, `true` always) or a touch button is wanted.
`view = { stick, buttons: [{ action, label }], move(x, y), press(action), release(action) }`.
(2) The quest key opens it, Esc and the key close it. `view = { title, key, quests: engine.quests.list(), close() }`.

Every view hands back functions (`advance`, `choose`, `use`, `close`, `move`, `press`...) instead of making your part call engine internals:
they run the same ops and input path as keys, so tests, the dev bridge and replays see one path.
With every part off (`false`) the engine draws no DOM at all and the logic keeps running (`describe()`, ops, quests).

## 3. Toasts: filter instead of all-or-nothing
```js
toast(engine, 'Saved', { kind: 'save' });           // your own message (the engine comes first)
engine.ui.set('toast', (engine) => ({ show: ({ text, kind }) => { if (kind !== 'quest') myBanner(text); } }));
engine.use(quests({ notify: false }));               // or only silence quest messages; notify: ({ type, id, text }) => ... shows them your way
```

## 4. Dialogue box: your own look, your own fields
The engine keeps the dialogue logic (typing on game time, input lock, Esc, number keys, conditions).
The part draws `view` and answers with `view.advance()` / `view.choose(i)`, which run the ops `dialogue.advance` / `dialogue.choose`.
`view = { script, node, speaker, text (typed so far), full, typing, choices: [{ text, key, data }], hint, data, lock, advance(), choose(i) }`
```js
engine.dialogue.define('fisher', {
  start: { text: 'Quiet day.', data: { portrait: 'fisher.png', mood: 'tired' }, next: 'ask' },   // your own fields go in data
  ask: { text: 'Here for photos?', choices: [{ text: 'Yes', next: 'end', data: { icon: '📷' } }] },
});
engine.ui.set('dialogue', (engine) => {
  const el = document.createElement('div'); el.className = 'my-dlg'; el.hidden = true; engine.uiRoot.appendChild(el);
  let view = null;
  el.onclick = (ev) => { const i = ev.target.dataset?.i; i != null ? view.choose(+i) : view.advance(); };
  return {
    show: () => { el.hidden = false; },
    update: (v) => {
      view = v;
      el.innerHTML = `<img src="${v.data.portrait ?? ''}"><b>${v.speaker}</b><p>${v.text}</p>`
        + v.choices.map((c, i) => `<button data-i="${i}">${c.data.icon ?? ''} ${c.text}</button>`).join('');
    },
    hide: () => { el.hidden = true; },
    dispose: () => el.remove(),
  };
});
// voice / portraits / camera shots without replacing the box:
engine.events.on('dialogue:line', ({ speaker, data }) => { if (data.voice) playVoice(data.voice); });
```
Any other unknown node key is reported as a typo (a misspelled `next` would silently end the dialogue), so extra fields always go in `data`.
- **Talk while playing** (barks, radio): `engine.dialogue.say('Reloading!', { speaker: 'Mira', lock: false })`
  or `start(name, 'start', null, { lock: false })`. Input stays with the game, Esc is untouched,
  the line moves on by itself `holdSeconds` after it is typed, and it never cuts into a dialogue the player is reading.
- **Options**: `dialogue({ charsPerSecond: 40, advanceActions: ['confirm', 'interact'], choiceKeys: true, holdSeconds: 2 })`.
  `charsPerSecond: 0` shows the whole line at once; `choiceKeys: false` drops the 1-9 keys (click / op only).
  The choice keys are the actions `choice1`...`choice9` (rebind with `createEngine({ bindings })`), read only while a locking dialogue runs.

## 5. Title screen and "back to title"
```js
createEngine({ canvas, ui: { title: { title: 'My Game', items: ['continue', 'start', { label: 'Credits', run: e => showCredits() }] } } });
engine.events.on('ui:close', id => { if (id === 'title') startIntro(); });   // the player left the title screen
engine.ui.open('title');                             // show it again (the settings 'game' tab has a "Back to title" button)
```
While the title is open gameplay is frozen, input is locked, and Esc goes to it (the settings menu does not open).

## 6. Settings menu: only the tabs the game needs
```js
engine.use(settings({ sections: ['game', 'graphics', 'audio', 'controls', 'camera'] }));   // default: graphics, audio, controls, language, saves
// optional built-ins by name: 'game' (resume / load / back to title), 'camera' (sensitivity, invert Y, field of view; re-applied on 'camera:change')
engine.settings.addSection('camera');
engine.settings.removeSection('saves');

// a tab of your own: render gets tools with the control helpers (row / toggle / range / segmented) already bound
engine.settings.define('subtitles', true, on => { document.body.dataset.subtitles = String(on); });
engine.settings.addSection('gameplay', {
  title: 'Gameplay',
  render: (tools, e, s) => tools.row('Subtitles', tools.toggle('subtitles', s.get('subtitles'))),
  order: 50,
});
```
A completely different menu: don't install `settings()`; open your own with `uiFocus(engine).setRoot(() => myMenu.open())` so Esc on an empty stack reaches it.

Check what is in use: `engine.ui.describe()` → `{ loading: 'default', toast: 'off', 'hud.bar': 'custom', ... }`.

## 7. Keys, and UI that follows the world
- Declare keys once with `input.define('action', keys, 'label', { pad })` (or content `actions`) and read them by action name: gameplay keys (attack, jump) in the fixed step, UI keys in the frame hook. Never `addEventListener('keydown')`, and never read `pointer.clicked` for gameplay; bind a `Mouse0` action instead.
- A menu, vehicle or build mode that takes over keys pushes an input context: `const h = engine.input.push('menu')` (opaque) or `push('vehicle', { pass: true })`, then `h.remove()`. Tests and the dev bridge press keys with `engine.input.simulate(action, down)`.
- A label over a world position: `worldToScreen(engine, pos)` gives screen coordinates for an HTML element.
