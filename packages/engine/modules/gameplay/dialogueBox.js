// Default 'dialogue' UI part: a box at the bottom with the speaker, the typed text, numbered choice buttons (the one under the choice cursor has
// .is-cursor) and a "continue" hint.
// It only draws what Dialogue hands it; a click calls d.advance() / d.choose(i), which run the ops dialogue.advance / dialogue.choose.
// Look: CSS classes .threedog-dlg* (style.ui.css). A whole different box: engine.ui.set('dialogue', yourPart) (recipes/26-ui-parts.md).
import { injectUICSS } from '../../ui/UI.js';
/** @import { Engine, UIPart } from '../../types/core' */
/** @import { DialogueView } from '../../types/gameplay' */

/**
 * @param {Engine} engine
 * @returns {UIPart}
 * @internal
 */
export function dialogueBox(engine) {
  injectUICSS();
  let box = null, name, text, opts, hint, choices = null;
  /** @type {DialogueView | null} */ let cur = null;
  const build = () => {
    box = document.createElement('div'); box.className = 'threedog-ui threedog-dlg';
    name = document.createElement('b'); name.className = 'threedog-dlg-name';
    text = document.createElement('div'); text.className = 'threedog-dlg-text';
    opts = document.createElement('div'); opts.className = 'threedog-dlg-opts';
    hint = document.createElement('span'); hint.className = 'threedog-dlg-hint';
    box.append(name, text, opts, hint);
    box.addEventListener('click', () => cur?.advance());
    engine.uiRoot.appendChild(box);
  };
  return {
    show() { if (!box) build(); box.hidden = false; },
    /** @param {DialogueView} d */
    update(d) {
      cur = d;
      name.textContent = d.speaker;
      text.textContent = d.text;
      if (d.choices !== choices) {   // the choice list is the same array for the whole line: rebuild the buttons only when it changes
        choices = d.choices; opts.innerHTML = '';
        d.choices.forEach((c, i) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'threedog-btn'; b.textContent = c.key ? `${c.key}. ${c.text}` : c.text;
          b.onclick = ev => { ev.stopPropagation(); cur?.choose(i); };
          opts.appendChild(b);
        });
      }
      [...opts.children].forEach((b, i) => b.classList.toggle('is-cursor', i === d.selected));   // the choice cursor (menu keys / gamepad)
      hint.textContent = d.hint; hint.hidden = !d.hint;
    },
    hide() { if (box) box.hidden = true; cur = null; choices = null; },
    dispose() { box?.remove(); box = null; },
  };
}
