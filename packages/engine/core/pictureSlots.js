// The names of the picture values only one writer may hold: the one table a module's provides, the picture writers tool (core/pictureWriters.js),
// describe('picture').picture.slots and the PictureSlot type all read. A name here is a convention, nothing more: provides: ['fog'] takes it like any other
// exclusive slot (core/moduleSlots.js), so a second claim is shared-taken and { replaces: 'fog' } swaps the holder.
// Why a table at all: two parts from different sources only collide on a claim when they spell the slot the same way, and the writers tool can only tell
// "the holder wrote fog.far" from a stray write when it knows fog.far belongs to 'fog'. Why this small: every extra row is a rule for code that never asked.
//   values: names in describe('picture').picture.writers; one ending in '.' covers everything under it ('fog.' = fog.near, fog.far ...)
// sun is the light named 'sun': the name is how another source finds the main light (scene.getObjectByName('sun')), so it is how this table finds it too.
// sky has no values: a dome or a skybox is an object, not one value three.js holds. A sky drawn through scene.background also takes 'background'.
const row = (what, ...values) => Object.freeze({ what, values: Object.freeze(values) });
export const PICTURE_SLOTS = Object.freeze({
  sky: row('the sky drawn behind everything: a dome, a skybox'),
  fog: row('scene.fog and its values', 'scene.fog', 'fog.'),
  tone: row('tone mapping and exposure', 'renderer.toneMapping', 'renderer.toneMappingExposure'),
  environment: row('the environment map and its strength', 'scene.environment', 'scene.environmentIntensity'),
  background: row('scene.background and its strength', 'scene.background', 'scene.backgroundIntensity'),
  sun: row("the main light: the light named 'sun'", 'light:sun.'),
});

/** The slot a writers value name belongs to, or null ('fog.far' -> 'fog', 'light:lamp.color' -> null) @param {string} label */
export function slotOfValue(label) {
  for (const slot in PICTURE_SLOTS) for (const v of PICTURE_SLOTS[slot].values) if (v.endsWith('.') ? label.startsWith(v) : label === v) return slot;
  return null;
}

/** Who holds a slot now, or null. A name the game defined as a shared value of another kind is no slot @param {any} e @param {string} slot */
export function slotHolder(e, slot) {
  if (!e.stacks.has(slot)) return null;
  const s = e.stacks.get(slot);
  return s.kind === 'one' ? s.value() ?? null : null;
}

/** describe('picture').picture.slots: slot -> the module holding it, or null @param {any} e */
export const slotHolders = e => Object.fromEntries(Object.keys(PICTURE_SLOTS).map(slot => [slot, slotHolder(e, slot)]));
