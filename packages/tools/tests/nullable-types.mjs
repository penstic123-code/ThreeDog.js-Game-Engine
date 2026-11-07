// Fields that are null at runtime say so in their declaration.
// Why: the second review found these stated non-null, and a game reading engine.views.current.length from the types meets the null at play time, not in `threedog types`.
// Offline: reads the declarations. tsconfig has strict off, so tsc itself cannot see a missing `| null`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE } from '../paths.mjs';

const FIELDS = [
  ['calendar.season', 'types/generated/modules/calendar/Calendar.d.ts', 'get season(): string | null;'],
  ['world.zone', 'types/generated/modules/world/World.d.ts', 'get zone(): string | null;'],
  ['views.current', 'types/generated/core/scene/Views.d.ts', 'current: string | null;'],
  ['stream.radius', 'types/generated/core/stream/Stream.d.ts', 'get radius(): number | null;'],
  ['audio.state', 'types/generated/core/audio/Audio.d.ts', 'state: string | null;'],
  ['player.seat', 'types/gameplay.d.ts', 'seat: number | null;'],
  ['player.airJumpSpeed', 'types/gameplay.d.ts', 'airJumpSpeed: number | null;'],
  ['startup.firstFrameMs', 'types/core.d.ts', 'firstFrameMs: number | null;'],
];

export const name = 'nullable types: a field that is null at runtime is declared with | null';

export async function run({ check }) {
  for (const [field, file, line] of FIELDS) check(`${field} is declared nullable`, readFileSync(join(ENGINE, file), 'utf8').includes(line), `${file} has no "${line}"`);
}
