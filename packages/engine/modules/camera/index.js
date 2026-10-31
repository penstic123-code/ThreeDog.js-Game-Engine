// Camera module collection. All four cameras install as engine.cameraRig, only one at a time:
//   followCamera()       third-person follow (default)
//   firstPersonCamera()  first person
//   fixedCamera()        fixed shots (camera cuts)
//   rtsCamera()          strategy top-down (pan, zoom, rotate, screen point -> ground)
// Cutscene takeover contract engine.cameraOverride: see common.js.
export { followCamera, FollowCamera } from './FollowCamera.js';
export { firstPersonCamera, FirstPersonCamera } from './FirstPersonCamera.js';
export { fixedCamera, FixedCamera } from './FixedCamera.js';
export { rtsCamera, RtsCamera } from './RtsCamera.js';
export { screenToGround } from './common.js';
