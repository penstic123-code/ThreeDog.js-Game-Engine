# engine.settings — settings(opts?: SettingsOptions)

Settings menu (settings() module)

- Options `SettingsOptions`:
  - `action?: string` Action name that opens the menu, default 'menu'
  - `keys?: string[]` Key that opens the menu, default ['Escape']
  - `storageKey?: string` Browser storage key
  - `presets?: Record<string, QualityPreset>` Override the graphics presets: { low: {...}, medium: {...}, high: {...} }
  - `sections?: boolean | string[]` Tabs: true (default) graphics, audio, controls, language, saves; false none; or a list by name, which may include the optional 'game' (resume, load a save, back to title) and 'camera' (mouse sensitivity, invert Y, field of view; saved as camera.sensitivity / camera.invertY / camera.fov). Example: `settings({ sections: ['game', 'graphics', 'audio', 'controls', 'camera'] })`
  - `freezeWorld?: boolean` Pause gameplay while the menu is open (with flow installed it switches to flow's 'paused' and returns to the previous state on close; without flow it uses engine.freeze); the picture keeps running, default false

## Methods and properties
- `settings.get(key: string) → any` — Read a setting, e.g. get('vol.music')
- `settings.set(key: string, value: any, opts?: { save?: boolean })` — Change a setting (takes effect immediately + saved)
- `settings.preset(name: 'low' | 'medium' | 'high' | (string & {}))` — Graphics preset: 'low' / 'medium' / 'high'
- `settings.define(key: string, def: T, apply?: (value: T, e: Engine) => void)` — Game-defined setting: default value + apply function (saved automatically)
- `settings.addSection(id: string, section?: SettingsSection)` — Add a tab of your own, or a built-in / optional one by name: addSection('camera')
- `settings.resetBindings()` — Restore all keys to defaults
- `settings.rebind(action: string, code: string)` — Change the first key of an action to code
- `settings.actionList() → any[]` — Key list (for the UI)
- `settings.save()` — Save to the browser
- Also: `settings.removeSection(id: string)`, `settings.open()`, `settings.close()`, `settings.toggle(on?: boolean)`
- Properties:
  - `values: Record<string, any>` All current setting values
  - `presets: Record<string, QualityPreset>` Graphics presets
  - `sections: Map<string, any>` Tabs
  - `ui: SettingsUI` Control generator helpers
  - `isOpen: boolean` Whether the menu is open

## Data structures
- **SettingsSection** One settings tab
  - `title: string | ((e: Engine) => string)` Title: text or engine => text
  - `render: (tools: SettingsTools, e: Engine, s: Settings) => string` Generate the content HTML
  - `bind?: (el: HTMLElement, e: Engine, s: Settings) => void` Called after every redraw, to bind events to custom controls
  - `when?: (e: Engine) => boolean` When this returns false the tab is not shown
  - `order?: number` Sort order, smaller first, default 100
