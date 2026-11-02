// @ts-check
// Procedural animation without a skeleton: walk cycle, tail wag, ear bounce, breathing, squash and stretch, springs. Plain math on Object3D
// rotations / positions / scales; no engine API inside, so it works on any code-built body and in any game. The engine side (which state the
// character is in, how fast it moves) comes in through update()'s `motion` argument; main.js shows the wiring.

/** Every knob in one place; pass overrides to createProceduralAnimator. Units: metres, radians, seconds, cycles. */
export const KNOBS = {
  stride: 0.6,          // metres travelled per full leg cycle at walking speed: the cycle follows distance, so feet do not slide
  strideGrow: 0.6,      // the stride gets this much longer (share) at runSpeed: fast animals take longer steps, not only quicker ones
  runSpeed: 7,          // speed at which the gait is a full trot (the character's runSpeed is a good value)
  swing: 0.45,          // leg swing amplitude at walking speed (radians), grows towards swingRun
  swingRun: 0.8,
  // leg phase offsets as a share of the cycle. walk: a four-beat walk (each foot alone); trot: diagonal pairs together. Blended by speed.
  walkGait: { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 },
  trotGait: { FL: 0, BR: 0, FR: 0.5, BL: 0.5 },
  bob: 0.03,            // body up-down per footfall while moving (metres)
  pitch: 0.06,          // body rocks forward/back with the steps (radians)
  breathe: 0.025,       // torso scale change while breathing (share)
  breatheRate: 0.3,     // breaths per second at rest
  wag: 0.5,             // tail wag amplitude (radians)
  wagRate: 2.5,         // wags per second; faster while moving
  earStiffness: 140,    // springs: higher = snappier; damping near 2*sqrt(stiffness) = no overshoot, lower = bouncier
  earDamping: 7,
  earKick: 3,           // how hard the body's vertical movement kicks the ears
  tailStiffness: 60,
  tailDamping: 6,
  squash: 0.25,         // landing squash per m/s of falling speed (share), capped by squashMax
  squashMax: 0.35,
  squashStiffness: 220,
  squashDamping: 12,
  settle: 6,            // how fast the swing amount follows speed changes (1/s): legs ease to rest instead of freezing mid-step
};

/**
 * A damped spring towards a target, advanced with semi-implicit Euler in small sub-steps so a long frame does not explode it.
 * Why a spring: secondary motion (ears, tail tip, squash) should lag behind and overshoot a little, which is exactly what a spring does.
 * @param {number} stiffness @param {number} damping
 */
export function spring(stiffness, damping) {
  return {
    x: 0, v: 0,
    /** @param {number} target @param {number} dt */
    step(target, dt) {
      for (let left = dt; left > 0; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        this.v += (stiffness * (target - this.x) - damping * this.v) * h;
        this.x += this.v * h;
      }
      return this.x;
    },
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

/**
 * @param {import('./creature.js').CreatureParts} parts the pivots to move (any body with the same names works)
 * @param {Partial<typeof KNOBS>} [knobs]
 */
export function createProceduralAnimator(parts, knobs = {}) {
  const K = { ...KNOBS, ...knobs };
  const rest = { bodyY: parts.body.position.y };   // the only position the animator writes; read once, so it can always go back exactly
  let phase = 0, amount = 0, time = 0, wasGrounded = true, airVy = 0, lastBodyY = rest.bodyY;
  const earL = spring(K.earStiffness, K.earDamping), earR = spring(K.earStiffness, K.earDamping);
  const tailTip = spring(K.tailStiffness, K.tailDamping), squash = spring(K.squashStiffness, K.squashDamping);
  const legOut = { FL: 0, FR: 0, BL: 0, BR: 0 };

  return {
    knobs: K,
    /**
     * Pose for this frame. Call it once per rendered frame (onFrame or character.onPose) with the frame's dt: looks only, never gameplay.
     * @param {number} dt frame seconds
     * @param {{ speed: number, state: string, grounded: boolean, vy?: number }} motion what the character is doing (written by fixed steps)
     */
    update(dt, { speed, state, grounded, vy = 0 }) {
      if (!(dt > 0)) return;
      time += dt;
      const air = state === 'jump' || state === 'fall' || !grounded;
      // swing amount eases towards "moving or not", so stopping finishes the step smoothly; the leg angle is amount * sin(cycle)
      const moving = !air && speed > 0.1 ? 1 : 0;
      amount += (moving - amount) * Math.min(1, K.settle * dt);
      const run = Math.min(1, speed / K.runSpeed);
      // the cycle advances by distance / stride: a faster creature cycles faster AND takes longer steps; at rest it just stops advancing
      phase = (phase + speed * dt / (K.stride * (1 + K.strideGrow * run))) % 1;
      const swing = lerp(K.swing, K.swingRun, run) * amount;
      for (const leg of /** @type {const} */ (['FL', 'FR', 'BL', 'BR'])) {
        const offset = lerp(K.walkGait[leg], K.trotGait[leg], run);
        legOut[leg] = air ? (leg[0] === 'F' ? -0.6 : 0.5) : Math.sin(TAU * (phase + offset)) * swing;   // in the air: front legs reach, back legs push
        parts.legs[leg].rotation.x = legOut[leg];
      }
      // body: bob twice per cycle (two footfalls of a diagonal pair), rock with the steps; at rest it breathes instead
      const bob = Math.abs(Math.cos(TAU * phase)) * K.bob * amount;
      parts.body.position.y = rest.bodyY + bob;
      parts.body.rotation.x = Math.sin(TAU * phase * 2) * K.pitch * amount;
      // landing: the falling speed just before touching down kicks the squash spring; volume roughly kept (y down, x/z out)
      if (air) airVy = Math.min(airVy, vy);
      if (!air && !wasGrounded) { squash.v -= Math.min(K.squashMax, -airVy * K.squash) * 12; airVy = 0; }
      wasGrounded = !air;
      const s = squash.step(0, dt);
      const breath = Math.sin(TAU * K.breatheRate * time) * K.breathe * (1 - amount);
      parts.torso.scale.set(1 - s * 0.5, 1 + s + breath, 1 - s * 0.5);
      // secondary motion: the ears lag the body's vertical movement, the tail tip lags the tail base
      const bodyVy = (parts.body.position.y - lastBodyY) / dt; lastBodyY = parts.body.position.y;
      parts.earL.rotation.x = earL.step(-bodyVy * K.earKick * 0.1, dt);
      parts.earR.rotation.x = earR.step(-bodyVy * K.earKick * 0.1, dt);
      const wag = Math.sin(TAU * K.wagRate * (1 + run) * time) * K.wag * (0.4 + 0.6 * amount);
      parts.tail.rotation.y = wag;
      parts.tail.rotation.x = air ? 0.6 : -0.3 * amount;
      parts.tailTip.rotation.y = tailTip.step(wag * 0.8, dt) - wag;   // the tip trails: it chases the base's angle and lands late
      parts.head.rotation.x = -parts.body.rotation.x * 0.7;           // the head counters the body's rock so the gaze stays level
    },
    /** Numbers a test or the dev bridge can read */
    describe() {
      return { phase: +phase.toFixed(3), amount: +amount.toFixed(3), legs: { ...legOut }, squash: +squash.x.toFixed(3), bodyY: parts.body.position.y };
    },
  };
}
