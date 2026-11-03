// A plain three.js postprocessing Pass: plugged into the post chain (engine.look.post.add, named by this file: look.post.set({ "20-copy": false })).
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';

export default new ShaderPass(CopyShader);
