// Particle point-sprite shaders: size by distance (capped at uMaxPx), soft round dot or a texture, rotation, fog, tone mapping and output color space.
export const vert = `
  attribute float aSize; attribute float aAlpha; attribute float aAngle; attribute vec3 aColor;
  varying float vAlpha; varying float vAngle; varying vec3 vColor;
  uniform float uScale; uniform float uMaxPx;
  #include <fog_pars_vertex>
  void main() {
    vAlpha = aAlpha; vAngle = aAngle; vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aAlpha <= 0.0 ? 0.0 : min(aSize * uScale / max(0.1, -mvPosition.z), uMaxPx);   // capped: no screen-filling sprites near the camera
    #include <fog_vertex>
  }`;
export const frag = `
  uniform sampler2D uMap; uniform float uHasMap;
  varying float vAlpha; varying float vAngle; varying vec3 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vAngle), s = sin(vAngle);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    vec4 tex = uHasMap > 0.5 ? texture2D(uMap, p + 0.5) : vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.2, length(p)));
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;
