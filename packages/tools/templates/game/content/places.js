// Place names -> where they are: { farm: { x: 12, z: -4 } }. Quest targets ('farm'), props and pickups ({ place: 'farm', x, z }) use them.
// engine.content.load(data) reads this file; a place found at startup (the player's start) is added in main.js: engine.content.load(data, { places: { home } }).
// threedog check knows the names from this file. Recipe: 01-new-game.md.
export default {};
