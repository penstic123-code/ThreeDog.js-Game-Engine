# engine.hlod — hlod(opts?: HlodOptions)

(experimental) HLOD, merged distant geometry (hlod() module)

- Options `HlodOptions`:
  - `level?: boolean` Handle levels automatically (adds the level on level:loaded), default true
  - `cell?: number` Merge cell edge length (meters), default 64
  - `near?: number` Beyond this distance (meters) the merged proxy is shown, default 160
  - `castShadow?: boolean` Proxy casts shadows, default false
  - `include?: (mesh: Object3D) => boolean` Which meshes to merge (return false to skip)

## Methods and properties
- `hlod.add(target: Object3D | Object3D[], opts?: HlodAddOptions) → HlodHandle` — Register a group of objects (a root or an array), merged into proxies by cell
- Properties:
  - `cells: HlodCell[]` All merged cells

## Data structures
- **HlodAddOptions** Parameters of hlod.add()
  - `cell?: number`
  - `near?: number`
  - `castShadow?: boolean`
  - `include?: (mesh: Object3D) => boolean` Which meshes to merge (return false to skip)
- **HlodCell** One merged cell: proxy is the merged proxy meshes, originals the original objects
  - `key: string` Cell key 'x,z'
  - `proxy: Object3D[]` Merged proxy meshes (one per material)
  - `originals: Object3D[]` Originals
  - `center: Vector3` Average center of the originals (for distance)
  - `far: boolean` The proxy is currently shown
- **HlodHandle** Handle returned by hlod.add()
  - `cells: HlodCell[]`
  - `near: number` Beyond this distance (meters) the proxy is shown
  - `ready: boolean` Are all proxies merged (done over several frames)
  - `whenReady: Promise<HlodHandle>` Promise that resolves when merging is done: await h.whenReady
  - `remove()` — Cancel: restore the originals, free the proxies
