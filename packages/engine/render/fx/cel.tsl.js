// TSL celLighting(): the lighting model behind colored cel bands, on a MeshToonNodeMaterial (mat.setupLightingModel = celLighting).
// Why not three's ToonLightingModel alone: it reads only the red channel of gradientMap, and it multiplies the band by a light color that already
// holds the shadow, so everything the shadow map covers falls to zero direct light: the ramp's dark entries never show there and a cast shadow
// keeps the shadow map's soft edge. Here the shadow moves the ramp lookup instead (a shadowed pixel reads the ramp's dark end), so a cast shadow
// takes the same flat band and color as the turned-away side.
// Why colorNode cannot do this: it runs before lighting and sees no light. This runs inside three's light loop, for every light type.
import { LightingModel } from 'three/webgpu';
import { BRDF_Lambert, diffuseColor, normalView, materialReference, step, vec2, vec3 } from 'three/tsl';

class CelLightingModel extends LightingModel {
  /** Lights keep their color without the shadow while this model builds: three's getShadow hook returns what light.colorNode becomes @param {any} builder */
  start(builder) {
    const ctx = builder.context, had = ctx.getShadow;
    ctx.getShadow = lightNode => lightNode.baseColorNode;
    super.start(builder);
    if (had) ctx.getShadow = had; else delete ctx.getShadow;
  }

  /** @param {any} data @param {any} builder */
  direct({ lightDirection, lightColor, lightNode, reflectedLight }, builder) {
    // a light keeps its shadowNode after building a receiver, so an object that does not receive must not read it
    const shadow = builder.object.receiveShadow && builder.renderer.shadowMap.enabled && lightNode?.light?.castShadow ? lightNode.shadowNode : null;
    const lookup = normalView.dot(lightDirection).mul(0.5).add(0.5);   // three's toon lookup: the left half of the ramp is the side turned away
    const t = /** @type {any} */ (shadow ? lookup.mul(shadow.x) : lookup);
    const ramp = /** @type {any} */ (materialReference('gradientMap', 'texture'));
    const band = builder.material.gradientMap ? ramp.context({ getUV: () => vec2(t, 0) }).rgb : vec3(step(0.7, t).mul(0.3).add(0.7));
    reflectedLight.directDiffuse.addAssign(band.mul(lightColor).mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })));
  }

  /** @param {any} builder */
  indirect(builder) {
    const { ambientOcclusion, irradiance, reflectedLight } = builder.context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor })));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }
}

/**
 * The lighting model for colored cel bands: assign it to a MeshToonNodeMaterial whose gradientMap holds the ramp (rampTexture; colors work). Without a gradientMap: three's two default levels.
 * @example const mat = new MeshToonNodeMaterial({ color: 0xe08050, gradientMap: rampTexture([0x4a5a9a, 0xc0c8e0, 0xffffff]) }); mat.setupLightingModel = celLighting;
 */
export function celLighting() { return new CelLightingModel(); }
