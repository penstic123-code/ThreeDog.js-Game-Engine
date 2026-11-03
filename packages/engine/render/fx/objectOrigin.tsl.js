// TSL objectOrigin(): object / instance world origin.
// TSL objectOrigin(): world origin of the drawn object / instance (the `ip` of GLSL threedog_wind_vertex).
// GLSL version: modelMatrix * instanceMatrix * vec4(0,0,0,1). three has no public instance-matrix node; the first experiment wrapped mesh.instanceMatrix
// in a second instanced attribute, which tied the material to one mesh. This uses referenceAttribute('instanceMatrix'), as three's own instancing does: at build time it
// reads the attribute of the object being drawn, each object binding its own, so several InstancedMeshes can share one material.
// three takes this path only while vertex buffers suffice (Instance.js canReferenceInstanceData, 8-buffer limit); otherwise it compiles per mesh,
// which would mean copying three's private logic, so that case throws by name. BatchedMesh's batch matrices are also private to three: same error.
import { Fn, vec4, mat3, modelWorldMatrix, referenceAttribute } from 'three/tsl';
import { codedError } from '../../core/errorHints.js';

const MAX_VERTEX_BUFFERS = 8;   // three/src/nodes/accessors/Instance.js (same constant, same test)

/**
 * The instance matrix node of the object being built, or null when it is not instanced (throws for what three binds privately)
 * @param {any} builder @returns {import('three/webgpu').Node<'mat4'> | null}
 */
function instanceMatrixOf(builder) {
  const o = builder.object;
  if (o?.isBatchedMesh) throw codedError('tsl-misuse', 'threedog/tsl objectOrigin(): BatchedMesh is not supported in TSL yet');
  if (!o?.isInstancedMesh) return null;
  const buffers = 1 + (o.instanceColor !== null ? 1 : 0) + (builder.needsPreviousData() ? 1 : 0);
  if (builder.renderer?.isRenderer !== true || Object.keys(o.geometry.attributes).length + buffers > MAX_VERTEX_BUFFERS)
    throw codedError('tsl-misuse', `threedog/tsl objectOrigin(): InstancedMesh '${o.name || o.uuid}' has too many vertex attributes for a shared instance matrix`);
  // @types/three types referenceAttribute() as a bare ReferenceAttributeNode (no node type, no operators); with 'mat4' it is a mat4 node
  return /** @type {any} */ (referenceAttribute('instanceMatrix', 'mat4'));
}

/** World position of the object's (or instance's) origin, vec3 */
export const objectOrigin = Fn((_, builder) => {
  const m = instanceMatrixOf(builder), o = vec4(0, 0, 0, 1);
  return modelWorldMatrix.mul(m ? m.mul(o) : o).xyz;
});

/**
 * An object-space offset carried through the instance's rotation / scale: GLSL patches add offsets before instanceMatrix,
 * a TSL positionNode runs after it, so wind()'s offset goes through this to land the same
 * @internal
 */
export const instanceOffset = Fn(/** @param {[import('three/webgpu').Node<'vec3'>]} a @param {any} builder */ ([v], builder) => {
  const m = instanceMatrixOf(builder);
  return m ? mat3(m).mul(v) : v;
});
