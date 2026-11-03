# engine.photo — photo(opts?: PhotoOptions)

Photo mode (photo() module)

- Options `PhotoOptions` (also includes the fields of PhotoTakeOptions):
  - `maxAlbum?: number` How many photos the album keeps at most, default 50

## Methods and properties
- `photo.take(opts?: PhotoTakeOptions) → PhotoShot` — Capture a photo now without checks. Gameplay takes photos through the op: engine.ops.run('photo.take') (checks canTake, logged)
- `photo.subject() → { name, kind, distance } | null` — What is in the middle of the frame (NPC, entity, named object, vegetation), null if nothing; this is the subject of take()
- Properties:
  - `album: PhotoShot[]` Album (newest first)
  - `canTake: () => boolean | string` The op photo.take's can: return true, or false / a reason string to refuse (e.g. () => engine.inventory.has('film') // 'noFilm')
