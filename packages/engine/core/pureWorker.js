// Worker that runs pure-function batches for engine.threads (world far simulation with worker: true). Same handler as the main-thread fallback.
import { serve } from './threadServe.js';
import { pureHandler } from './threadPure.js';

serve(pureHandler());
