// Threads test page: an empty headless engine as window.engine, plus the modules tests need to build their own engines (threads on vs off).
import { createEngine, world, collision, characters, quests, THREE } from '../../index.js';
import { level } from '../../modules/level/index.js';
import { nav } from '../../modules/nav/index.js';
import { bloom } from '@threedog/post-effects';
import * as all from '../../index.js';   // every export, for specs that build their own engines with any module (review-guards.mjs)

// mk: a throwaway headless engine on a detached canvas (specs pass createEngine so the call reads like createEngine itself)
const mk = (create, saveKey, extra = {}) => create({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey, ui: { loading: false }, ...extra });
window.threedogThreads = { createEngine, world, collision, characters, quests, level, nav, THREE, all, mk, bloom };
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'threads-test' });
engine.start();
