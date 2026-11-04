// @ts-check
// Materials by name. All matte Lambert with two shader additions: soft light (the wrap and the cool shade) on every one, snow on what winter whitens.
// Built when this file loads, with no engine: models.js and content/ name them directly. The patches go through applyEffects, not onBeforeCompile,
// because the terrain clones its material per chunk and only patches survive a clone.
import { THREE, applyEffects } from '../../../index.js';
import { COLORS, SNOW, SOFT } from './palette.js';

const shade = new THREE.Color(SOFT.shade);
// a hue, not a color: the shade side keeps its brightness and only moves toward blue
shade.multiplyScalar(1 / Math.max(0.2126 * shade.r + 0.7152 * shade.g + 0.0722 * shade.b, 0.001));
const soft = {
  name: 'softLight', cacheKey: 1,
  uniforms: { uSoftWrap: { value: SOFT.wrap }, uSoftHue: { value: shade }, uSoftShade: { value: new THREE.Vector2(SOFT.strength, SOFT.soft) } },
  pars: 'uniform float uSoftWrap; uniform vec3 uSoftHue; uniform vec2 uSoftShade;',
  glsl: {
    // three keeps shadow-casting lights first, so directional light 0 is the sun
    lightsPars: `float softSunShadow(){
      #if NUM_DIR_LIGHTS > 0 && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        return receiveShadow ? getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity,
          directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
      #else
        return 1.0;
      #endif
    }`,
    lighting: `#if NUM_DIR_LIGHTS > 0
      float softLit = softSunShadow(), softNL = dot( normal, directionalLights[ 0 ].direction );
      // half-lambert: only what it adds beyond plain Lambert, with the sun's color and shadow
      reflectedLight.directDiffuse += ( max( ( softNL + uSoftWrap ) / ( 1.0 + uSoftWrap ), 0.0 ) - max( softNL, 0.0 ) ) * directionalLights[ 0 ].color * softLit * RECIPROCAL_PI * diffuseColor.rgb;
      float softDark = ( 1.0 - softLit * smoothstep( 0.0, uSoftShade.y, softNL ) ) * uSoftShade.x;
      reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, reflectedLight.indirectDiffuse * uSoftHue, softDark );
    #endif`,
  },
};

const uSnow = { value: 0 };
// The 'emissive' slot runs after every color step, so the per-chunk ground color map cannot paint the green back over the white
const snow = {
  name: 'snow', cacheKey: 1, uniforms: { uSnow, uSnowColor: { value: new THREE.Color(SNOW.color) } },
  pars: 'uniform float uSnow; uniform vec3 uSnowColor;', slot: /** @type {const} */ ('emissive'),
  glsl: 'diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, uSnow);',
};

const lambert = (/** @type {THREE.MeshLambertMaterialParameters} */ p, ...more) =>
  applyEffects(new THREE.MeshLambertMaterial(p), { clouds: false, patches: [soft, ...more] });

export const mat = {
  ground: lambert({ vertexColors: true }, snow),
  cliff: lambert({ vertexColors: true }),   // its own material: in snow the earth walls stay brown under a white top
  leaf: lambert({ vertexColors: true }, snow),
  bark: lambert({ color: COLORS.bark }),
  wool: lambert({ vertexColors: true }),
  face: lambert({ color: COLORS.face }),
  wheat: lambert({ vertexColors: true, side: THREE.DoubleSide }, snow),   // the stalks are thin: both sides
};

/** @param {any} engine */
export function createMaterials(engine) {
  return {
    update() { uSnow.value = engine.calendar.season === 'winter' ? SNOW.amount : 0; },
  };
}
