// The one place that reads what each content section says it points at (its own `references`), for every tool: impact asks who names an id,
// content-check reports the ids that name nothing. Before this, content-check kept its own copies of the item / NPC existence checks.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { metadata } from 'threedog/metadata';
import { ENGINE } from '../paths.mjs';
import { withDomStub } from './dom-stub.mjs';

export const engineFile = f => join(ENGINE, f.replace(/^packages\/engine\//, ''));

/** Each section's own idea of what it names: [{ section, at, names, id }], read from the module that owns it. A module that will not build outside a page just adds nothing: the callers' own walks still see the data */
export async function sectionRefs(data) {
  const out = [];
  await withDomStub(async () => {
    for (const [name, pack] of Object.entries(data)) {
      const owner = metadata.modules[metadata.sections[name]?.owner];
      if (!owner) continue;
      try {
        const mod = await import(pathToFileURL(engineFile(owner.file)).href);
        const s = [mod[owner.call]()].flat().map(d => d?.content?.[name]).find(Boolean);
        for (const r of s?.references?.(pack) ?? []) out.push({ section: name, at: r.at, names: r.section, id: r.id });
      } catch { /* the callers' walks cover it */ }
    }
  });
  return out;
}
