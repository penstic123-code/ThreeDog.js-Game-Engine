// Default 'prompt' UI part: the "E · Talk" label that follows the nearest interaction. Interactions picks the target and projects it to the screen;
// this only draws { x, y, text } and turns a click into view.use() (the op interaction.use). Look: CSS class .threedog-prompt (style pack style.ui.css).
import { injectUICSS, placeAt } from '../../ui/UI.js';
/** @import { Engine, UIPart } from '../../types/core' */
/** @import { PromptView } from '../../types/gameplay' */

/**
 * @param {Engine} engine
 * @returns {UIPart}
 * @internal
 */
export function promptPart(engine) {
  injectUICSS();
  let el = null;
  /** @type {PromptView | null} */ let cur = null;
  return {
    /** @param {PromptView} d */
    update(d) {
      if (!el) { el = document.createElement('div'); el.className = 'threedog-prompt'; el.addEventListener('click', () => cur?.use()); engine.uiRoot.appendChild(el); }
      cur = d;
      el.hidden = false;
      if (el.textContent !== d.text) el.textContent = d.text;
      placeAt(el, d.x, d.y);
    },
    hide() { if (el) el.hidden = true; cur = null; },
    dispose() { el?.remove(); el = null; },
  };
}
