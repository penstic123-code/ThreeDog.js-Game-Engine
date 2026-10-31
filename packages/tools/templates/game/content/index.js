// Merge all content files in content/ into one object, which main.js hands to engine.content.load(). When you add a content file (npcs, quests…), remember to add a line here.
import places from './places.js';
import items, { startItems } from './items.js';
import pickups from './pickups.js';
import actions from './actions.js';
import templates from './templates.js';
import props from './props.js';
import audio from './audio.js';

export default { places, items, startItems, pickups, actions, templates, props, audio };
