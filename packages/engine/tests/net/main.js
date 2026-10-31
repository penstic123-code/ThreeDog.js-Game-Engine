// Net test page: an idle headless engine as window.engine (the runner waits on it), plus the co-op example's builder so tests make host + clients themselves.
import { createEngine, fakeNetwork } from '../../index.js';
import { makeCoop } from '../coop/coop.js';

window.threedogCoop = { fakeNetwork, makeCoop };
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), headless: true, loading: false, urlState: false, saveKey: 'net-test' });
engine.start();
