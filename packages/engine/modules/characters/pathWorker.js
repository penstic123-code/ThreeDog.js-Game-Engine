// Path worker: answers engine.characters.findPathAsync batches off the main thread (one per engine.threads slot).
// Recast is imported statically here (a worker bundle is one file); its wasm is inlined, so it loads in a worker without fetching anything.
import * as recast from '@recast-navigation/core';
import { serve } from '../../core/threadServe.js';
import { pathHandler } from './pathJob.js';

serve(pathHandler(() => recast));
