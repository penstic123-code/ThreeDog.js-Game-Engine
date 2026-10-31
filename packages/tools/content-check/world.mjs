// Part of content validation (called by content-check.mjs): containers, vegetation, templates, props. ctx holds the helper functions of the main file.

/** ctx: { c, items, err, checkModel, checkPos, isObj, known } */
export function checkWorldData({ c, items, err, checkModel, checkPos, isObj, known }) {
  // Containers: the items in the initial cargo must exist, counts must be positive
  for (const [id, d] of Object.entries(c.containers || {})) {
    const where = `container ${id}`;
    if (d?.capacity !== undefined && !(d.capacity > 0)) err('containers', `capacity of ${where} must be positive (number of slots)`);
    for (const [item, n] of Object.entries(d?.items || {})) {
      if (!items[item]) err('containers', `initial cargo ${item} of ${where} does not exist (existing items: ${known(items)})`);
      else if (!(n > 0)) err('containers', `the count of initial cargo ${item} of ${where} must be positive`);
    }
    if (d?.items && Object.keys(d.items).length > (d.capacity ?? 24)) err('containers', `${where} has more kinds of initial cargo than capacity, they do not fit`);
  }
  // 9. Vegetation
  const veg = c.vegetation || {};
  if (Object.keys(veg).length) {
    for (const [name, v] of Object.entries(veg)) {
      for (const k of ['model', 'lod']) { const m = [v?.[k]].flat()[0]; if (m !== undefined) checkModel('vegetation', `${k} of vegetation ${name}`, m); }
      if (!v?.model) err('vegetation', `vegetation ${name} has no model (the model name)`);
      if (!isObj(v?.rule)) err('vegetation', `vegetation ${name} has no rule (the growth rule)`);
      else if (Object.values(v.rule).some(x => typeof x === 'function')) err('vegetation', `rule of vegetation ${name} cannot contain functions`);
    }
  }

  // 10. Templates (shared definitions placed from props.js)
  const templates = c.templates || {};
  for (const [name, t] of Object.entries(templates)) {
    const m = [t?.model].flat()[0];
    if (!m) err('templates', `template ${name} has no model (the model name)`);
    else checkModel('templates', `template ${name}`, m);
    if (t?.collide !== undefined && ![false, 'box', 'circle'].includes(t.collide)) err('templates', `collide of template ${name} can only be 'box', 'circle' or false`);
    if (t?.interact && typeof t.interact.op !== 'string') err('templates', `interact of template ${name} needs op (the op name run with { id } when used)`);
  }

  // 11. Props
  const props = c.props || [];
  if (props.length) {
    if (!Array.isArray(props)) err('props', 'props.js must export a list [{ model, place, x, z }, …]');
    else props.forEach((p, i) => {
      const where = `prop #${i + 1}`, m = [p?.model].flat()[0];
      if (p?.template) { if (!templates[p.template]) err('props', `${where} uses template ${p.template}, which templates.js does not define (existing: ${known(templates)})`); }
      else if (!m) err('props', `${where} has no model (the model name), or a template`);
      else checkModel('props', where, m);
      if (p?.collide !== undefined && ![false, 'box', 'circle'].includes(p.collide)) err('props', `collide of ${where} can only be 'box', 'circle' or false`);
      checkPos('props', where, p);
    });
  }
}
