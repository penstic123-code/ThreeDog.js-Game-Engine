// What one live character must be (an object contract: shared check @threedog/tools/contract, runContract sees kind: 'object'). Other modules hold it through
// engine.player and engine.control.characterOf(id), and a replacement of the characters slot answers both, so this list is what makes that slot replaceable.
// How a provider answers: engine.control.resolveWith(id => liveCharacter | null) at install, and resolveWith(() => null) at dispose. Core names no module, so this is the
// one way in, and only a provider calls it: not a game call, not on the public pages. The module contract (contract.js, `resolves`) checks it was called.
// The world protocol, what world and its thing source ask of a record's character. Games never call these; a replacement gives them all (design.md section 9):
//   placeRecord(point)               a write to its record's position that differs from where it stands: a placement
//   takePose({ rot, scale })         a write to its record's rot and scale; throws what poseProblem says
//   poseProblem({ rot, scale })      why it cannot keep that pose, or null: thing.set answers with it, because a throw inside an op freezes gameplay
//   seatProblem({ vehicle, seat })   why it cannot go back to that seat, or null: an undo of a placement that ended a ride asks. Without seats, always a string
//   backInSeat({ vehicle, seat })    sit there again; seatProblem said it can
//   vehicle, seat, facing            what it rides (null on foot), the seat it holds, its turn about Y: the undo of a placement keeps them
// bodyHeld: something other than a holder has the body (a ragdoll, a seat), so a cutscene path leaves it alone; control reads it.
// A ragdoll (rigid) lays the body down and hands it back: limp (the ragdoll that has the body, or null), velocity, vy, moveAmount, stateMark (the state last told to the animation), mover, syncRecord.
// The rest is what callers outside the characters folder use: move (through its holder, engine.control), placeAt, enter, exit, anim, walkTo, disposed, cameraFollow.
export default {
  name: 'character',
  kind: 'object',
  api: ['move', 'placeAt', 'enter', 'exit', 'walkTo', 'placeRecord', 'takePose', 'poseProblem', 'seatProblem', 'backInSeat', 'syncRecord'],
  fields: ['id', 'root', 'position', 'state', 'anim', 'channel', 'vehicle', 'seat', 'facing', 'disposed', 'cameraFollow', 'limp', 'bodyHeld', 'velocity', 'vy', 'moveAmount', 'stateMark', 'mover'],
  calls: [['poseProblem', {}]],
};
