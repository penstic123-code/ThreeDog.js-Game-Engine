// Request guards shared by the dev-server endpoints (bridge /__threedog/cmd, error relay /__threedog/error, cache /__threedog/cache/*).
// A web page the developer visits can send simple requests to localhost; these checks keep it out:
//   local address    the TCP peer is this machine
//   Host             localhost-like (stops DNS rebinding: a foreign domain resolving to 127.0.0.1 still sends its own Host)
//   Origin           none (command line), or, with sameOrigin, exactly this dev server's own origin (the page's own scripts)
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_ADDR = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/** Whether req comes from this machine and passes the Host / Origin checks above */
export function isLocalRequest(req, { sameOrigin = false } = {}) {
  const host = req.headers.host || '', origin = req.headers.origin;
  if (!LOCAL_ADDR.includes(req.socket?.remoteAddress) || !LOCAL_HOST.test(host)) return false;
  if (!origin) return true;
  return sameOrigin && (origin === `http://${host}` || origin === `https://${host}`);
}

/** A queue: inOrder(fn) runs fn after everything before it, and one that fails does not stop the next. inOrder.idle() is the promise of the queue's end */
export function orderedQueue() {
  let tail = Promise.resolve();
  const inOrder = fn => { const run = tail.then(fn); tail = run.catch(() => {}); return run; };
  inOrder.idle = () => tail;
  return inOrder;
}

/** reply(code, obj) answers this request as JSON */
export const jsonReply = res => (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };

/** Read a request body as text, at most max bytes; rejects (and stops reading) beyond that */
export function readBody(req, max = 1 << 20) {
  return new Promise((res, rej) => {
    const parts = []; let n = 0, over = false;
    req.on('data', c => { if (over) return; n += c.length; if (n > max) { over = true; rej(new Error(`body larger than ${max} bytes`)); req.resume(); return; } parts.push(c); });
    req.on('end', () => { if (!over) res(Buffer.concat(parts)); });
    req.on('error', rej);
  });
}
