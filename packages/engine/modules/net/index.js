// net() module: optional co-op multiplayer, host authority + state sync. Not installed = no cost (core only keeps two internal hooks in Ops.js).
//   engine.use(net({ role: 'host', transport }))     // the player whose browser owns the game
//   engine.use(net({ role: 'client', transport }))   // friends: mirror the host, send op requests
// Only ops defined with net: 'peer' can be requested by clients (default deny); the actor comes from the connection, not the message.
// Transports: fakeNetwork() (in-process, tests) and webSocket(url) (with packages/tools/net-relay.mjs); see transports.js for the shape.
import { readParams, keysSchema } from '../../core/params.js';
import { Net } from './Net.js';

export { fakeNetwork, webSocket } from './transports.js';

const OPTS = ['role', 'transport', 'sync', 'syncEvery', 'keepAlive', 'rate', 'burst', 'maxSpeed', 'posEvery', 'actorFor', 'actorFields', 'avatarFields', 'interpolate', 'avatar', 'onJoin', 'onLeave'];
const STRINGS = {
  role: "net({ role }): role is 'host' (owns the game) or 'client' (mirrors the host), got {got}",
  transport: 'net(): transport is required, e.g. net({ role, transport: webSocket(url) }) or fakeNetwork().connect() in tests',
};

const NET_PARAMS = keysSchema(OPTS);

/**
 * Optional co-op multiplayer: one host owns the state, clients mirror it and ask for changes through ops. Installed as engine.net.
 * Host: peers' requests run as `ops.run(name, args, { source: 'net', actor })` only for ops defined with net: 'peer', with the op's args shape
 * checked, the optional owner check, and a per-peer rate limit; the result comes back after the state diff that contains it.
 * State: world records, containers, vars and the other save parts are sent as a snapshot on join and as diffs every syncEvery steps.
 * Client: ops.run of a peer op returns { ok: true, pending: true, seq } (watch state or the net:result event, not the return value);
 * its own avatar moves locally and is sent to the host (clamped to maxSpeed); other avatars glide between updates.
 * Defaults per peer on the host (avatar: true): a world record { id: actor, kind: 'player' } (not saved) and a container with the actor id.
 * @param {{ role: 'host' | 'client', transport: any, sync?: 'auto' | string[], syncEvery?: number, keepAlive?: number, rate?: number, burst?: number, maxSpeed?: number, posEvery?: number,
 *   actorFor?: (peerId: number) => string, actorFields?: string[], avatarFields?: string[], interpolate?: string[], avatar?: boolean,
 *   onJoin?: (e: any, peer: { id: number, actor: string }) => void, onLeave?: (e: any, peer: { id: number, actor: string }) => void }} opts
 *   sync: save parts to sync ('auto' = world, containers, vars and every other save part except random / level); syncEvery: steps between diffs (3 = 20/s);
 *   rate / burst: op requests per second per peer and the burst allowance; actorFields: record fields holding actor ids (swapped like ids, default ['owner']);
 *   avatarFields: own-avatar fields the client sends with its position; interpolate: record kinds that glide on clients (default ['player']).
 * @returns {import('../../types/core').ModuleDef<Net>}
 * @example
 * // host
 * engine.ops.define('chest.take', { net: 'peer', args: { chest: 'id', item: 'string' },
 *   can: (e, a, ctx) => e.inventory.container(a.chest).has(a.item) || 'empty',
 *   run: (e, a, ctx) => e.inventory.transfer(a.chest, ctx.actor, a.item, 1) });
 * engine.use(net({ role: 'host', transport: webSocket('ws://localhost:8787/farm', { host: true }) }));
 * // client (same game code, same op definitions)
 * engine.use(net({ role: 'client', transport: webSocket('ws://192.168.1.5:8787/farm') }));
 * engine.ops.run('chest.take', { chest: 'chest-1', item: 'apple' });   // -> { ok: true, pending: true, seq: 1 }
 * @experimental
 */
export function net(opts = {}) {
  readParams('net', NET_PARAMS, opts);
  if (opts.role !== 'host' && opts.role !== 'client') throw new Error(STRINGS.role.replace('{got}', JSON.stringify(opts.role)));
  if (!opts.transport) throw new Error(STRINGS.transport);
  const left = new Map();   // actor -> last position, so a peer that reconnects comes back where it left
  const o = {
    sync: 'auto', syncEvery: 3, keepAlive: 60, rate: 20, burst: 20, maxSpeed: 15, posEvery: 3,
    actorFor: id => 'guest-' + id, actorFields: ['owner'], avatarFields: ['facing', 'amount', 'grounded', 'swimming'], interpolate: ['player'], avatar: true,
    ...opts,
  };
  o.join = (e, peer) => {
    if (o.avatar && e.world && !e.world.get(peer.actor)) {
      const at = left.get(peer.actor) ?? e.world.get('player')?.position ?? { x: 0, y: 0, z: 0 };
      e.world.add({ id: peer.actor, kind: 'player', position: { ...at } }, { save: false });
    }
    if (o.avatar && e.inventory) e.inventory.container(peer.actor);
    o.onJoin?.(e, { id: peer.id, actor: peer.actor });
  };
  o.leave = (e, peer) => {
    o.onLeave?.(e, { id: peer.id, actor: peer.actor });
    const rec = e.world?.get(peer.actor);
    if (o.avatar && rec) { left.set(peer.actor, { ...rec.position }); e.world.remove(peer.actor); }   // the bag stays: a reconnect gets it back
  };
  let n = null;
  return {
    name: 'net', params: NET_PARAMS, options: opts, label: 'Multiplayer', stage: 'late', optional: ['world', 'inventory'],
    install(e) { return (n = new Net(e, o)); },
    fixed(dt) { n._fixed(dt); },
    frame(dt) { n._frame(dt); },
    describe() { return { role: n.role, actor: n.actor, connected: n.connected, peers: n.peers.length, pending: n.pending.size }; },
    dispose() { n._dispose(); },
  };
}
