// Test page of the dev panel (tests/specs/panel.mjs): no style option, a game's own fog and light, water installed, terrain not, so the spec sees
// both a module that is there and one that is not. ?panel=1 opens the panel, the same line a game writes.
import { createEngine, water, THREE } from '../../index.js';

const engine = createEngine({ canvas: document.getElementById('view'), ui: { loading: false }, saveKey: 'threedog-panel-test', lights: false });
engine.use(water());
engine.scene.fog = new THREE.Fog(0x8899aa, 10, 80);
const key = new THREE.DirectionalLight(0xffffff, 2);
key.name = 'key';
engine.scene.add(key);
window.engine = engine;
engine.start();
if (location.search.includes('panel=1')) import('@threedog/tools/panel').then(m => m.openPanel(engine));
