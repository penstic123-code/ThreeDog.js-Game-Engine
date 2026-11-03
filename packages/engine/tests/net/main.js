// Net test page: an idle headless engine as window.engine (the runner waits on it), plus the co-op example's builder so tests make host + clients themselves.
import { createEngine, fakeNetwork, world, pickups, net, content } from '../../index.js';
import { makeCoop } from '../coop/coop.js';

window.threedogCoop = { fakeNetwork, makeCoop, createEngine, world, pickups, net, content };   // the bare builders: a test makes an engine with only the modules it needs
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'net-test' });
engine.start();
