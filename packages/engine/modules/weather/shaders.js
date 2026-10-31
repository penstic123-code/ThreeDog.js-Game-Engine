// Weather particle shaders: rain (short line segments; position loops downward in the shader, zero CPU cost), snow / textured drops (point sprites).
// Time arrives already wrapped on the CPU (uFallOff = fall distance mod area size, uSway = time mod 20π, the common period of the snow
// drift), so drops do not jitter from float32 precision in multi-hour sessions. Colors go through tone mapping and the output color
// space like three's own materials, so rain looks the same with and without post-processing.
export const rainVert = `uniform vec3 uCam; uniform float uSize; uniform float uFallOff; uniform vec2 uWindDir; uniform float uLen; attribute float aEnd;
varying float vA;
void main(){
  vec3 p = position;
  float fall = mod(p.y - uFallOff, uSize);
  vec3 w = vec3(mod(p.x - uCam.x + uWindDir.x * fall * 0.3, uSize) - uSize*0.5, fall - uSize*0.35, mod(p.z - uCam.z + uWindDir.y * fall * 0.3, uSize) - uSize*0.5);
  w += uCam;
  w.y -= aEnd * uLen; w.x -= aEnd * uWindDir.x * 0.2; w.z -= aEnd * uWindDir.y * 0.2;
  vA = 1.0 - aEnd * 0.8;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
export const rainFrag = `uniform float uOpacity; uniform vec3 uColor; varying float vA;
void main(){
  gl_FragColor = vec4(uColor, uOpacity * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export const snowVert = `uniform vec3 uCam; uniform float uSize; uniform float uPx; uniform float uMaxPx; uniform float uFallOff; uniform float uSway;
void main(){
  vec3 p = position;
  float fall = mod(p.y - uFallOff, uSize);
  vec3 w = vec3(mod(p.x - uCam.x + sin(uSway*0.7 + p.y)*1.5, uSize) - uSize*0.5, fall - uSize*0.35, mod(p.z - uCam.z + cos(uSway*0.5 + p.x)*1.5, uSize) - uSize*0.5) + uCam;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_PointSize = min(uPx * 3.0 / -mv.z, uMaxPx);
  gl_Position = projectionMatrix * mv;
}`;
// snowflake: use the texture if there is one (a style pack can supply a snowflake image), otherwise draw a round dot
export const snowFrag = `uniform float uOpacity; uniform vec3 uColor; uniform sampler2D uMap; uniform float uUseMap;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  vec4 c = uUseMap > 0.5 ? texture2D(uMap, gl_PointCoord) : vec4(1.0, 1.0, 1.0, step(dot(d,d), 0.25));
  if (c.a < 0.05) discard;
  gl_FragColor = vec4(uColor * c.rgb, uOpacity * c.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
