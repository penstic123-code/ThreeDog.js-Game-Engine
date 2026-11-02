import * as THREE from 'three';
import { codedError } from './errorHints.js';

// three 0.187 shadow filters. cost = rough relative shadow-pass cost vs pcf (an estimate, not measured: vsm adds a blur pass and
// float targets, basic is a single hard-edged tap).
export const SHADOW_TYPES = {
  basic: { three: THREE.BasicShadowMap, cost: 0.8 },
  pcf: { three: THREE.PCFShadowMap, cost: 1 },
  vsm: { three: THREE.VSMShadowMap, cost: 1.6 },
};

/** Validate a shadow type name; throws with the allowed values (a wrong name would otherwise silently fall back to the default look). */
export function shadowTypeOf(name, where) {
  if (Object.hasOwn(SHADOW_TYPES, name)) return SHADOW_TYPES[name].three;
  throw codedError('shadow-type', `${where}: unknown shadow type ${JSON.stringify(name)}. Use one of: ${Object.keys(SHADOW_TYPES).map(k => `'${k}'`).join(', ')}.`);
}
