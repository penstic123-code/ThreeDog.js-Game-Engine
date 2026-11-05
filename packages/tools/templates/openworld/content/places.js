// Place names -> where they are: { farm: { x: 12, z: -4 } }. Quest targets ('farm'), props and pickups ({ place: 'farm', x, z }) use them.
// home is written here so threedog check knows the name; main.js replaces it with the flat spot it finds at startup: { places: { home } }. Recipe: 01-new-game.md.
export default { home: { x: 0, z: 0 } };
