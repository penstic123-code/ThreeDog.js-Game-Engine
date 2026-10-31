// The mouse / touch pointer part of input: drag to look, wheel to zoom, pointer state; mouse buttons act as keys (Mouse0 left / Mouse1 middle / Mouse2 right) passed to Input's _keyDown / _keyUp,
// the same path as the keyboard, so they can be defined as actions and enter the fixed-step snapshot. Touch taps are not mouse buttons (pointerType only accepts 'mouse').

/** Wire pointer events on the canvas to input (called once when Input is constructed). signal: engine.dispose() cancels all listeners at once */
export function bindPointer(input, canvas, signal) {
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    input.pointer.down = true; input.pointer.button = e.button;
    if (e.pointerType === 'mouse') input._keyDown('Mouse' + e.button, 'keyboard');
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 }; canvas.focus();
    // While the mouse is locked (first person) Chromium rejects pointer capture with InvalidStateError; capture is only needed for drag-to-look anyway
    if (document.pointerLockElement !== canvas) canvas.setPointerCapture(e.pointerId);
  }, { signal });
  canvas.addEventListener('pointermove', e => {
    const p = input.pointer;
    p.x = e.clientX; p.y = e.clientY;
    p.ndcX = e.clientX / innerWidth * 2 - 1; p.ndcY = -(e.clientY / innerHeight) * 2 + 1;
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (document.pointerLockElement === canvas) return;
    input.look.dx += dx; input.look.dy += dy; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
  }, { signal });
  // When the mouse is locked (first person), use relative movement
  addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) { input.look.dx += e.movementX; input.look.dy += e.movementY; } }, { signal });
  const end = e => {
    if (drag && drag.moved < 6) input.pointer.clicked = true;
    drag = null; input.pointer.down = false;
    if (e.pointerType === 'mouse') input._keyUp('Mouse' + e.button);
  };
  canvas.addEventListener('pointerup', end, { signal }); canvas.addEventListener('pointercancel', end, { signal });
  // if the right button is bound to an action, do not show the browser menu
  canvas.addEventListener('contextmenu', e => { if ([...input.actions.values()].some(a => a.keys.includes('Mouse2'))) e.preventDefault(); }, { signal });
  canvas.addEventListener('wheel', e => { e.preventDefault(); input.look.zoom += Math.sign(e.deltaY); }, { passive: false, signal });
}
