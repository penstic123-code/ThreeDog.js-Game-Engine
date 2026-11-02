// GLSL for rc2d.js (2D radiance cascades), GLSL ES 3.0 as three.js compiles a ShaderMaterial under WebGL2 (texelFetch; gl_FragColor is mapped).
// Every pass is a full-screen quad drawn into a render target whose viewport is that target, so gl_FragCoord.xy is the texel being written.
// Units: "RC pixels" = texels of the scene / distance targets (screen size * quality scale).
// Technique (written from the public descriptions, no code copied): Alexander Sannikov, "Radiance Cascades: A Novel Approach to Calculating
// Global Illumination" (2023); jason.today "Building Real-Time Global Illumination" parts 1-2 (jump flood -> distance field -> cascades);
// GM Shaders "Radiance Cascades" posts. Layout: direction-first (one tile per direction, every probe of that direction inside the tile).

export const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Jump flood seed: a solid texel (alpha > 0.5 in the scene target) stores its own position; empty texels store "no seed" (alpha 0)
export const SEED = /* glsl */`
uniform sampler2D tScene;
void main() {
  vec4 s = texelFetch(tScene, ivec2(gl_FragCoord.xy), 0);
  gl_FragColor = s.a > 0.5 ? vec4(gl_FragCoord.xy, 0.0, 1.0) : vec4(0.0);
}`;

// One jump flood step: keep the nearest seed among the 3x3 neighbours uStep texels away. log2(size) steps give each texel its nearest solid texel.
export const JFA = /* glsl */`
uniform sampler2D tSeed;
uniform vec2 uSize;
uniform float uStep;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 best = vec4(0.0);
  float bestD = 1e20;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 q = p + vec2(float(x), float(y)) * uStep;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= uSize.x || q.y >= uSize.y) continue;
    vec4 s = texelFetch(tSeed, ivec2(q), 0);
    if (s.a < 0.5) continue;
    vec2 d = s.xy - p;
    float dd = dot(d, d);
    if (dd < bestD) { bestD = dd; best = s; }
  }
  gl_FragColor = best;
}`;

// Distance (RC pixels) from each texel centre to the nearest solid texel centre; 0 inside walls and lights, large where the screen has no solid at all
export const DIST = /* glsl */`
uniform sampler2D tSeed;
void main() {
  vec4 s = texelFetch(tSeed, ivec2(gl_FragCoord.xy), 0);
  gl_FragColor = vec4(s.a > 0.5 ? distance(s.xy, gl_FragCoord.xy) : 1e4, 0.0, 0.0, 1.0);
}`;

// One cascade: every texel is (direction tile, probe). Its ray is sphere-traced through the distance field over the cascade's interval and merged with
// the upper cascade (the 4 child directions of the same cone). The merge uses the "bilinear fix" from the paper: instead of tracing once and
// blending the 4 nearest upper probes, it traces one ray to each of those 4 probes' interval start and merges each with that probe, then blends
// the 4 results bilinearly. 4x the marching, but light no longer leaks through walls thinner than the upper probe spacing and the rings between
// cascades go. rgb = radiance, a = 1 if the ray was not blocked.
export const CASCADE = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tDist;
uniform sampler2D tUpper;
uniform vec2 uSize;        // RC pixels
uniform vec2 uTile;        // probes per axis in this cascade = one direction tile
uniform float uS;          // direction tiles per axis (directions = uS * uS)
uniform float uSpacing;    // probe spacing, RC pixels
uniform float uStart;
uniform float uLen;
uniform float uHasUpper;
uniform vec2 uUpperTile;
uniform float uUpperS;

vec4 march(vec2 from, vec2 to) {
  vec2 dir = to - from;
  float end = length(dir), t = 0.0;
  dir /= max(end, 1e-4);
  for (int i = 0; i < STEPS; i++) {
    if (t > end) break;
    vec2 p = from + dir * t;
    // off screen: nothing is known there; opaque black ends the ray (screen-space GI cannot see lights it does not draw)
    if (p.x < 0.0 || p.y < 0.0 || p.x >= uSize.x || p.y >= uSize.y) return vec4(0.0);
    float d = texelFetch(tDist, ivec2(p), 0).r;
    if (d < 0.5) return vec4(texelFetch(tScene, ivec2(p), 0).rgb, 0.0);
    // distances are centre to centre, so step a little less than d (never skip a corner), at least half a texel (grazing rays along walls)
    t += max(d - 0.7, 0.5);
  }
  return vec4(0.0, 0.0, 0.0, 1.0);
}

// the upper cascade's radiance at upper probe nb for this direction's cone: the mean of its 4 child directions
vec4 upper(vec2 nb, float idx) {
  vec4 far = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    float c = idx * 4.0 + float(j);
    vec2 ut = vec2(mod(c, uUpperS), floor(c / uUpperS));
    far += texelFetch(tUpper, ivec2(ut * uUpperTile + nb), 0);
  }
  return far * 0.25;
}

void main() {
  vec2 tc = floor(gl_FragCoord.xy);
  vec2 tile = floor(tc / uTile);
  vec2 probe = tc - tile * uTile;
  float idx = tile.y * uS + tile.x;
  float ang = (idx + 0.5) * 6.28318530718 / (uS * uS);
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 origin = (probe + 0.5) * uSpacing;
  vec2 from = origin + dir * uStart;
  if (uHasUpper < 0.5) { gl_FragColor = march(from, origin + dir * (uStart + uLen)); return; }
  // this probe in upper probe grid coordinates; its 4 bilinear neighbours (clamped at the screen edge) and their weights
  vec2 q = origin / (uSpacing * 2.0) - 0.5;
  vec2 base = floor(q), f = q - base;
  vec4 r = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k % 2), float(k / 2));
    vec2 w2 = mix(1.0 - f, f, o);
    vec2 nb = clamp(base + o, vec2(0.0), uUpperTile - 1.0);
    vec4 near = march(from, (nb + 0.5) * uSpacing * 2.0 + dir * (uStart + uLen));
    if (near.a > 0.0) { vec4 far = upper(nb, idx); near.rgb += far.rgb; near.a = far.a; }
    r += near * (w2.x * w2.y);
  }
  gl_FragColor = r;
}`;

// Final gather: average cascade 0's 4 directions at each RC pixel (bilinear between its 4 nearest probes) = light arriving at that pixel
export const GATHER = /* glsl */`
uniform sampler2D tC0;
uniform vec2 uTile0;
uniform vec2 uTex0;
uniform float uSpacing0;
void main() {
  vec2 q = clamp(gl_FragCoord.xy / uSpacing0 - 0.5, vec2(0.0), uTile0 - 1.0);
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) sum += texture(tC0, (vec2(float(j % 2), float(j / 2)) * uTile0 + q + 0.5) / uTex0).rgb;
  gl_FragColor = vec4(sum * 0.25, 1.0);
}`;

// Apply (hdr slot, linear colour): the frame was lit by the scene's own light at level uAmbient, so albedo ~ color / uAmbient and the cascade
// light adds albedo * gi on top
export const APPLY = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tGI;
uniform float uAmbient;
varying vec2 vUv;
void main() {
  vec4 c = texture(tDiffuse, vUv);
  gl_FragColor = vec4(c.rgb * (1.0 + texture(tGI, vUv).rgb / uAmbient), c.a);
}`;
