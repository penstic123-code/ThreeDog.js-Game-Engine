# engine.net — net()

(experimental) Co-op multiplayer (net() module): host authority, clients mirror the state and request ops; see recipes/27-net.md


## Methods and properties
- `net.reconnect(transport: any)` — Client: attach a new transport after the connection dropped; the host answers with a full snapshot. Pass the old key to keep the same actor (and bag). Example: `engine.events.on('net:close', () => setTimeout(() => engine.net.reconnect(webSocket(url, { key: oldKey })), 2000));`
- Properties:
  - `role: "host" | "client"` 'host' or 'client'
  - `actor: string | null` This machine's actor id on the host: 'player' on the host, e.g. 'guest-1' on a client (null until the first snapshot). A client calls itself 'player' locally (own avatar record, own bag), so game code rarely needs this; it is for showing names and for logs.
  - `connected: boolean` Client: has a connection and an up-to-date mirror. Host: always true
  - `peers: { id: number; actor: string }[]` Host: connected peers [{ id, actor }] (id from the transport, actor = world record / container id of that player). Client: []
  - `pending: Map<number, string>` Client: requests sent and not answered yet (seq -> op name). Host: empty
  - `stats: Record<string, number>` Message counters: in / out, plus diffs, snapshots, rejected (host) or gaps (client: lost diffs that forced a snapshot)
