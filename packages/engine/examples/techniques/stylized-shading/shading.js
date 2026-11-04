// @ts-check
// Stylized shading: three routes that reshape how light lands on a surface, all as patches on three's own lit materials, so every route still
// takes the game's sun, its shadow map, hemisphere / point lights and fog (nothing here replaces the light loop or edits ShaderChunk).
// Copy this file into a game (for example src/picture/shading.js); it imports only three and threedog. Numbers live in uniforms, so materials
// that differ only in values share one shader program.
import * as THREE from 'three';
import { applyEffects } from 'threedog';

// Sun shadow for this pixel (1 lit, 0 shadowed). Goes in the `lightsPars` slot because getShadow and the light uniforms only exist from there.
// three sorts shadow-casting directional lights first, so index 0 is the sun when it casts shadows.
const SUN_SHADOW = `#ifndef TECH_SUN_SHADOW
#define TECH_SUN_SHADOW
float techSunShadow(){
  #if NUM_DIR_LIGHTS > 0 && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    return receiveShadow ? getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity,
      directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
  #else
    return 1.0;
  #endif
}
#endif`;
const LUM = 'vec3(0.2126, 0.7152, 0.0722)';

/**
 * A toon ramp as a 1-D texture: x = how much sun reaches the pixel (0 = turned away or in shadow, 1 = facing it), color = the light the band
 * gets. Stops can be grays or colors (a warm lit band, a neutral mid band). NearestFilter keeps the borders hard; LinearFilter on a wider
 * texture gives soft borders.
 * @param {[number, THREE.ColorRepresentation | number][]} stops [sun share where the band starts 0-1, light: gray 0-1 or a color], ascending
 * @param {number} [width] texels; more = band borders closer to where you put them
 */
export function rampTexture(stops, width = 64) {
  const data = new Uint8Array(width * 4), c = new THREE.Color();
  for (let i = 0; i < width; i++) {
    const x = (i + 0.5) / width;
    let v = stops[0][1];
    for (const [at, value] of stops) if (x >= at) v = value;
    if (typeof v === 'number' && v <= 1) c.setRGB(v, v, v); else c.set(v);
    data.set([c.r * 255, c.g * 255, c.b * 255, 255], i * 4);   // linear light values, not sRGB colors: they multiply the sun
  }
  const t = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;   // Linear would blur every border into a gradient: the bands are the point
  t.needsUpdate = true;
  return t;
}

/**
 * Route 1, toon: the sun's share of the light (n.l times the sun's shadow) is cut into flat bands, either by a ramp texture (`ramp`) or by
 * smoothstep in the shader (`bands` + `soft`). Cast shadows count as "no sun", so they fall into the dark band like a self-shadow. Hemisphere
 * and point lights stay smooth: only the sun is banded. The dark band's ambient light moves towards `shade` at the same brightness, the
 * classic "shadow is a cooler color, not a darker gray".
 * three's own MeshToonMaterial is the other route: it bands every light, reads only the red channel of its gradientMap at n.l * 0.5 + 0.5,
 * and has no place for a shade color.
 * @param {{ color: THREE.ColorRepresentation, ramp?: THREE.Texture, bands?: number, soft?: number, shade: THREE.ColorRepresentation, shadeStrength?: number }} o
 */
export function toonMaterial({ color, ramp, bands = 3, soft = 0.02, shade, shadeStrength = 0.7 }) {
  return applyEffects(new THREE.MeshLambertMaterial({ color }), { patches: [toonPatch({ ramp, bands, soft, shade, shadeStrength })] });
}

/** The patch behind toonMaterial, for your own lit material @param {{ ramp?: THREE.Texture, bands?: number, soft?: number, shade: THREE.ColorRepresentation, shadeStrength?: number }} o */
export function toonPatch({ ramp, bands = 3, soft = 0.02, shade, shadeStrength = 0.7 }) {
  const band = ramp
    ? 'vec3 q3 = texture2D( uToonRamp, vec2( lit, 0.5 ) ).rgb; float q = dot( q3, ' + LUM + ' );'
    : `float q = 0.0;
    for ( int i = 1; i < 6; i ++ ) {                   // constant loop bound: GLSL ES wants it; uBands (2..6) stops it
      if ( float( i ) >= uBands ) break;
      float edge = float( i ) / uBands;
      q += smoothstep( edge - uBandSoft, edge + uBandSoft, lit );
    }
    q /= max( uBands - 1.0, 1.0 );                       // 0, 1/(n-1) ... 1: n flat levels
    vec3 q3 = vec3( q );`;
  return {
    name: 'toon', cacheKey: ramp ? 'ramp' : 'smooth',
    uniforms: { uBands: { value: bands }, uBandSoft: { value: soft }, uBandShade: { value: new THREE.Color(shade) }, uBandShadeK: { value: shadeStrength },
      uToonRamp: { value: ramp ?? null } },
    pars: 'uniform float uBands; uniform float uBandSoft; uniform vec3 uBandShade; uniform float uBandShadeK; uniform sampler2D uToonRamp;',
    glsl: { lightsPars: SUN_SHADOW, lighting: `#if NUM_DIR_LIGHTS > 0
  {
    float lit = max( dot( normal, directionalLights[ 0 ].direction ), 0.0 ) * techSunShadow();   // what Lambert gave the sun, 0..1
    ${band}
    // swap the sun's smooth Lambert term for the banded one (three's diffuse BRDF is albedo / pi)
    reflectedLight.directDiffuse += ( q3 - lit ) * directionalLights[ 0 ].color * diffuseColor.rgb * RECIPROCAL_PI;
    vec3 hue = uBandShade / max( dot( uBandShade, ${LUM} ), 0.001 );   // the shade color at brightness 1: hue moves, value stays
    reflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), hue, ( 1.0 - clamp( q, 0.0, 1.0 ) ) * uBandShadeK );
  }
#endif` },
  };
}

/**
 * Route 2, painterly soft light: wrapped diffuse (light reaches past the terminator, forms read soft), a warm saturated band where light
 * turns into shade (painters exaggerate that edge), and colored shadows (shade and cast shadow lean to a cool hue instead of going gray).
 * @param {{ color: THREE.ColorRepresentation, wrap?: number, terminator?: THREE.ColorRepresentation, terminatorStrength?: number,
 *   shadow?: THREE.ColorRepresentation, shadowStrength?: number }} o
 */
export function painterlyMaterial({ color, wrap = 0.5, terminator = 0xff7a45, terminatorStrength = 0.35, shadow = 0x5a6fb0, shadowStrength = 0.6 }) {
  const m = new THREE.MeshLambertMaterial({ color });
  return applyEffects(m, { patches: [{
    name: 'painterly', cacheKey: 'v1',
    uniforms: { uPWrap: { value: wrap }, uPTerm: { value: new THREE.Color(terminator) }, uPTermK: { value: terminatorStrength },
      uPShadow: { value: new THREE.Color(shadow) }, uPShadowK: { value: shadowStrength } },
    pars: 'uniform float uPWrap; uniform vec3 uPTerm; uniform float uPTermK; uniform vec3 uPShadow; uniform float uPShadowK;\n#include <threedog_lighting>',
    glsl: { lightsPars: SUN_SHADOW, lighting: `#if NUM_DIR_LIGHTS > 0
  {
    float nl = dot( normal, directionalLights[ 0 ].direction ), sh = techSunShadow();
    vec3 sunC = directionalLights[ 0 ].color;
    reflectedLight.directDiffuse += threedogWrapDiffuse( nl, uPWrap, sunC, sh, diffuseColor.rgb );
    // a band centered a little on the lit side of the terminator; multiplied by the albedo so a dark surface gets a dark warm edge
    float band = smoothstep( -uPWrap, 0.1, nl ) * ( 1.0 - smoothstep( 0.1, 0.5, nl ) ) * sh;
    reflectedLight.directDiffuse += band * uPTermK * uPTerm * sunC * diffuseColor.rgb * RECIPROCAL_PI;
    // soft 0.5: the shade color creeps in over a wide part of the turn, like a glazed shadow
    reflectedLight.indirectDiffuse = threedogShadowTint( reflectedLight.indirectDiffuse, uPShadow, uPShadowK, 0.5, nl, sh );
  }
#endif` },
  }] });
}

/**
 * Route 3, stylized PBR: MeshStandardMaterial with designed ranges instead of defaults. Rough by default (0.55-0.95: matte, the highlight
 * spreads and stays dim), albedo kept inside 0.2-0.8 (nothing is pure white or coal black, so light has room either way), and a floor on
 * the ambient light so shade never goes black (`lift` = share of the albedo always visible).
 * @param {{ color: THREE.ColorRepresentation, roughness?: number, metalness?: number, lift?: number }} o
 */
export function stylizedPbrMaterial({ color, roughness = 0.8, metalness = 0, lift = 0.12 }) {
  const c = new THREE.Color(color), l = c.getHSL({ h: 0, s: 0, l: 0 }).l;
  if (l < 0.08 || l > 0.92) console.warn(`stylizedPbrMaterial: lightness ${l.toFixed(2)} is outside the designed range 0.08-0.92; light has no room left`);
  const m = new THREE.MeshStandardMaterial({ color: c, roughness, metalness });
  return applyEffects(m, { patches: [{
    name: 'pbrLift', cacheKey: 'v1', uniforms: { uLift: { value: lift } }, pars: 'uniform float uLift;',
    glsl: { lighting: 'reflectedLight.indirectDiffuse = max( reflectedLight.indirectDiffuse, uLift * diffuseColor.rgb );' },
  }] });
}
