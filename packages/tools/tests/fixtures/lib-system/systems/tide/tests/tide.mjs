// Runs in whatever game pulled the system: the module is plugged by the plugins folder
export const specs = [{
  name: 'tide: the pulled system runs',
  url: '/',
  async run({ check, ev }) {
    check('the module is installed', await ev(() => !!engine.tide && typeof engine.tide.level === 'number'));
  },
}];
