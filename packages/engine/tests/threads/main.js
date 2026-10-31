// Threads test page: an empty headless engine as window.engine, plus the modules tests need to build their own engines (threads on vs off).
import { createEngine, world, collision, characters, quests, THREE } from '../../index.js';
import { level } from '../../modules/level/index.js';
import { nav } from '../../modules/nav/index.js';

window.threedogThreads = { createEngine, world, collision, characters, quests, level, nav, THREE };
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), headless: true, loading: false, urlState: false, saveKey: 'threads-test' });
engine.start();
