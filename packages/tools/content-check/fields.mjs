// Part of content validation (called by content-check.mjs): every entry against its field table (the engine's modules/content/fields.js);
// views.mjs does the same for content/views.js.
// Why here and not per file: the tables are the ones engine.content.fields() returns to an editor panel, so a value the panel would offer and a
// value the check accepts are the same by construction. Reports unknown keys (with the closest name), wrong types, out of range, not in values,
// and a `default` written inside a template's / kind's fields (defaults stay in state / the data).
import { pathToFileURL } from 'node:url';
import { abs, CONTENT_FIELDS_REL, CONTENT_STAGES_REL } from '../paths.mjs';

const { placementShape, fieldsShape, entryProblems } = await import(pathToFileURL(abs(CONTENT_FIELDS_REL)).href);
// stages add the `stage` state field (0..n-1) exactly as the engine does, so { template: 'crop', stage: 9 } fails here too
const { stagedFields } = await import(pathToFileURL(abs(CONTENT_STAGES_REL)).href);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
// position keys are checked by checkPos in content-check.mjs (with the place list); leave them out here so one mistake is one message
const POS = ['place', 'x', 'z', 'y', 'floor'];
const noPos = p => Object.fromEntries(Object.entries(p).filter(([k]) => !POS.includes(k)));

/** ctx: { c, err } */
export function checkFields({ c, err }) {
  // templates: their fields tables first, so placements below are checked against the parsed state fields
  const tShapes = {};
  for (const [name, t] of Object.entries(c.templates || {})) {
    if (!isObj(t)) continue;
    const staged = stagedFields(t);
    const { shape, problems } = fieldsShape(`template ${name}`, staged.fields, isObj(staged.state) ? staged.state : {});
    for (const m of problems) err('templates', m);
    tShapes[name] = shape;
  }
  const report = (kind, list) => { for (const m of list) err(kind, m); };
  if (Array.isArray(c.props)) c.props.forEach((p, i) => {
    if (!isObj(p)) return;
    const where = `prop #${i + 1}`;
    if (p.grid) report('props', entryProblems(`${where} (grid item)`, p, placementShape('props.grid'), { required: true }));
    else if (p.template) { if (tShapes[p.template]) report('props', entryProblems(`${where} (template ${p.template})`, noPos(p), placementShape('props.template'), { also: tShapes[p.template] })); }
    else report('props', entryProblems(where, noPos(p), placementShape('props')));
  });
  if (Array.isArray(c.pickups)) c.pickups.forEach((p, i) => report('pickups', entryProblems(`pickup #${i + 1}`, isObj(p) ? noPos(p) : p, placementShape('pickups'))));
  // game kinds that declare fields: each entry of content/<name>.js (object id -> entry, or a list)
  for (const [name, k] of Object.entries(c.rules?.kinds || {})) {
    if (k?.fields === undefined) continue;
    const { shape, problems } = fieldsShape(`kind ${name}`, k.fields);
    report('rules', problems);
    const data = c[name];
    if (!data || typeof data !== 'object') continue;
    const entries = Array.isArray(data) ? data.map((d, i) => [`#${i + 1}`, d]) : Object.entries(data);
    for (const [id, d] of entries) report(name, entryProblems(`${name} ${id}`, d, shape, { required: true }));
  }
}
