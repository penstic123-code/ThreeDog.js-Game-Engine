// Worker side of engine.threads lanes: serve(handler) answers { id, data } messages with { id, data } (or { id, error }).
// id 0 is a broadcast (setup data): handled, no reply. Typed arrays in a reply are transferred, not copied.
// Worker-safe: imports only threadPure.js; never import three.js or Threads.js here (Threads.js creates workers, a worker bundle must not contain itself).
import { transferables } from './threadPure.js';

/**
 * Start answering lane messages in a worker. handler is the same function the lane's local() returns on the main thread.
 * @param {(msg: any) => any} handler
 * @example // myWorker.js
 * import { serve } from 'threedog/worker';
 * import { makeHandler } from '../handler.js';
 * serve(makeHandler());
 */
export function serve(handler) {
  const fail = (id, err) => { if (id) self.postMessage({ id, error: err?.message || String(err) }); else console.error(err); };
  const reply = (id, out) => { if (id) try { self.postMessage({ id, data: out }, transferables(out)); } catch (err) { fail(id, err); } };   // an answer that cannot be cloned fails this task, not the lane
  self.onmessage = e => {
    const { id, data } = e.data;
    let out;
    try { out = handler(data); } catch (err) { fail(id, err); return; }
    // a handler that must load something first (the path worker loads Recast) may answer with a promise
    if (out && typeof out.then === 'function') out.then(v => reply(id, v), err => fail(id, err));
    else reply(id, out);
  };
}
