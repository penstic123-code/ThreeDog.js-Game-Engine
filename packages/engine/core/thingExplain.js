// engine.thing(id).explain(): everything known about one id in one plain object (JSON-able, same for the CLI `threedog thing <id>`, MCP and tests).
// Why one object: an AI asked "why is this crate here, blocking me, and how do I change it?" otherwise joins thing(), world.origin, material info, the
// template, collision settings and the op list by hand. Each part reads an existing source; nothing here is stored or changes any state.
import { materialInfo } from './MaterialInfo.js';
import { orNull } from './util.js';

const MAT_MAX = 8;

/** Unique materials under obj with role / name / where the spec came from */
function materialsOf(obj) {
  const seen = new Set(), out = [];
  obj?.traverse?.(o => {
    for (const m of [o.material].flat()) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      if (out.length < MAT_MAX) { const i = materialInfo(m, o); out.push({ role: i.role, name: m.name || null, from: i.from, type: i.type, color: i.color, mesh: o.name || null }); }
    }
  });
  if (seen.size > MAT_MAX) out.push({ more: seen.size - MAT_MAX });
  return out;
}

/** Ops whose definition says (targets) they are for this id, kind or template; thing.set / thing.remove target '*' */
function opsFor(e, t) {
  const keys = new Set([t.id, t.kind, t.template].filter(Boolean));
  return [...e.ops.defs.values()].filter(d => d.targets != null && [d.targets].flat().some(x => x === '*' || keys.has(x)))
    .map(d => ({ op: d.name, desc: d.desc ?? null, args: d.args ?? null }));
}

/** What core knows about how the thing takes part in movement / picking: the size of its model. Template and record rules come from a module's explainer (below) */
function rulesOf(e, t, obj) {
  const out = {};
  if (obj) {
    const T = e.THREE, size = new T.Box3().setFromObject(obj).getSize(new T.Vector3());
    if (isFinite(size.y)) out.height = Math.round(size.y * 100) / 100;
  }
  return out;
}

/**
 * @param {any} e @param {any} t the thing (engine.thing result) @internal
 */
export function explainThing(e, t) {
  const obj = t.object, T = e._things;
  const over = e.debug.overridesOn(obj);
  const state = obj ? { position: obj.position.toArray().map(v => Math.round(v * 100) / 100), visible: obj.visible, scale: obj.scale.toArray() } : {};
  const saved = { tier: t.saved, keeps: t.keeps, loses: t.loses, ...(t.saved === 'code' && { overridden: T.over.has(t.id), removed: T.removed.has(t.id) }) };
  const out = {
    id: t.id, kind: t.kind, owner: t.owner,
    definition: { at: t.definedAt ?? t.at ?? null, template: t.template ?? null, templateAt: t.templateAt ?? null, ...(t.level && { level: t.level, node: t.node }), ...(t.spawned && { spawned: t.spawned }) },
    model: t.model ?? null,
    materials: materialsOf(obj),
    state,
    rules: rulesOf(e, t, obj),
    ops: opsFor(e, t),
    saved,
    change: {
      runtime: `game state changes through ops: engine.ops.run('<op>', { id: '${t.id}' }); thing.set / thing.remove move, show or remove it (undoable)`,
      permanent: t.edit ?? 'no source known: edit the code or content line that creates it, then reload',
      diagnostic: `engine.debug.override(owner, '${t.id}', { visible, material: 'flat' | 'wire' }) changes the screen only (never saved); engine.debug.clear(owner) removes it`,
    },
    ...(over.length && { overrides: over, warning: 'diagnostic overrides are active on this thing: what is drawn is not its real state' }),
  };
  // Explain contributions (arch #6): a module that owns records or templates adds to the object with e._things.explainers.push((e, t, out) => { ... }),
  // so core never reads their shapes. A throwing explainer is skipped: explain is a diagnostic and must not fail because of one part.
  for (const f of T.explainers) orNull(() => f(e, t, out));
  return out;
}
