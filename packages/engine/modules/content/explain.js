// Content's contribution to thing.explain(): rules read from the thing's template (collide, static, interact), which win over the world record's own.
import { orNull } from '../../core/base/util.js';

/** @internal */
export function contentExplain(e, t, out) {
  const def = t.template ? orNull(() => e.content.template(t.template)) : null;
  if (!def) return;
  Object.assign(out.rules, {
    blocksMovement: def.collide ?? false, pickable: def.static !== false,
    interact: def.interact ? { label: def.interact.label ?? null, op: def.interact.op } : null,
  });
}
