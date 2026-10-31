// net(): optional co-op multiplayer (modules/net). Same format as specs.mjs, appended at the end of it.
// Each case builds a host and two clients (headless engines from tests/coop/coop.js) joined by a manual fakeNetwork, and advances
// network time and fixed steps together. Guard items ("do not bypass"): non-peer ops are refused, the actor comes from the connection,
// owner and rate limits hold for raw messages that skip the client code, and a client writing shared state itself is reported.

// in the page: host + 2 clients; go(ms) advances the wire and every engine in 1/60 s steps
const rig = async (wireOpts = {}) => {
  const { fakeNetwork, makeCoop } = threedogCoop;
  const wire = fakeNetwork({ manual: true, latency: 40, ...wireOpts });
  const H = await makeCoop('host', wire.host());
  const ta = wire.connect(), tb = wire.connect();
  const A = await makeCoop('client', ta), B = await makeCoop('client', tb);
  const go = (ms = 300) => { for (let t = 0; t < ms; t += 1000 / 60) { wire.advance(1000 / 60); for (const e of [H, A, B]) e.step(1 / 60, { render: false }); } };
  const bag = (e, id = 'player') => e.inventory.container(id).list().reduce((o, x) => (o[x.id] = (o[x.id] ?? 0) + x.count, o), {});
  const end = () => { for (const e of [H, A, B]) e.dispose(); };
  go(300);
  return { wire, H, A, B, ta, tb, go, bag, end };
};
const RIG = `const rig = ${rig.toString()};`;
// ev() serializes the function; the rig helper is pasted in front of each body
const inPage = body => new Function(`return (async () => { ${RIG} ${body} })()`);

export const specs = [
  {
    name: 'net: legal op syncs to everyone, op:result after the diff that contains it',
    url: '/tests/net/',
    async run({ check, ev }) {
      const r = await ev(inPage(`
        const { H, A, B, go, bag, end } = await rig();
        const actors = [A.net.actor, B.net.actor];
        let atResult = null;
        A.events.on('net:result', x => { atResult = { ...x, apples: A.inventory.count('apple') }; });
        const sent = A.ops.run('shop.buy', { item: 'apple' });
        go(400);
        const viaLocal = B.ops.run('ui.quickBuy');
        go(400);
        const out = { actors, sent, atResult, hostGuest: bag(H, A.net.actor), aBag: bag(A), bShop: bag(B, 'shop'), bSeesA: bag(B, A.net.actor),
          aSeesHost: bag(A, 'host'), hist: H.ops.recent('shop.buy').map(h => h.source + '/' + h.actor + '/' + h.ok), pending: A.net.pending.size,
          peers: H.net.peers.map(p => p.actor), viaLocal, bBag: bag(B), avatars: B.world.query({ kind: 'player' }).map(r => r.id).sort() };
        end(); return out;`));
      check('clients get actor ids from the host', r.actors.join() === 'guest-1,guest-2', r.actors.join());
      check('client run returns pending with a seq', r.sent.ok && r.sent.pending && r.sent.seq === 1, JSON.stringify(r.sent));
      check('host ran it as the peer', r.hist.join() === 'net/guest-1/true,net/guest-2/true', r.hist.join());
      check('host state: guest bag has the apple, gold spent', r.hostGuest.apple === 1 && r.hostGuest.gold === 7, JSON.stringify(r.hostGuest));
      check('client A sees its own bag as player', r.aBag.apple === 1 && r.aBag.gold === 7, JSON.stringify(r.aBag));
      check('client B sees the shop and the bag of A', r.bShop.apple === 18 && r.bSeesA.apple === 1, JSON.stringify([r.bShop, r.bSeesA]));
      check('the own bag of the host shows up as host on clients', r.aSeesHost.gold === 20, JSON.stringify(r.aSeesHost));
      check('op:result carries seq and host tick, and arrives after the state', r.atResult?.seq === 1 && r.atResult.ok && r.atResult.tick > 0 && r.atResult.apples === 1, JSON.stringify(r.atResult));
      check('a peer op called inside a local op is still sent to the host', r.viaLocal.ok && r.viaLocal.value?.pending && r.bBag.apple === 1, JSON.stringify([r.viaLocal, r.bBag]));
      check('nothing left pending', r.pending === 0, r.pending);
      check('host lists both peers; avatars are world records', r.peers.join() === 'guest-1,guest-2' && r.avatars.join() === 'guest-1,player', r.avatars.join());
    },
  },
  {
    name: 'net: default deny, forged actor, owner and badArgs [guard]',
    url: '/tests/net/',
    async run({ check, ev }) {
      const r = await ev(inPage(`
        const { H, A, B, go, bag, end } = await rig();
        const results = [];
        A.events.on('net:result', x => results.push(x.name + ':' + x.reason));
        B.events.on('net:result', x => results.push('B ' + x.name + ':' + x.reason));
        const local = A.ops.run('cheat.gold', { n: 99 });
        const raw = m => A.net._side.send(m);   // a hacked client: skips the client code and writes messages itself
        raw({ t: 'op', seq: 50, name: 'cheat.gold', args: { n: 99 } });
        raw({ t: 'op', seq: 51, name: 'chest.take', args: { item: 'apple' }, actor: 'player' });
        raw({ t: 'op', seq: 52, name: 'shop.buy', args: { item: 'apple', actor: 'player' } });
        raw({ t: 'op', seq: 53, name: 'no.such', args: {} });
        go(300);
        A.ops.run('plot.claim', { id: 'plot-1' }); go(300);
        B.ops.run('plot.water', { id: 'plot-1' });
        B.net._side.send({ t: 'op', seq: 60, name: 'plot.water', args: { id: 'plot-1' }, actor: 'guest-1' });
        A.ops.run('plot.water', { id: 'plot-1' }); go(300);
        const out = { local, results, hostGold: bag(H).gold, guestGold: bag(H, 'guest-1').gold, hostApples: bag(H).apple ?? 0, guestApples: bag(H, 'guest-1').apple ?? 0,
          plotH: H.world.get('plot-1'), plotA: A.world.get('plot-1'), plotB: B.world.get('plot-1'),
          refused: H.ops.recent('cheat.gold').map(h => h.source + '/' + h.actor + '/' + h.reason) };
        end(); return out;`));
      check('client refuses a non-peer op locally', !r.local.ok && r.local.reason === 'notAllowed', JSON.stringify(r.local));
      check('host refuses it too when sent raw (logged with the peer actor)', r.results.includes('cheat.gold:notAllowed') && r.refused.join() === 'net/guest-1/notAllowed' && r.guestGold === 10 && r.hostGold === 20, JSON.stringify([r.refused, r.guestGold, r.hostGold]));
      check('a forged actor field is ignored: the item goes to the sender', r.results.includes('chest.take:null') && r.guestApples === 1 && r.hostApples === 0, JSON.stringify([r.guestApples, r.hostApples]));
      check('extra args (actor inside args) are refused as badArgs', r.results.includes('shop.buy:badArgs'), r.results.join());
      check('unknown op names are refused', r.results.includes('no.such:unknownOp'), r.results.join());
      check('owner: someone else cannot water a claimed plot, even claiming to be the owner', r.results.filter(x => x === 'B plot.water:notOwner').length === 2, r.results.join());
      check('owner: the owner can; owner shows as player on the machine of the owner', r.plotH.water === 1 && r.plotH.owner === 'guest-1' && r.plotA.owner === 'player' && r.plotB.owner === 'guest-1' && r.plotB.water === 1, JSON.stringify([r.plotH, r.plotA.owner, r.plotB]));
    },
  },
  {
    name: 'net: per-peer rate limit, client guard reports local writes [guard]',
    url: '/tests/net/',
    async run({ check, ev }) {
      const r = await ev(inPage(`
        const { H, A, B, go, bag, end } = await rig();
        const reasons = {};
        A.events.on('net:result', x => { reasons[x.reason] = (reasons[x.reason] || 0) + 1; });
        for (let i = 0; i < 60; i++) A.net._side.send({ t: 'op', seq: 100 + i, name: 'shop.sell', args: { item: 'bread' } });
        go(300);
        const burst = { ...reasons };
        go(1500);
        let later = null;
        A.events.on('net:result', x => { if (x.seq === 999) later = x.reason; });
        A.net._side.send({ t: 'op', seq: 999, name: 'shop.sell', args: { item: 'bread' } });
        let bOk = 'none';
        B.events.on('net:result', x => { bOk = x.reason; });
        B.ops.run('chest.take', { item: 'apple' });
        go(300);
        // a client writing shared state itself (not through an op) is reported, and the host never hears of it
        const { warns } = await __t.warns(() => {
          const h = A.onFixed(() => { A.inventory.add('gold', 500, { silent: true }); h.remove(); });
          A.step(1 / 60, { render: false });
        });
        go(200);
        const out = { burst, later, bOk, warns: warns.filter(w => w.includes('net client changed shared state')), hostSeesA: bag(H, 'guest-1').gold };
        end(); return out;`));
      check('a burst over the limit is cut with rateLimited', r.burst.rateLimited === 40 && r.burst.notEnough === 20, JSON.stringify(r.burst));
      check('tokens refill with host steps', r.later === 'notEnough', r.later);
      check('the limit is per peer (B unaffected)', r.bOk === null, String(r.bOk));
      check('client guard reports a local write to shared state', r.warns.length === 1 && r.warns[0].includes('inventory.add'), r.warns.join(' | '));
      check('the host state is untouched by it', r.hostSeesA === 10, r.hostSeesA);
    },
  },
  {
    name: 'net: drop and reconnect with the key gets a full snapshot and the same actor',
    url: '/tests/net/',
    async run({ check, ev }) {
      const r = await ev(inPage(`
        const { wire, H, A, B, ta, go, bag, end } = await rig();
        A.ops.run('shop.buy', { item: 'bread' }); go(300);
        ta.drop(); go(100);
        const away = { peers: H.net.peers.map(p => p.actor), avatar: !!H.world.get('guest-1'), offline: A.ops.run('shop.buy', { item: 'apple' }) };
        B.ops.run('chest.put', { item: 'gold', n: 3 }); go(300);
        A.net.reconnect(wire.connect({ key: ta.key })); go(400);
        const out = { away, actor: A.net.actor, bag: bag(A), chest: bag(A, 'chest'), peers: H.net.peers.map(p => p.actor), snaps: A.net.stats.snapshots, avatar: !!H.world.get('guest-1') };
        end(); return out;`));
      check('host sees the peer leave and removes its avatar', r.away.peers.join() === 'guest-2' && !r.away.avatar, JSON.stringify(r.away));
      check('a disconnected client cannot send', r.away.offline.reason === 'offline', JSON.stringify(r.away.offline));
      check('reconnect keeps the actor and the bag', r.actor === 'guest-1' && r.bag.bread === 1 && r.bag.gold === 5, JSON.stringify([r.actor, r.bag]));
      check('reconnect brings changes made while away (full snapshot)', r.chest.gold === 3 && r.snaps === 2, JSON.stringify([r.chest, r.snaps]));
      check('the avatar comes back', r.avatar && r.peers.join() === 'guest-2,guest-1', r.peers.join());
    },
  },
  {
    name: 'net: latency, jitter and loss still end consistent; movement clamped and interpolated',
    url: '/tests/net/',
    async run({ check, ev }) {
      const r = await ev(inPage(`
        const { wire, H, A, B, go, end } = await rig({ latency: 80, jitter: 60, loss: 0.2, seed: 7 });
        const acts = [['shop.buy', { item: 'apple' }], ['chest.put', { item: 'apple' }], ['chest.take', { item: 'apple' }], ['shop.sell', { item: 'apple' }], ['shop.buy', { item: 'bread' }]];
        for (let i = 0; i < 60; i++) { const [n, a] = acts[i % acts.length]; (i % 2 ? A : B).ops.run(n, { ...a }); go(50); }
        // own movement: A walks 1 m per step; then tries to teleport 1000 m
        for (let i = 0; i < 30; i++) { const h = A.onFixed(() => { const p = A.world.get('player').position; A.world.move('player', { x: p.x + 0.1, z: p.z }); h.remove(); }); go(1000 / 60); }
        wire.loss = 0; go(1500);
        const walked = H.world.get('guest-1').position.x, bSeesA = B.world.get('guest-1').position.x;
        const h = A.onFixed(() => { A.world.move('player', { x: 1000, z: 0 }); h.remove(); }); go(250);
        const jump = H.world.get('guest-1').position.x - walked;
        go(1500);
        const norm = (e, me) => { const sw = id => !me ? id : id === me ? 'player' : id === 'player' ? 'host' : id, out = {};
          for (const [id, c] of e.inventory._containers.map) out[sw(id)] = Object.fromEntries(c.list().map(x => [x.id, x.count]).sort());
          return JSON.stringify(Object.keys(out).sort().map(k => [k, out[k]])); };
        const hostView = me => norm(H, me), recs = e => JSON.stringify([...e.world.records.values()].filter(r => r.kind === 'plot'));
        const out = { a: norm(A, null) === hostView('guest-1'), b: norm(B, null) === hostView('guest-2'), plots: recs(A) === recs(H) && recs(B) === recs(H),
          gaps: A.net.stats.gaps + B.net.stats.gaps, walked, jump, bSeesA, detail: [norm(A, null), hostView('guest-1')] };
        end(); return out;`));
      check('containers match the host on both clients', r.a && r.b, JSON.stringify(r.detail));
      check('world records match', r.plots, '');
      check('loss happened and was recovered with snapshots', r.gaps > 0, r.gaps);
      check('walking reaches the host', Math.abs(r.walked - 3) < 0.01, r.walked);
      check('a teleport is clamped by maxSpeed', r.jump > 0 && r.jump < 10, [r.walked, r.jump].join());
      check('the other client ends where the host has it (interpolated)', Math.abs(r.bSeesA - r.walked) < 1e-6, [r.bSeesA, r.walked].join());
    },
  },
];
