// Particle point-sprite shaders: size by distance (capped at uMaxPx), soft round dot or a texture, rotation, fog, tone mapping and output color space.
// SOFT (the soft option): fades where the particle meets opaque geometry; uDepth is the scene depth Particles._sceneDepth drew. Without it the shaders are as ever.
export const vert = `
  attribute float aSize; attribute float aAlpha; attribute float aAngle; attribute vec3 aColor;
  varying float vAlpha; varying float vAngle; varying vec3 vColor;
  uniform float uScale; uniform float uMaxPx;
  #ifdef SOFT
    varying float vViewZ;
  #endif
  #include <fog_pars_vertex>
  void main() {
    vAlpha = aAlpha; vAngle = aAngle; vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #ifdef SOFT
      vViewZ = mvPosition.z;
    #endif
    // uScale is pixels per meter at distance 1, or just pixels per meter on an orthographic camera (no shrink with distance); capped: no screen-filling sprites near the camera
    gl_PointSize = aAlpha <= 0.0 ? 0.0 : min(aSize * uScale / (isOrthographic ? 1.0 : max(0.1, -mvPosition.z)), uMaxPx);
    #include <fog_vertex>
  }`;
export const frag = `
  uniform sampler2D uMap; uniform float uHasMap;
  varying float vAlpha; varying float vAngle; varying vec3 vColor;
  #ifdef SOFT
    #include <packing>
    uniform sampler2D uDepth; uniform vec4 uDepthView; uniform vec2 uClip; uniform float uSoft;
    varying float vViewZ;
  #endif
  #include <fog_pars_fragment>
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vAngle), s = sin(vAngle);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    vec4 tex = uHasMap > 0.5 ? texture2D(uMap, p + 0.5) : vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.2, length(p)));
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
    #ifdef SOFT
      float d = texture2D(uDepth, (gl_FragCoord.xy - uDepthView.xy) / uDepthView.zw).x;
      float sceneZ = isOrthographic ? orthographicDepthToViewZ(d, uClip.x, uClip.y) : perspectiveDepthToViewZ(d, uClip.x, uClip.y);
      gl_FragColor.a *= clamp((vViewZ - sceneZ) / uSoft, 0.0, 1.0);
    #endif
    if (gl_FragColor.a < 0.01) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;
