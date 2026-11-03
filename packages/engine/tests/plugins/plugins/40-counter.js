// A module object: plugged with engine.use. Counts fixed steps so the test can see it runs and stops once switched off.
const api = { steps: 0 };
export default {
  name: 'pluginCounter', type: 'rules',
  install() { return api; },
  fixed() { api.steps++; },
};
