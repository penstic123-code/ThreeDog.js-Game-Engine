// NPCs: in a schedule, at is a clock time ('11:02'); at that time the NPC walks to the spot; place may be a level marker name; talk is a dialogue id.
export default {
  shopkeeper: {
    name: '店主',
    start: { place: 'npc_shopkeeper' },
    schedule: [
      { at: '00:00', place: 'npc_shopkeeper' },
      { at: '11:02', x: 11, z: 11 },   // go out for a stroll (world coordinates)
      { at: '12:00', place: 'npc_shopkeeper' },
    ],
    interact: { op: 'npc.talk' },
  },
};
