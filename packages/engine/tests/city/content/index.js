// Merge every content file in content/ into one object that main.js passes to engine.content.load(). Add a line here for each new content file.
import level from './level.js';
import npcs from './npcs.js';
import dialogues from './dialogues.js';
import triggers from './triggers.js';
import actions from './actions.js';

export default { level, npcs, dialogues, triggers, actions };
