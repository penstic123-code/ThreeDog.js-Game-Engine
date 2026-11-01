// Merge every content file in content/ into one object that main.js passes to engine.content.load(). Add a line here for each new content file.
import places from './places.js';
import items, { startItems } from './items.js';
import npcs from './npcs.js';
import vegetation from './vegetation.js';
import templates from './templates.js';
import props from './props.js';

export default { places, items, startItems, npcs, vegetation, templates, props };
