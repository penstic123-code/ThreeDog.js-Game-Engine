// Test scene: settings menu (Esc) + background music (rules: switch track when it rains, duck during dialogue)
import { createEngine, world, sky, weather, followCamera, characters, collision, dialogue, interactions, debug, THREE } from '../../index.js';
import { settings } from '../../modules/settings/index.js';
import { music } from '../../modules/music/index.js';
import style from '../../styles/lowpoly/index.js';

const engine = createEngine({ canvas: document.getElementById('view'), style, saveKey: 'threedog-test' });
engine.use(
  world(), sky({ time: 0.45 }), weather({ start: 'clear' }), collision(), followCamera(), characters(),
  interactions(), dialogue(), debug(),
  music({ tracks: { a: '/tests/settings/audio/a.wav', b: { url: '/tests/settings/audio/b.wav', volume: 0.8 }, sting: { url: '/tests/settings/audio/sting.wav', loop: false } } }),
  settings(),
);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8a9a7a }));
ground.receiveShadow = true; engine.add(ground);
engine.characters.createPlayer({ spawn: { x: 0, z: 0 } });
engine.dialogue.define('测试', { start: { text: '你好。', next: 'b' }, b: { text: '再见。' } });

const { when } = engine.music;
engine.music.rules([
  { track: 'b', when: when.weather('rain', 'storm'), priority: 5 },
  { track: 'a', when: () => true, priority: 0 },
], { hold: 1, fade: 1 });

engine.start();
window.engine = engine;
