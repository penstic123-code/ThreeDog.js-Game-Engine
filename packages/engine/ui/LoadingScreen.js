// Default 'loading' UI part. Covers the view at start, shows progress, fades out when ready. start() drives it (show -> update... -> hide).
// Replace it with createEngine({ ui: { loading: (engine) => ({ show, update, hide, dispose }) } }), turn it off with { loading: false }.
// Look: CSS classes .threedog-loading* (override in style.ui.css), or the inner HTML with style.ui.templates.loading({ title }).
// text names the item being waited for (engine.loading.text()); when a critical item fails, update gets failed (engine.loading tasks) and the
// screen stays up with class .threedog-loading-failed, so the player sees why instead of a frozen bar.
import { injectUICSS, esc } from './UI.js';
/** @import { Engine, UIPart } from '../types/core' */

/**
 * Default loading screen part. show({ title }) · update({ progress 0-1, text, failed? }) · hide() fades out (returns a promise for the fade).
 * @param {Engine} engine
 * @param {{ title?: string }} [opts]
 * @returns {UIPart}
 * @internal
 */
export function loadingScreen(engine, { title } = {}) {
  injectUICSS();
  let el = null, bar = null, msg = null;
  return {
    show(d = {}) {
      el = document.createElement('div');
      el.className = 'threedog-loading';
      const t = d.title ?? title ?? engine.t('common.loading');
      const tpl = engine.style.ui?.templates?.loading;
      el.innerHTML = tpl ? tpl({ title: t }, { esc }) :
        `<div class="threedog-loading-box"><div class="threedog-loading-title">${esc(t)}</div><div class="threedog-loading-track"><div class="threedog-loading-bar"></div></div><div class="threedog-loading-msg"></div></div>`;
      engine.uiRoot.appendChild(el);
      bar = el.querySelector('.threedog-loading-bar'); msg = el.querySelector('.threedog-loading-msg');
    },
    update({ progress, text, failed }) {
      if (bar) bar.style.width = Math.round(progress * 100) + '%';
      if (msg && text != null) msg.textContent = text;
      el?.classList.toggle('threedog-loading-failed', !!failed?.length);
    },
    hide() {   // resolves when the fade has finished and the element is gone (engine.ui.settled waits for it)
      if (!el) return;
      const x = el; el = null; x.style.opacity = '0'; x.style.pointerEvents = 'none';
      return new Promise(res => setTimeout(() => { x.remove(); res(); }, 700));   // wall-clock: CSS fade length
    },
    dispose() { el?.remove(); el = null; },
  };
}
