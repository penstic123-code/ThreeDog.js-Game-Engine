# engine.water — water(opts?: WaterOptions)

Water surface (water() module)

- Options `WaterOptions`:
  - `sea?: boolean` false: do not draw the global water surface (sea)
  - `level?: number` Global water level (meters); if omitted, the terrain's water level is used
  - `color?: ColorLike`
  - `opacity?: number`
  - `flat?: boolean`
  - `waveHeight?: number`
  - `waveScale?: number`
  - `waveSpeed?: number`
  - `fresnel?: number`
  - `size?: number`
  - `segments?: number`
  - `normalMap?: string`
  - `normalScale?: number`
  - `normalRepeat?: number`
  - `normalSpeed?: number[]`
  - `shininess?: number`
  - `specular?: ColorLike`
  - `material?: import('./style').StyleWater['material']` Replace the whole surface material, same as style.water.material
  - `depthColor?: import('./style').StyleWater['depthColor']`
  - `foam?: import('./style').StyleWater['foam']`
  - `uniforms?: import('./style').StyleWater['uniforms']`

## Methods and properties
- Properties:
  - `material: THREE.Material` Water material (shared by all water)
  - `bodies: Map<WaterBody, THREE.Mesh>` Water body → mesh
  - `sea: THREE.Mesh | null` Global water mesh (null when absent)

## Data structures
- **WaterBodyOptions** Parameters of engine.addWaterBody(): position center, level water surface height (meters); give radius for a circle, halfWidth / halfDepth for a rectangle
  - `position: PositionLike`
  - `level: number`
  - `radius?: number`
  - `halfWidth?: number`
  - `halfDepth?: number`
- **WaterBody** A standalone body of water (stored in engine.waterBodies and given by the water:add event, already converted): circle { x, z, radius, level } or rectangle { x, z, hw, hd, level } (meters)
  - `x: number` Center position (meters)
  - `z: number`
  - `level: number` Water surface height (meters)
  - `radius?: number` Radius of a circular body (meters)
  - `hw?: number` Half width and half depth of a rectangular body (meters)
  - `hd?: number`
