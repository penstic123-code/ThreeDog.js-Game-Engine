// engine.net: the public face of the net() module (one host, any number of clients; host authority + state sync). Usage in recipes/27-net.md.
// The host runs the game as usual; clients mirror its state and send op requests. Host.js / Client.js hold each side; sync.js what is synced.
import { NetHost } from './Host.js';
import { NetClient } from './Client.js';

/** engine.net (installed by net()): role, who this machine is, connection state and counters. Changes go through engine.ops, never through net. */
export class Net {
  /** @internal */
  constructor(e, o) {
    /** 'host' or 'client' @type {'host' | 'client'} */
    this.role = o.role;
    /** @internal */ this._o = o;
    /** @internal */ this._side = o.role === 'host' ? new NetHost(e, o.transport, o) : new NetClient(e, o.transport, o);
  }
  /**
   * This machine's actor id on the host: 'player' on the host, e.g. 'guest-1' on a client (null until the first snapshot).
   * A client calls itself 'player' locally (own avatar record, own bag), so game code rarely needs this; it is for showing names and for logs.
   * @returns {string | null}
   */
  get actor() { return this.role === 'host' ? 'player' : this._side.actor; }
  /** Client: has a connection and an up-to-date mirror. Host: always true @returns {boolean} */
  get connected() { return this.role === 'host' ? true : this._side.connected && this._side.synced; }
  /**
   * Host: connected peers [{ id, actor }] (id from the transport, actor = world record / container id of that player). Client: []
   * @returns {{ id: number, actor: string }[]}
   */
  get peers() { return this.role === 'host' ? [...this._side.peers.values()].map(p => ({ id: p.id, actor: p.actor })) : []; }
  /** Client: requests sent and not answered yet (seq -> op name). Host: empty @returns {Map<number, string>} */
  get pending() { return this.role === 'host' ? new Map() : this._side.pending; }
  /** Message counters: in / out, plus diffs, snapshots, rejected (host) or gaps (client: lost diffs that forced a snapshot) @returns {Record<string, number>} */
  get stats() { return this._side.stats; }
  /**
   * Client: attach a new transport after the connection dropped; the host answers with a full snapshot. Pass the old key to keep the same actor (and bag).
   * @param {any} transport
   * @returns {void}
   * @example
   * engine.events.on('net:close', () => setTimeout(() => engine.net.reconnect(webSocket(url, { key: oldKey })), 2000));
   */
  reconnect(transport) {
    if (this.role !== 'client') throw new Error('engine.net.reconnect() is for clients; the host keeps its transport');
    this._side.connect(transport);
  }
  /** @internal */
  _fixed(dt) { this._side.fixed(dt); }
  /** @internal */
  _frame(dt) { this._side.frame?.(dt); }
  /** @internal */
  _dispose() { this._side.dispose(); }
}
