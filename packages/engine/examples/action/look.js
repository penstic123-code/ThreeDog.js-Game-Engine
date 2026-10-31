// This example's look, as a style part merged over the lowpoly pack (createEngine({ style: [lowpoly, look] })). Logic never reads colors; models.js does.
export default {
  name: 'action',   // a part needs at least one Style field (TypeScript rejects an object that shares none), so it names itself
  action: { floor: 0x5b6168, wall: 0x8a8f96, pillar: 0x9a8c78, enemy: 0x6fbf5a, eye: 0x1d2024 },
};
