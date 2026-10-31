// Merge all content files in content/ into one object, which main.js hands to engine.content.load(). When you add a content file (npcs, quests…), remember to add a line here.
import places from './places.js';
import items, { startItems } from './items.js';
import pickups from './pickups.js';

export default { places, items, startItems, pickups };
