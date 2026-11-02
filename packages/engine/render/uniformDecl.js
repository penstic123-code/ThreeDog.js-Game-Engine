// Declares style-supplied GLSL uniforms (sky clouds, wind): { uTint: new THREE.Color(...), uK: 0.4, uPaper: texture } -> GLSL lines + { name: { value } }.
import * as THREE from 'three';
import { codedError } from '../core/errorHints.js';

const vec = a => a.length === 2 ? new THREE.Vector2(...a) : a.length === 3 ? new THREE.Vector3(...a) : new THREE.Vector4(...a);
function glslType(label, name, v) {
  if (typeof v === 'number') return 'float';
  if (v?.isColor) return 'vec3';
  if (v?.isVector2) return 'vec2'; if (v?.isVector3) return 'vec3'; if (v?.isVector4) return 'vec4';
  if (v?.isTexture) return 'sampler2D';
  throw codedError('material-option', `${label}.${name} must be a number, THREE.Color, THREE.Vector2/3/4, [x, y(, z, w)] array or THREE.Texture; got ${v === null ? 'null' : typeof v}`);
}

/**
 * Turn a style's `uniforms` object into GLSL declarations and three.js uniform objects (arrays of 2-4 numbers become vectors)
 * @internal
 * @param {string} label where the object came from, for errors (e.g. 'style.sky.clouds.uniforms')
 * @param {Record<string, any> | undefined} src
 * @returns {{ uniforms: Record<string, { value: any }>, decl: string }}
 */
export function declareUniforms(label, src) {
  /** @type {Record<string, { value: any }>} */ const uniforms = {};
  const decl = [];
  for (const [name, raw] of Object.entries(src || {})) {
    const value = Array.isArray(raw) ? vec(raw) : raw;
    decl.push(`uniform ${glslType(label, name, value)} ${name};`);
    uniforms[name] = { value };
  }
  return { uniforms, decl: decl.join('\n') };
}
