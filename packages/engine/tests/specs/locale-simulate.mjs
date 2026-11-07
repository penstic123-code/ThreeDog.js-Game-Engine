// [guard] Two silent no-ops a demo hit (2026-11-02 findings 6 and 11):
//   1. createEngine({ locale: 'zh' }) showed English everywhere: the tables are keyed 'zh-CN', and an unmatched locale fell back to 'en' without a word.
//      Guard: locale is matched by language ('zh' -> 'zh-CN'), so the pickup prompt, NPC talk prompt and weather name built by the modules are Chinese;
//      a language with no strings at all warns once.
//   2. input.simulate('forward') (the action is moveForward) only warned, so a driver script "pressed" a key and nothing moved.
//      Guard: an unknown action throws unknown-name naming moveForward; simulate('moveForward') walks the player like a held key.
//   3. A cheap static scan (node side): engine code puts no literal English words where the player reads them (textContent / innerText / placeholder /
//      title = '...', toast('...') / makeWindow('...'), >Word< inside an HTML template); player text goes through e.t('key').
import { readFileSync, readdirSync } from 'node:fs';

const ENGINE = new URL('../../', import.meta.url);
const SINKS = [
  /\.(textContent|innerText|placeholder|title)\s*=\s*['"`][^'"`$]*[A-Za-z]{2}/,
  /\b(toast|makeWindow|setTitle|setLabel)\(\s*['"`][^'"`$]*[A-Za-z]{2}/,
  /<[a-z][\w-]*(\s[^<>]*)?>\s*[A-Za-z]{2,}[A-Za-z ,.!?']*<\//,   // <button ...>Close</button> in an HTML template
];
/** Lines in core / modules / ui / render (debug overlays excluded: developer-facing) that show a literal English word to the player */
function literalUiText() {
  const hits = [];
  for (const dir of ['core', 'modules', 'ui', 'render']) {
    for (const f of readdirSync(new URL(dir + '/', ENGINE), { recursive: true })) {
      const file = String(f).replace(/\\/g, '/');
      if (!file.endsWith('.js') || /debug|\.contract\./i.test(file)) continue;
      readFileSync(new URL(`${dir}/${file}`, ENGINE), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (SINKS.some(re => re.test(line))) hits.push(`${dir}/${file}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
  }
  return hits;
}

export const specs = [
  {
    name: "[guard] locale 'zh' boots in Chinese: pickup prompt, NPC talk prompt and weather name; a language with no strings warns once",
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all;
        // the key is part of the setup: this test presses nothing, but the prompts it reads name the key
        const E = mk(T.createEngine, 'locale-zh', { locale: 'zh', bindings: { ...T.presets.bindings.interact } });
        E.use(T.world(), T.sky(), T.weather(), T.interactions({ ...T.presets.interactions.nearest }), T.pickups(), T.characters());
        await E.start();
        E.ops.allow(() => {
          E.pickups.spawn([1, 0, 0], { id: 'lz-yarn', name: '毛线包裹', give: () => 1 });
          E.npcs.add({ id: 'lz-npc', name: '老渔夫', position: { x: 0, z: 1 }, interact: { op: 'npc.talk' }, schedule: [] });
        });
        E.step(0.3, { render: false });
        // the labels the prompt shows, read the way interactions does (a function gets (object, { actor }))
        const label = id => { const it = E.interactions.get(id); return it && (typeof it.label === 'function' ? it.label(it.object, { actor: E.actor }) : it.label); };
        const out = { locale: E.i18n.locale, pickup: label('lz-yarn'), npc: label('lz-npc'), weather: E.weather.label('rain') };
        E.dispose();
        const warns = [], w0 = console.warn;
        console.warn = (...a) => { warns.push(a.join(' ')); };
        try {
          const F = mk(T.createEngine, 'locale-xx', { locale: 'xx-YY' });
          F.t('common.close'); F.t('common.loading');
          out.xx = { locale: F.i18n.locale, text: F.t('common.close'), warns: warns.filter(x => x.includes("'xx-YY'")).length, code: warns.some(x => x.includes('[unknown-name]')) };
          F.dispose();
        } finally { console.warn = w0; }
        return out;
      });
      check("locale 'zh' resolves to the zh-CN table", r.locale === 'zh-CN', JSON.stringify(r));
      check('pickup prompt, NPC talk prompt and weather name are Chinese', r.pickup === '捡起 毛线包裹' && r.npc === '和老渔夫说话' && r.weather === '雨', JSON.stringify(r));
      const lit = literalUiText();
      check('no literal English UI text in engine code (show text with e.t(key))', lit.length === 0, lit.join('\n'));
      check('a language with no strings: English fallback and exactly one coded warning', r.xx.locale === 'xx-YY' && r.xx.text === 'Close' && r.xx.warns === 1 && r.xx.code, JSON.stringify(r.xx));
    },
  },
  {
    name: '[guard] input.simulate: an unknown action name throws unknown-name with the closest action; moveForward walks the player like a held key',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        const p = engine.player, inp = engine.input, out = {};
        try { inp.simulate('forward', true); } catch (err) { out.code = err.code; out.msg = String(err.message); }
        engine.step(10 / 60, { render: false });
        const a = { x: p.position.x, z: p.position.z };
        inp.simulate('moveForward', true); engine.step(1, { render: false }); inp.simulate('moveForward', false);
        out.moved = Math.hypot(p.position.x - a.x, p.position.z - a.z);
        return out;
      });
      check("simulate('forward') throws unknown-name suggesting moveForward", r.code === 'unknown-name' && /moveForward/.test(r.msg), JSON.stringify(r));
      check("simulate('moveForward') + step(1) moves the player", r.moved > 1, JSON.stringify(r));
    },
  },
  {
    name: '[guard] i18n: setLocale is the one way to change the language: locale is read-only, so no name skips the table lookup or i18n:change',
    url: '/?threedog-headless',
    async run({ check, ev }) {
      const r = await ev(() => {
        const I = engine.i18n, was = I.locale, told = [];
        const h = engine.events.on('i18n:change', l => told.push(l));
        let wrote = null;
        try { (function () { 'use strict'; I.locale = 'zh'; })(); } catch (err) { wrote = err.name; }   // strict as a game's modules are; this page function is not
        const afterWrite = I.locale, quiet = told.length;
        I.setLocale('zh');
        const zh = { locale: I.locale, told: [...told], text: engine.t('common.close') };
        I.setLocale(was); h.remove();
        return { was, wrote, afterWrite, quiet, zh };
      });
      check(`writing locale is refused (${r.wrote})`, r.wrote === 'TypeError');
      check('the language did not change behind the listeners', r.afterWrite === r.was && r.quiet === 0, JSON.stringify(r));
      check('setLocale resolves the name, tells the listeners, and the text follows', r.zh.locale === 'zh-CN' && r.zh.told[0] === 'zh-CN' && r.zh.text === '关闭', JSON.stringify(r.zh));
    },
  },
];
