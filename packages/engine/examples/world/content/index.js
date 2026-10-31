// Merge every content file in content/ into one object that main.js passes to engine.content.load(). Add a line here for each new content file.
import places from './places.js';
import items, { startItems } from './items.js';
import containers from './containers.js';
import pickups from './pickups.js';
import npcs from './npcs.js';
import dialogues from './dialogues.js';
import quests from './quests.js';
import actions from './actions.js';
import vegetation from './vegetation.js';
import props from './props.js';
import rules from './rules.js';

export default { places, items, startItems, containers, pickups, npcs, dialogues, quests, actions, vegetation, props, rules };
