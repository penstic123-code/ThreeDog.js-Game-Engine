// This example's look, a style part merged over the style under test (createEngine({ style: [worldStyle, look] }), worldStyle = ../world/style): how the test surfaces feel.
// The exhibits ask for roles wood / stone / metal / glass; a style that does not define them falls back to materials.default.
export default {
  name: 'styletest',
  materials: {
    wood: { type: 'lambert' },
    stone: { type: 'lambert', flatShading: true },
    metal: { type: 'standard', metalness: 0.9, roughness: 0.3 },   // only looks like metal with environment light: ?env=1
    glass: { type: 'phong', shininess: 100 },
  },
};
