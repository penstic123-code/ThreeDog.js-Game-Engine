// [guard] A gamepad, like a key, is the page's and not one engine's: the engine that owns the keyboard (core/input/inputKeyboard.js) reads the pads, the others hear nothing.
// No real pad here: navigator.getGamepads is faked, so what a browser does with a real one (when it first reports a pad) is not covered. Run: threedog test "Pad owner"
const PAGE = '/tests/threads/';
const J = JSON.stringify;

export const specs = [
  {
    name: '[guard] Pad owner: one engine alone reads a pad with no focus at all; of two engines only the owner reads an unbound pad, a seat hears its own pad on either, and what the old owner held is let go',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine } = threedogThreads, out = {};
        const pad = (pressed = true) => ({ connected: true, axes: [0, -1, 0, 0], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed && i === 0 })) });
        const real = navigator.getGamepads;
        let pads = [];
        navigator.getGamepads = () => pads;
        const poll = (...es) => { for (const e of es) e.input.poll(1 / 60); };
        const read = e => ({ a: e.input.keys.has('PadA'), y: e.input.padStick.y, seat: !!e.seated?.padStick.y, seatKey: e.input.keys.has('PadA@1') });
        const press = e => { const c = e.renderer.domElement; document.body.append(c); c.setPointerCapture = () => {}; c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); };

        engine.dispose();   // the page's own engine came first and would own the pads
        // alone: nothing was ever pressed or focused, and the pad works
        const S = mk(createEngine, 'po-solo');
        pads = [pad()]; poll(S);
        out.solo = read(S);
        pads = []; poll(S);
        out.soloGone = read(S);
        S.dispose();

        const A = mk(createEngine, 'po-a'), B = mk(createEngine, 'po-b');
        A.seated = A.input.seat({ pad: 1 }); B.seated = B.input.seat({ pad: 1 });
        pads = [pad(), pad()]; poll(A, B);
        out.first = [read(A), read(B)];
        press(B); poll(A, B);
        out.pressedB = [read(A), read(B)];
        const other = document.body.appendChild(document.createElement('button'));
        other.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); other.remove(); poll(A, B);
        out.outside = [read(A), read(B)];
        B.dispose(); poll(A);
        out.ownerGone = read(A);
        A.dispose();
        navigator.getGamepads = real;
        return out;
      });
      const on = x => x.a && x.y === 1, off = x => !x.a && x.y === 0, seated = x => x.seat && x.seatKey;
      check('one engine, no focus event ever: button and stick arrive', on(r.solo), J(r));
      check('... and let go when the pad leaves', !r.soloGone.a && r.soloGone.y === 0, J(r));
      check('two engines, nothing pressed: the first reads the pad, the second nothing', on(r.first[0]) && off(r.first[1]), J(r));
      check('a seat hears its bound pad whoever owns the input', [...r.first, ...r.pressedB].every(seated), J(r));
      check('pressing the second moves the pad there, and the first lets go at once', off(r.pressedB[0]) && on(r.pressedB[1]), J(r));
      check('a press elsewhere on the page moves nothing', off(r.outside[0]) && on(r.outside[1]), J(r));
      check('the owner gone, the other engine reads the pad again', on(r.ownerGone), J(r));
    },
  },
];
