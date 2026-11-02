// Trigger zones: tag -> settings. fromLevel: true = use the level's trigger_<tag> marker; onEnter/onExit are effects (syntax in packages/engine/modules/content/rules.js).
export default {
  plaza: {
    fromLevel: true,
    onEnter: [
      { toast: '你走进了广场' },
      { particles: { name: 'sparks', at: [0, 1.5, -14], count: 40 } },   // sparks is defined in main.js (this example has no style)
    ],
  },
};
