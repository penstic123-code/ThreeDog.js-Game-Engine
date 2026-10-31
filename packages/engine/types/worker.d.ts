// threedog/worker: the worker-safe entry for a lane's worker file (no three.js, no DOM). See engine.threads.lane in recipes/15-perf.md.

/**
 * Start answering lane messages in a worker. handler is the same function the lane's local() returns on the main thread.
 * @example
 * // myWorker.js
 * import { serve } from 'threedog/worker';
 * import { makeHandler } from './handler.js';
 * serve(makeHandler());
 */
export function serve(handler: (msg: any) => any): void;
