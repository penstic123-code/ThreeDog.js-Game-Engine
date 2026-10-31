// Default HUD UI parts (hud.marker, hud.counter, hud.bar). hud/index.js keeps the logic (targets, projection, edge arrows, quest sync)
// and hands each part plain data; a game replaces any of them with engine.ui.set('hud.counter', ...) or turns it off with false.
// Look: CSS classes .threedog-hud .threedog-hud-stats .threedog-hud-marker .threedog-hud-arrow .threedog-hud-counter .threedog-hud-bar;
//   colors --threedog-hud-bg/fg/accent (style pack style.ui.hudBg...); layout is plain CSS, so style.ui.css moves the stats column, sizes, fonts.
//   Inner HTML: style.ui.templates.hudMarker / hudCounter / hudBar (data, { esc, t }) => HTML.
import { esc, placeAt } from '../../ui/UI.js';
/** @import { Engine, UIPart } from '../../types/core' */

export const CSS = `
.threedog-hud{position:fixed;inset:0;pointer-events:none;z-index:12;font:13px/1.4 var(--threedog-font);color:var(--threedog-hud-fg)}
.threedog-hud-stats{position:absolute;left:calc(12px + env(safe-area-inset-left,0px));top:calc(12px + env(safe-area-inset-top,0px));display:flex;flex-direction:column;gap:6px}
.threedog-hud-counter,.threedog-hud-bar{background:var(--threedog-hud-bg);border-radius:8px;padding:4px 10px;min-width:120px}
.threedog-hud-bar-track{height:6px;border-radius:3px;background:var(--threedog-line);overflow:hidden;margin-top:3px}
.threedog-hud-bar-fill{height:100%;width:calc(var(--threedog-hud-fill,0) * 100%);background:var(--threedog-hud-accent)}
.threedog-hud-marker{position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.6)}
.threedog-hud-marker::after{content:'';width:10px;height:10px;margin-top:2px;border-radius:50%;background:var(--threedog-hud-accent)}
.threedog-hud-marker.threedog-hud-arrow{transform:translate(-50%,-50%)}
.threedog-hud-marker.threedog-hud-arrow::after{width:0;height:0;border-radius:0;border:7px solid transparent;border-left:12px solid var(--threedog-hud-accent);order:-1;transform:rotate(var(--threedog-hud-angle,0rad))}
.threedog-hud-dist{color:var(--threedog-hud-accent);font-size:12px}
`;

/**
 * Declare the default HUD parts. layer / stats are hud's containers (created only when some default part is in use).
 * @param {Engine} e
 * @param {() => { layer: HTMLElement, stats: HTMLElement }} root
 * @returns {void}
 */
export function defineHudParts(e, root) {
  const tools = { esc, t: (k, p) => e.t(k, p) };
  const tpl = name => e.style.ui?.templates?.[name];

  // One marker: update({ x, y, arrow, angle, label, icon, distance }) moves and redraws it; hide() hides it
  e.ui.define('hud.marker', () => {
    const el = document.createElement('div');
    el.className = 'threedog-hud-marker'; el.hidden = true; root().layer.appendChild(el);
    let html = null;
    return {
      el,
      update(d) {
        el.hidden = false;
        el.classList.toggle('threedog-hud-arrow', d.arrow);
        if (d.arrow) el.style.setProperty('--threedog-hud-angle', d.angle.toFixed(3) + 'rad');
        placeAt(el, d.x, d.y);
        const t = tpl('hudMarker');
        const h = t ? t(d, tools) : `${d.icon || d.label ? `<span class="threedog-hud-label">${esc(d.icon)} ${esc(d.label)}</span>` : ''}${d.distance ? `<span class="threedog-hud-dist">${esc(d.distance)}</span>` : ''}`;
        if (h !== html) { html = h; el.innerHTML = h; }   // rebuild only when the text changed (called every frame)
      },
      hide() { el.hidden = true; },
      dispose() { el.remove(); },
    };
  }, { multi: true });

  e.ui.define('hud.counter', () => {
    const el = document.createElement('div'); el.className = 'threedog-hud-counter'; root().stats.appendChild(el);
    return {
      el,
      update(d) {
        const t = tpl('hudCounter');
        if (t) el.innerHTML = t(d, tools);
        else el.textContent = `${d.icon ?? ''} ${d.label ?? d.id} ${d.value ?? 0}${d.max != null ? ' / ' + d.max : ''}`.trim();
      },
      dispose() { el.remove(); },
    };
  }, { multi: true });

  e.ui.define('hud.bar', () => {
    const el = document.createElement('div'); el.className = 'threedog-hud-bar'; root().stats.appendChild(el);
    let label;
    return {
      el,
      update(d) {
        const t = tpl('hudBar');
        if (t) { el.innerHTML = t(d, tools); return; }
        if (label !== d.label) { label = d.label; el.innerHTML = `${d.label ? `<span>${esc(d.label)}</span>` : ''}<div class="threedog-hud-bar-track"><div class="threedog-hud-bar-fill"></div></div>`; }
        el.style.setProperty('--threedog-hud-fill', Math.max(0, Math.min(1, (d.value ?? 0) / (d.max ?? 1))));
      },
      dispose() { el.remove(); },
    };
  }, { multi: true });
}
