// Post chain on WebGPURenderer (RenderPipeline); render/PostFX.js holds the list and calls these with itself as `post`.
// The chain is one node graph: scenePass = pass(scene, camera, { samples }) -> each hdr effect's node() -> renderOutput() (tone mapping + output
// color space, placed by hand: outputColorTransform = false) -> ldr -> final. Fuse effects bring fuse.tsl (color, uv, t) => color; neighbors are
// just nested calls, so three compiles them into one fullscreen pass and fuse.js's merging is not needed here (nor loaded).
// Registered on a global when threedog/tsl loads (see PostFX.js for why not an import). Only three/webgpu, three/tsl and three's TSL display
// nodes are imported: this file must never pull EffectComposer or other WebGL code.
import { RenderPipeline } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { codedError } from '../../core/errorHints.js';
import { registerWebGPUPart, MSAA_SAMPLES } from '../backend.js';
import { RESERVED_LAYERS } from '../layers.js';
import * as FX from './library.tsl.js';
import { nameNodeBuild, lostStatements } from './nodeErrors.tsl.js';

const { pass, renderOutput, uniform, screenUV, screenSize, time, convertToTexture, mrt, output, normalView, diffuseColor, velocity } = TSL;

// What PostEffect.needsBuffers can ask of the scene render. Raw, not packed: display nodes read them as they are
const BUFFERS = { normal: normalView, diffuse: diffuseColor, velocity };

/** Which uniform a param value makes: 'number' (numbers, booleans as 0 / 1), a color or vector kind, or null: anything else rebuilds the chain when it changes */
const kindOf = v => (typeof v === 'number' || typeof v === 'boolean' ? 'number' : v?.isColor ? 'color' : v?.isVector2 ? 'vec2' : v?.isVector3 ? 'vec3' : v?.isVector4 ? 'vec4' : null);
/** Live uniform for a param value, or null when it has no live kind */
function liveUniform(v) {
  const kind = kindOf(v);
  return kind === null ? null : uniform(kind === 'number' ? +v : v.clone());
}
/** Can this uniform take the value as a plain write? A color uniform also takes what Color.set takes (0xffcc66, 'red'). A number uniform never takes a color: its type is fixed in the graph */
const fits = (u, v) => !!u && (kindOf(u.value) === kindOf(v) ? kindOf(v) !== null : kindOf(u.value) === 'color' && (typeof v === 'number' || typeof v === 'string'));
function writeUniform(u, v) {
  if (u.value?.isColor) u.value.set(v);
  else if (typeof u.value === 'number') u.value = +v;
  else u.value.copy(v);
}
/** The effect's uniform nodes by param name, made once per effect and kept across chain rebuilds (so set() keeps working on the same nodes) */
function uniformsOf(h) {
  if (!h._u) { h._u = {}; for (const [k, v] of Object.entries(h.params)) { const u = liveUniform(v); if (u) h._u[k] = u; } }
  return h._u;
}

/**
 * ctx.params for node() / fuse.tsl: the effect's live params, noting which keys are read while the node is built. Such a key went into the graph
 * as a plain number, so set() of it rebuilds (WebGL rebuilds an effect without update() the same way); keys read only through ctx.p stay
 * uniform writes. A read after the build (an onRenderUpdate callback, outline's color) sees the current value each time and is not noted.
 */
function paramsOf(h) {
  return h._paramsProxy ??= new Proxy(h.params, { get(t, k) { if (h._building && typeof k === 'string') h._read.add(k); return t[k]; } });
}

/**
 * Display nodes handed to effects as ctx.display, each call recorded so the effect's nodes are disposed when the chain is rebuilt.
 * Why handed in and not imported by the effect: the main entry of @threedog/post-effects is also loaded by WebGL games; importing three/webgpu there would grow their bundles.
 */
function displayFor(made) {
  const rec = f => (...a) => { const n = f(...a); made.push(n); return n; };
  // pass: an extra scene render (outline's normal / mask views); texture: the color so far as a texture, for effects that sample it at other
  // uvs (dof). Both own render targets, so they go through the recorder too; a node that already is a texture comes back as is and is not ours to dispose.
  const texture = n => { const t = convertToTexture(n); if (t !== n) made.push(t); return t; };
  return { bloom: rec(bloom), ao: rec(ao), pass: rec(extraPass), texture, own: n => { made.push(n); return n; } };
}

/** An extra scene render: occlusion's boxes belong to the scene pass alone, drawn here they would show through an override material (outline's normal view) */
function extraPass(scene, camera, opts) {
  const n = pass(scene, camera, opts), run = n.updateBefore.bind(n);
  n.updateBefore = frame => {
    const mask = camera.layers.mask;
    camera.layers.disable(RESERVED_LAYERS.occlusionBox);
    try { return run(frame); } finally { camera.layers.mask = mask; }
  };
  return n;
}

const onlyCreate = e => codedError('post-effect', `[threedog] post effect '${e.name}' has only create() (a three.js Pass, WebGLRenderer only); on WebGPURenderer give it ` +
  `node: (input, ctx) => colorNode, e.g. node: (input, { tsl, p }) => tsl.vec4(input.rgb.mul(p.amount), input.a) (recipe 52)`);
const glslOnly = e => codedError('post-effect', `[threedog] post effect '${e.name}': its fuse snippet is GLSL only; on WebGPURenderer add fuse.tsl: ` +
  `(color, uv, t) => color, e.g. tsl: (color, uv, { tsl, p }) => tsl.vec4(color.rgb.mul(p.amount), color.a) (recipe 52)`);

const webgpuPost = {
  init(post) { post._pipe = null; },
  object: post => (post._pipe ? { pipeline: post._pipe.pipeline, scenePass: post._pipe.scenePass } : null),
  // The pass node owns its render targets and resizes them with the renderer; nothing is handed out as ping-pong targets on this backend
  targets: () => null,
  /**
   * Param change: number / color params only write their uniforms; another kind (a texture, a mode string), a value of another kind than its
   * uniform (a Color for a param that started as a number: the uniform is replaced), or a param node() read as a plain value from ctx.params
   * (built into the graph as a constant, so its uniform reaches nothing), rebuilds the chain, as WebGL rebuilds an effect without update(). true = handled
   */
  set(post, h, p) {
    if (Object.entries(p).every(([k, v]) => fits(h._u?.[k], v) && !h._read?.has(k))) { for (const [k, v] of Object.entries(p)) writeUniform(h._u[k], v); return true; }
    for (const [k, v] of Object.entries(p)) {
      if (fits(h._u?.[k], v)) writeUniform(h._u[k], v);
      else if (h._u?.[k] && kindOf(v)) h._u[k] = liveUniform(v);
    }
    if (h.enabled) { h._impl?.dispose?.(); h._impl = null; post._pipe && (post._pipe.key = null); post._sync(); }
    return true;
  },
  refresh() {},
  samples: post => (post.active ? post._pipe?.samples ?? (post._aa ? MSAA_SAMPLES : 0) : post.engine.renderer.samples),
  setAntialias(post) { if (post._pipe) post._pipe.key = null; },
  sync(post) {
    const { renderer, scene, camera } = post.engine;
    const on = post._sorted().filter(e => e.enabled);
    // the union over the effects that are on, in one fixed order: one setMRT for all of them, and none at all (no extra targets) when nobody asks
    const buffers = Object.keys(BUFFERS).filter(b => on.some(e => e._def.needsBuffers?.includes(b)));
    // velocity means a temporal resolve follows: it is the antialiasing, and MSAA under it would only cost
    const samples = post._aa && !buffers.includes('velocity') ? MSAA_SAMPLES : 0;
    for (const e of on) if (e._def.fuse ? typeof e._def.fuse.tsl !== 'function' : typeof e._def.node !== 'function') throw e._def.fuse ? glslOnly(e) : onlyCreate(e);
    // Same effects, same build, same samples: the graph is current (a set() of a number param never gets here)
    const key = `${samples}|${buffers}|${on.map(e => e.name).join(',')}`;
    if (post._pipe?.key === key) return;
    let P = post._pipe;
    if (!P) P = post._pipe = { pipeline: new RenderPipeline(renderer), scenePass: null, samples: -1, buffers: '', key: null, order: [] };
    if (P.samples !== samples || P.buffers !== `${buffers}`) {
      P.scenePass?.dispose(); P.scenePass = pass(scene, camera, { samples }); P.samples = samples; P.buffers = `${buffers}`;
      if (buffers.length) P.scenePass.setMRT(mrt({ output, ...Object.fromEntries(buffers.map(b => [b, BUFFERS[b]])) }));
    }
    // Every structural change rebuilds every effect's nodes: an effect's input is the node before it, which changed too
    for (const e of post._list) { e._impl?.dispose?.(); e._impl = null; }
    const size = post._size(), order = [];
    const ctxOf = (e, made) => ({ engine: post.engine, scene, camera, width: size.x, height: size.y, params: paramsOf(e), scenePass: P.scenePass,
      tsl: TSL, fx: FX, display: displayFor(made), p: uniformsOf(e) });
    // the effect's node is built only when the pipeline first draws: errors then, and statements lost outside an Fn, name the effect
    const run = (e, color) => {
      const label = `[threedog] post effect '${e.name}'`;
      return nameNodeBuild(lostStatements(label, () => build(e, color)), label, color);
    };
    const build = (e, color) => {
      const made = [];
      e._impl = { nodes: made, dispose() { for (const n of made) n.dispose?.(); made.length = 0; } };
      order.push(e.name);
      e._read = new Set(); e._building = true;
      try {
        if (e._def.fuse) {
          const f = e._def.fuse, t = { ...ctxOf(e, made), time, resolution: screenSize, input: f.reads ? convertToTexture(color) : null };
          if (t.input) made.push(t.input);
          return f.tsl(color, screenUV, t);
        }
        return e._def.node(color, ctxOf(e, made));
      } finally { e._building = false; }
    };
    const slot = s => on.filter(e => e.slot === s);
    let color = P.scenePass.getTextureNode();
    const sceneFx = slot('scene')[0];
    if (sceneFx) color = run(sceneFx, color); else order.push('scene render');
    for (const e of slot('hdr')) color = run(e, color);
    const toneFx = slot('tone')[0];   // a game's tone stage replaces renderOutput (it outputs display color itself)
    if (toneFx) color = run(toneFx, color); else { color = renderOutput(color); order.push('output (tone mapping)'); }
    for (const e of [...slot('ldr'), ...slot('final')]) color = run(e, color);
    P.pipeline.outputColorTransform = false;
    P.pipeline.outputNode = color; P.pipeline.needsUpdate = true;
    P.output = color; P.order = order; P.key = key;
  },
  dispose(post) {
    const P = post._pipe;
    if (!P) return;
    P.scenePass?.dispose(); P.pipeline.dispose(); post._pipe = null;
  },
  // start()'s compileAsync target: pass() renders into its own target whose program key three manages; the canvas key is the closest stand-in
  sceneTarget: () => null,
  // target: the pipeline's last quad draws into the renderer's current target (pass() nodes put it back after their own renders)
  render(post, dt, target = null) {
    if (!post._pipe) post._sync();
    onTarget(post.engine.renderer, target, () => post._pipe.pipeline.render());
  },
  /**
   * Straight to the canvas. postWebGL's direct() draws a Color background (or the clear color) as a tone-mapped quad so it matches the composer
   * path; nothing like it is needed here: with tone mapping or an sRGB output, WebGPURenderer draws the scene (clear included) into its own
   * half-float frame-buffer target and tone-maps the whole image in one output pass, so a clear is tone-mapped like every mesh
   * (tests/specs/post-webgpu.mjs: Color, HDR Color and clear-color backgrounds equal WebGL's to the pixel). An sRGB texture background is
   * tone-mapped here too, as on both WebGL paths (postWebGL.js toneBackground; tests/specs/engine-webgpu.mjs colorSpots).
   * MSAA: the renderer's own samples (made with the default antialias), so an effect-free frame needs no pipeline; a runtime switch away from
   * them runs the pipeline with pass() samples (PostFX active).
   */
  direct(post, target = null) { const { renderer, scene, camera } = post.engine; onTarget(renderer, target, () => renderer.render(scene, camera)); },
};

/** Run draw with target set (null: as it is, the canvas), then put the previous target back */
function onTarget(r, target, draw) {
  if (!target) { draw(); return; }
  const prev = r.getRenderTarget();
  r.setRenderTarget(target);
  try { draw(); } finally { r.setRenderTarget(prev); }
}

registerWebGPUPart('post', Object.freeze(webgpuPost));
