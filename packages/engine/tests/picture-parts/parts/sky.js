// Written as if from a shader library: a class, a ShaderMaterial, an update method, one tracked hook. Holds the sky and the main light, and owns the sun's strength:
// others dim it through the shared value 'sun.level', never by writing the light.
import * as THREE from 'three';

const FRAG = `uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vDir;
void main() { gl_FragColor = vec4(mix(uBottom, uTop, clamp(normalize(vDir).y * 0.5 + 0.5, 0.0, 1.0)), 1.0); }`;
const VERT = 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

export class GradientSky {
  name = 'gradientSky';
  type = 'picture';
  provides = ['sky', 'sun'];

  install(e, ctx) {
    this.e = e;
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 16, 12), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } } }));
    this.dome.name = 'skyDome';
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.name = 'sun';
    e.scene.add(this.dome, this.sun);
    this.level = e.stacks.has('sun.level') ? e.stacks.get('sun.level') : e.stacks.define('sun.level', { base: 1, min: 0, save: false });
    ctx.track(e.onRender(() => this.update()));
    ctx.track({ remove: () => this.teardown() });
    return this;
  }

  update() {
    const day = this.e.uniforms.uDaylight.value;
    this.sun.intensity = 2.5 * day * this.level.value();
    this.dome.material.uniforms.uTop.value.setRGB(0.1 + 0.3 * day, 0.15 + 0.4 * day, 0.3 + 0.6 * day);
  }

  teardown() {
    this.e.scene.remove(this.dome, this.sun);
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.sun.dispose();
  }
}
