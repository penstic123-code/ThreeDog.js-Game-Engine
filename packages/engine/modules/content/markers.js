// What the marker / clearMarker effects show: playthrough state, kept in the 'content' save part, so a load shows the save's markers and a new game none of the old
// ones. st.marks holds id -> [position, label]; api.markers holds the hud markers on screen now.
import { refuseSave } from '../../core/base/saveValues.js';

/** content._mark: set (v = position) or clear (v = null) marker id */
export function setMark(e, api, st, id, v, label) {
  api.markers.get(id)?.remove(); api.markers.delete(id); st.marks.delete(id);
  if (!v) return;
  st.marks.set(id, [v, label ?? null]);
  const m = e.hud?.marker(v, { label });
  if (m) api.markers.set(id, m);
}

/** The 'content' save part */
export function marksPart(api, st) {
  return {
    save: () => ({ marks: [...st.marks].map(([id, [v, label]]) => [id, v, label]) }),
    load: d => {
      const marks = d?.marks ?? [];
      if (!Array.isArray(marks) || !marks.every(m => Array.isArray(m) && typeof m[0] === 'string')) refuseSave('content', 'marks', 'must be a list of [id, value, label]', marks);
      for (const id of [...st.marks.keys()]) api._mark(id, null);
      for (const [id, v, label] of marks) api._mark(id, v, label ?? undefined);
    },
  };
}
