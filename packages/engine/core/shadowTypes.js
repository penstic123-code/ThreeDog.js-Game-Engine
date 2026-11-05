import * as THREE from 'three';

// three 0.187 shadow filters. cost = rough relative shadow-pass cost vs pcf (an estimate, not measured: vsm adds a blur pass and
// float targets, basic is a single hard-edged tap).
export const SHADOW_TYPES = {
  basic: { three: THREE.BasicShadowMap, cost: 0.8 },
  pcf: { three: THREE.PCFShadowMap, cost: 1 },
  vsm: { three: THREE.VSMShadowMap, cost: 1.6 },
};
