// The water surface defaults moved to render/fxNumbers.js (render/ must not import a module file). Re-exported so modules/water's imports
// keep working until that folder imports render/fxNumbers.js itself; then delete this file.
export { WAVE, WAVE_MAX, FRESNEL_POWER, DEPTH, FOAM } from '../../render/fxNumbers.js';
