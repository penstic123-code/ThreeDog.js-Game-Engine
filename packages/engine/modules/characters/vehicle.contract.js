// What character.enter(vehicle) needs from anything a character rides (an object contract, not a module: shared check @threedog/tools/contract,
// runContract sees kind: 'object'). rigid.addWheeled's car passes it; so must a game's own boat, horse, mech or lift, so riding needs no rigid module.
//   seatPosition(seat) / exitPosition(seat)  world { x, y, z } for that seat (0 = driver): a rider is kept on its seat; exit places it at the exit
//   speed                            m/s, a number: the driver's moveAmount (animation, describe)
//   drive(throttle, steer, brake)    called every fixed step while the player drives (-1..1, -1..1, 0..1); the driver's exit calls drive(0, 0, 1)
//   driver                           set by enter / exit (null when empty); object: what the camera follows; camera?: { distance, height } while driving
//   seats?                           how many riders, driver included (default 1): enter takes the driver seat, else the first free passenger seat
//   hideDriver?                      false keeps riders visible on their seats (bikes, open carts); default hidden
//   passengers                       optional: enter creates the list of seated passengers when missing (rigid vehicles start with [])
//   id                               optional: saves put the player back into the vehicle with that id (rigid vehicles have one)
export default {
  name: 'vehicle',
  kind: 'object',
  methods: ['seatPosition', 'exitPosition', 'drive'],
  fields: ['speed', 'driver', 'object'],
  // optional fields: when present they must pass (enter reads them with defaults)
  optional: { seats: v => Number.isInteger(v) && v >= 1, hideDriver: v => typeof v === 'boolean', passengers: Array.isArray },
  points: ['seatPosition', 'exitPosition'],   // called for every seat (0 .. seats - 1), must return finite world { x, y, z }
  numbers: ['speed'],
  calls: [['drive', 1, 0, 0], ['drive', 0, 0, 1]],   // full throttle, then the brake exit() uses
};
