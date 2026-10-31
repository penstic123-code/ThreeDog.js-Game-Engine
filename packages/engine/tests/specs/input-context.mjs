// Input contexts: menu shadows gameplay, no stuck hold after closing, vehicle context shadows same-key actions, blur / tab hide releases all keys.
export const specs = [
  {
    name: '输入情境：菜单遮蔽攻击、关菜单后不留按住、载具情境遮蔽同键动作、失焦与切标签页清空按住',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.timeline.skip(); engine.step(1, { render: false }); await new Promise(r => setTimeout(r, 50)); engine.step(1, { render: false });   // the sample starts with an intro cutscene (it holds an opaque context)
        const I = engine.input, o = {};
        // one fixed step's view, taken the way the engine does at the start of each step
        const fx = names => { I.beginFixed(); const v = names.map(n => [I.pressed(n), I.down(n)]); I.endFixed(); return v; };
        I.define('tAtk', 'KeyU', 'Attack');
        I.define('tOk', 'KeyU', 'Ok', { context: 'tmenu' });
        I.define('tUse', 'KeyF', 'Use'); I.define('tExit', 'KeyF', 'Exit', { context: 'tcar' }); I.define('tWalk', 'KeyG', 'Walk');

        I._keyDown('KeyU', 'keyboard');
        o.base = fx(['tAtk', 'tOk']);                       // attack pressed; menu action not on the stack
        const h = I.push('tmenu');
        o.pendingEnabled = I.enabled;                        // not applied before the next fixed step
        fx([]);
        o.menu = { enabled: I.enabled, ctx: I.contexts.join(), held: I.keys.has('KeyU') };
        I._keyUp('KeyU'); fx([]); I._keyDown('KeyU', 'keyboard');
        o.inMenu = fx(['tAtk', 'tOk']);                      // confirm-style key does not attack; the menu action sees it
        I._keyUp('KeyU'); fx([]);
        // hold in gameplay, open menu, close menu: nothing left held, auto-repeat does not revive it
        h.remove(); fx([]); I._keyDown('KeyU', 'keyboard'); fx(['tAtk']);
        const h2 = I.push('tmenu'); fx([]);
        h2.remove(); const after = fx(['tAtk']);
        I._keyDown('KeyU', 'keyboard');                      // keyboard auto-repeat while still physically held
        o.afterClose = { after, repeat: fx(['tAtk']) };
        I._keyUp('KeyU'); fx([]); I._keyDown('KeyU', 'keyboard');
        o.repress = fx(['tAtk']);
        I._keyUp('KeyU'); fx([]);
        // vehicle: pass context; same key F switches meaning, unrelated G keeps working
        const car = I.push('tcar', { pass: true }); fx([]);
        I._keyDown('KeyF', 'keyboard'); I._keyDown('KeyG', 'keyboard');
        o.car = { enabled: I.enabled, v: fx(['tUse', 'tExit', 'tWalk']) };
        car.remove(); car.remove(); I._keyUp('KeyF'); I._keyUp('KeyG'); fx([]);
        o.carOut = { ctx: I.contexts.join() };
        // blur / tab hidden release everything
        I._keyDown('KeyU', 'keyboard'); I._keyDown('KeyG', 'keyboard');
        dispatchEvent(new Event('blur'));
        o.blur = I.keys.size;
        dispatchEvent(new Event('focus'));                   // back, then hide the tab (core/page.js emits page:blur, Input releases)
        I._keyDown('KeyU', 'keyboard');
        Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
        o.hidden = I.keys.size;
        document.dispatchEvent(new Event('visibilitychange'));
        return o;
      });
      const J = JSON.stringify(r);
      check('menu pushes apply at the next fixed step', r.pendingEnabled === true && r.menu.enabled === false && r.menu.ctx === 'gameplay,tmenu', J);
      check('gameplay attack is pressed, menu action unreadable before the menu', r.base[0][0] && r.base[0][1] && !r.base[1][0], J);
      check('with the menu open the same key does not attack but triggers the menu action', !r.inMenu[0][0] && !r.inMenu[0][1] && r.inMenu[1][0], J);
      check('closing the menu leaves no held key (and auto-repeat does not bring it back)', !r.afterClose.after[0][1] && !r.afterClose.repeat[0][1], J);
      check('a fresh press after the menu works again', r.repress[0][0] && r.repress[0][1], J);
      check('vehicle context: F means exit, walk-F is shadowed, G still works, enabled stays true', r.car.enabled && !r.car.v[0][0] && r.car.v[1][0] && r.car.v[2][1], J);
      check('remove() twice is harmless and pops the context', r.carOut.ctx === 'gameplay', J);
      check('window blur and tab hidden release all held keys', r.blur === 0 && r.hidden === 0, J);
    },
  },
];
