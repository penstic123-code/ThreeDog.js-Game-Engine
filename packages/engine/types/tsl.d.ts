// threedog/tsl: the engine's shader functions as TSL Fn for NodeMaterials (WebGPURenderer). Same signatures and meaning as the GLSL
// functions of recipe 43 (#include <threedog_wind> ...): a value tuned on engine.uniforms reads the same in both. Not imported by 'threedog'.
// Each Fn reads the engine uniforms of the engine that owns the renderer compiling it (fails with [tsl-misuse] when there is none).

/** A TSL node (three/tsl); kept loose so this file does not pin three's own node typings */
type Node = any;

/**
 * GLSL vec3 threedogWind(vec3 position, vec3 origin, float amplitude): object-space sway offset, higher vertices sway more.
 * position: object space before the instance transform (positionGeometry); origin: the object's world origin (objectOrigin());
 * amplitude: metres per metre of height. Reads uTime, uWind, uWindFreq.
 * @example
 * mat.positionNode = positionLocal.add(wind(positionGeometry, objectOrigin(), float(0.3)));   // plain Mesh (InstancedMesh: rotate the offset by the instance)
 */
export function wind(position: Node, origin: Node, amplitude: Node | number): Node;
/**
 * GLSL float threedogCloudShadow(vec3 worldPos): light factor 0-1 under the drifting clouds (1 = no shadow). Reads uTime, uCloud*, uCloudSpeed.
 * @example
 * mat.colorNode = color(0x88aa66).mul(cloudShadow(positionWorld));
 */
export function cloudShadow(worldPos: Node): Node;
/**
 * GLSL vec3 threedogSeason(vec3 color, int kind): kind 0 foliage, 1 ground; tints by uFoliageTint / uGroundTint (mix mode when uFoliageMix / uGroundMix > 0).
 * A vec4 color is read as its rgb.
 * @example
 * mat.colorNode = season(texture(map), 0);
 */
export function season(color: Node, kind: Node | 0 | 1): Node;
/**
 * World position of the drawn object's origin (an InstancedMesh: of each instance), vec3. Works for any Mesh / InstancedMesh sharing the material;
 * BatchedMesh throws [tsl-misuse].
 */
export function objectOrigin(): Node;
/**
 * engine.uniforms as TSL uniform nodes (uTime, uWind, uCloud, uFoliageTint, uSunDir, uDaylight ...), cached per engine. They read the same
 * { value } objects, so engine.uniforms.uWind.value = 2 changes GLSL and TSL materials alike.
 * @example
 * const u = uniforms(engine);
 * mat.emissiveNode = color(0xffcc66).mul(float(1).sub(u.uDaylight));
 */
export function uniforms(engine: { uniforms: object }): Record<string, Node>;
/**
 * GLSL vec4 threedogDetailNoise(vec2 p, int kind, float octaves): kind 0 grain, 1 paper, 2 stroke, 3 dabs; returns (gray rgb, height 0-1).
 * No uniforms: p is any 2D pattern position you choose (world xz times a scale, a uv...). octaves: up to 4 (dabs: 3).
 * @example
 * mat.colorNode = color(0xb09070).mul(detailNoise(positionWorld.xz.mul(4), 1, 2).rgb.mul(2));
 */
export function detailNoise(p: Node, kind: Node | 0 | 1 | 2 | 3, octaves: Node | number): Node;
/**
 * GLSL vec3 threedogDetailBump(vec3 surfPos, vec3 surfNorm, float h, float k, float faceDir): screen-space bump from a height h, strength k.
 * View space; the result is a normal for material.normalNode.
 * @example
 * mat.normalNode = detailBump(positionView, normalView, detailNoise(positionWorld.xz.mul(4), 0, 2).a, 1, faceDirection);
 */
export function detailBump(surfPos: Node, surfNorm: Node, h: Node, k: Node | number, faceDir: Node | number): Node;
/**
 * GLSL vec3 threedogWrapDiffuse(float nl, float wrap, vec3 lightColor, float shadow, vec3 albedo): the half-lambert light beyond plain Lambert,
 * to add to directDiffuse. nl = dot(normal, sunDir). Call it from your LightingModel's direct() (lightColor there already carries the shadow: pass shadow 1).
 */
export function wrapDiffuse(nl: Node, wrap: Node | number, lightColor: Node, shadow: Node | number, albedo: Node): Node;
/**
 * GLSL vec3 threedogShadowTint(vec3 ambient, vec3 tint, float strength, float soft, float nl, float shadow): the ambient with the shaded side's hue moved
 * toward tint (brightness kept). shadow: 1 lit / 0 shadowed (the sun's lightNode.shadowNode); soft: terminator width in n.l.
 */
export function shadowTint(ambient: Node, tint: Node, strength: Node | number, soft: Node | number, nl: Node, shadow: Node | number): Node;
/**
 * GLSL vec3 threedogRim(vec3 normal, vec3 viewDir, vec3 color, float strength, float power, float shadowSide, float nl): edge light to add
 * (viewDir from the surface to the eye, e.g. normalView and positionViewDirection); shadowSide 1 = only on the side facing away from the sun.
 */
export function rim(normal: Node, viewDir: Node, color: Node, strength: Node | number, power: Node | number, shadowSide: Node | number, nl: Node): Node;
/**
 * GLSL float threedogWaterWave(vec3 p, float t): the built-in wave sum (height before waveHeight). p = world position * waveScale, t = time * waveSpeed.
 * @example
 * const h = waterWave(modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz, uniforms(engine).uTime).toVarying();
 * mat.positionNode = positionLocal.add(vec3(0, h, 0));
 */
export function waterWave(p: Node, t: Node | number): Node;
/**
 * The built-in water surface as TSL: returns a function with the GLSL signature threedogWaterSurface(base, wave, facing, worldPos, time) -> vec4 (rgb, opacity).
 * Only the parts given exist (depth: shallow / deep by viewing angle or wave height; foam on crests); values are numbers / colors or nodes.
 * wave is waterWave's height, facing = 1 looking straight down.
 */
export function waterSurface(spec?: { depth?: { shallow?: any, deep?: any, curve?: any, by?: 'view' | 'wave' }, foam?: { color?: any, start?: any, end?: any, opacity?: any }, waveMax?: number }):
  (base: Node, wave: Node, facing: Node, worldPos: Node, time: Node) => Node;
/** The water's fresnel blend: color mixed toward `towards` (the engine uses the fog color) by pow(1 - |viewDir . normal|, 3) * strength, view space */
export function waterFresnel(color: Node, normal: Node, viewDir: Node, strength: Node | number, towards: Node): Node;
