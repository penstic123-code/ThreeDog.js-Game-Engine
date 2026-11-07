// What character.enter(vehicle) needs from anything a character rides (an object contract, not a module: shared check @threedog/tools/contract,
// runContract sees kind: 'object'). rigid.addWheeled's car passes it; so must a game's own boat, horse, mech or lift, so riding needs no rigid module.
//   seatPosition(seat) / exitPosition(seat, n = 0)  world { x, y, z } for that seat (0 = driver): a rider is kept on its seat. n numbers the exits, best first, null past the last; a vehicle with one exit ignores n.
//                                    exit() takes the first walkable one, and with none it refuses and the rider stays. A placement or a vehicle going uses exit({ force: true })
//   speed                            m/s, a number: the driver's moveAmount (animation, describe)
//   drive(throttle, steer, brake)    called every fixed step while the keys drive (-1..1, -1..1, 0..1); drive(0, 0, 0) when a holder above takes over; the driver's exit calls drive(0, 0, 1)
//   driver                           set by enter / exit (null when empty); object: what the camera follows; camera?: { distance, height } while driving
//   seats?                           how many riders, driver included (default 1): enter takes the driver seat, else the first free passenger seat
//   hideDriver?                      false keeps riders visible on their seats (bikes, open carts); default hidden
//   passengers                       optional: enter creates the list of seated passengers when missing (rigid vehicles start with [])
//   gone?                            true once removed for good: an undo cannot seat anyone there (rigid vehicles set it; leaving the scene counts too), and with it set, the remove() addVehicle returned lets go of the records still waiting for this id. Whoever owns the vehicle exits its riders first, also when its module leaves: only the owner knows it is going
//   id                               optional: the rider's record keeps it and the seat, and a load puts it back on that seat. characters.addVehicle(vehicle) joins before or after the load; rigid vehicles join themselves
export default {
  name: 'vehicle',
  kind: 'object',
  api: ['seatPosition', 'exitPosition', 'drive'],
  fields: ['speed', 'driver', 'object'],
  position: { authority: 'solver', writers: { seat: 'seatPosition(seat) places a rider every step; exitPosition(seat) places it once on the way out' } },
  // optional fields: when present they must pass (enter reads them with defaults)
  optional: { seats: v => Number.isInteger(v) && v >= 1, hideDriver: v => typeof v === 'boolean', passengers: Array.isArray, gone: v => typeof v === 'boolean' },
  points: ['seatPosition', 'exitPosition'],   // called for every seat (0 .. seats - 1), must return finite world { x, y, z }
  numbers: ['speed'],
  calls: [['drive', 1, 0, 0], ['drive', 0, 0, 1]],   // full throttle, then the brake exit() uses
};
