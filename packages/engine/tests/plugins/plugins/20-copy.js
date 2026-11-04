// A plain three.js postprocessing Pass: plugged into the post chain (engine.post.add, named by this file: engine.post.get("20-copy").enabled = false).
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';

export default new ShaderPass(CopyShader);
