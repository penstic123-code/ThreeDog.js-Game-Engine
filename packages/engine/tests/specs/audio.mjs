// Audio system (recipes/31-audio.md): buses are real GainNodes, sounds by name (variants never repeat back to back, cooldown, voice limit,
// 3D following an object), the ambience rule table, music rules + stems, ducking that stacks and restores, a settings slider per bus.
// Guards (cannot be bypassed): a built-in synth the game did not name stays silent; an unknown bus or condition says the fix.
const READY = { timeout: 60000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const specs = [
  {
    name: 'Audio: buses, variants / cooldown / voices, 3D, ambience rule table, music rules and stems, ducking, settings sliders',
    url: '/tests/audio/index.html',
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.engine?.ready, null, READY);
      await page.mouse.click(400, 300);   // browsers unlock audio on the first click
      check('audio unlocks on the first click', await ev(() => __t.until(() => engine.audio.running, 5000).then(() => true, () => false)));

      const b = await ev(() => {
        const a = engine.audio, o = { buses: Object.keys(a.buses).sort().join(','), voice: a.buses.voice.gain.value };
        a.setVolume('voice', 0.4); o.set = a.buses.voice.gain.value;
        a.setVolume('master', 0.7); o.master = a.master.gain.value;
        try { a.setVolume('nope', 1); } catch (err) { o.err = err.message; }
        a.addBus('radio', 0.6); o.added = a.buses.radio?.gain.value;
        return o;
      });
      check('buses are GainNodes: music sfx ambience ui + the game\'s voice bus', b.buses === 'ambience,music,sfx,ui,voice' && Math.abs(b.voice - 0.9) < 1e-6, b.buses);
      check('setVolume sets the bus / master gain', Math.abs(b.set - 0.4) < 1e-6 && Math.abs(b.master - 0.7) < 1e-6, JSON.stringify(b));
      check('[guard] an unknown bus throws and names the fix (addBus)', /addBus/.test(b.err || ''), b.err);
      check('addBus makes a live bus at once', Math.abs(b.added - 0.6) < 1e-6, b.added);

      const s = await ev(async () => {
        const a = engine.audio, seen = [], load = a.load;
        a.load = url => { seen.push(url); return load.call(a, url); };
        for (let i = 0; i < 20; i++) a.sfx('hit');
        a.load = load;
        const o = { seen, repeats: seen.filter((u, i) => i && u === seen[i - 1]).length, kinds: new Set(seen).size };
        o.first = !!a.sfx('slow'); o.second = a.sfx('slow') === null;
        for (let i = 0; i < 3; i++) a.sfx('buzz');
        o.buzz = a.info.voices.buzz;
        o.builtin = a.sfx('wind') === null;   // ambience() registers wind as a built-in synth; this game never named it
        const obj = new window.THREE.Object3D(); obj.position.set(5, 0, 0); engine.add(obj);
        const h = a.sfx('ping', { at: obj }); o.panner = !!h?.panner; o.spatial = a._spatial.size;
        obj.position.set(-7, 1, 2);
        await __t.until(() => Math.abs(h.panner.positionX.value + 7) < 0.01, 3000).catch(() => {});
        o.followX = h.panner.positionX.value;
        h.stop(0);
        await __t.until(() => a._spatial.size === 0, 3000).catch(() => {});
        o.spatialAfter = a._spatial.size;
        return o;
      });
      check('variants: 20 plays, never the same file twice in a row, all 3 used', s.seen.length === 20 && s.repeats === 0 && s.kinds === 3, s.seen.map(u => u.slice(-4)).join(' '));
      check('cooldown: a second play inside it returns null', s.first && s.second, JSON.stringify(s));
      check('voices: 2 at most, the oldest stops for a new one', s.buzz === 2, s.buzz);
      check('[guard] a built-in synth the game did not name stays silent (sfx returns null)', s.builtin);
      check('3D: a PannerNode follows the Object3D every frame', s.panner && s.spatial === 1 && Math.abs(s.followX + 7) < 0.01, s.followX);
      check('zero cost: stopped positional voices leave the per-frame set empty', s.spatialAfter === 0, s.spatialAfter);

      const c = await ev(() => {
        const a = engine.audio, o = {};
        o.day = a.matches({ time: 'day' }); o.night = a.matches({ time: 'night' }); o.range = a.matches({ time: ['11:00', '13:00'] });
        o.clear = a.matches({ weather: ['clear', 'cloudy'] }); o.rain = a.matches({ weather: 'rain' });
        o.zone = a.matches({ zone: 'cave' }); o.fn = a.matches(e => e === engine);
        o.unknown = a.matches({ inside: true });
        return o;
      });
      check('conditions: time (sky), weather, zone (triggers), functions', c.day && !c.night && c.range && c.clear && !c.rain && !c.zone && c.fn, JSON.stringify(c));
      check('[guard] an unknown condition key never matches (warns with the fix)', c.unknown === false);

      await ev(() => { engine.audio.state = 'combat'; engine.music.intensity = 1; });
      await sleep(900);
      const on = await ev(() => ({ amb: engine.ambience.info, voices: engine.audio.info.voices, music: engine.music.state }));
      check('ambience rule turns on with its condition (state combat): loop at volume 0.5', on.amb[0].on && on.amb[0].volume === 0.5 && on.voices.hum === 1, JSON.stringify(on.amb));
      check('music rule with an object condition picks fight', on.music.current === 'fight', JSON.stringify(on.music));
      await ev(() => __t.until(() => engine.music.state.stems[0] > 0.9, 5000).catch(() => {}));
      check('stems follow intensity (intensity 1 -> stem full)', await ev(() => engine.music.state.stems[0] > 0.9), JSON.stringify(await ev(() => engine.music.state)));
      await ev(() => { engine.audio.state = null; });
      await sleep(900);
      const off = await ev(() => ({ amb: engine.ambience.info, voices: engine.audio.info.voices, music: engine.music.state.current }));
      check('rule off: the loop fades out and stops (no voice left)', !off.amb[0].on && !off.voices.hum, JSON.stringify(off));
      check('music falls back to the rule without when', off.music === 'calm', off.music);

      const d = await ev(() => {
        const a = engine.audio, o = {};
        const d1 = a.duck({ music: 0.5 }, { fade: 0 }), d2 = a.duck({ music: 0.5, ambience: 0.2 }, { fade: 0 });
        o.both = a.info.ducks;
        d2.remove(0); o.one = a.info.ducks;
        d1.remove(0); o.none = a.info.ducks;
        o.levelUntouched = a.buses.music.gain.value === a.levels.music;
        try { a.duck({ musik: 0.5 }); } catch (err) { o.err = err.message; }
        return o;
      });
      check('ducks stack (0.5 x 0.5 = 0.25) and restore in any order', d.both.music === 0.25 && d.both.ambience === 0.2 && d.one.music === 0.5 && d.one.ambience === 1 && d.none.music === 1, JSON.stringify(d));
      check('ducking never changes the bus level the player set', d.levelUntouched);
      check('[guard] ducking a misspelled bus throws with a suggestion', /music/.test(d.err || ''), d.err);

      const st = await ev(() => {
        const set = engine.settings, o = { keys: ['master', 'music', 'sfx', 'ambience', 'ui', 'voice'].every(b => set.get('vol.' + b) != null) };
        set.set('vol.voice', 0.3); o.voice = engine.audio.buses.voice.gain.value;
        set.open(); const tab = set.win.el.querySelector('[data-tab="audio"]'); tab?.click();
        o.sliders = set.win.el.querySelectorAll('[data-range^="vol."]').length;
        o.label = set.win.el.textContent.includes(engine.t('settings.vol.master'));
        set.close();
        return o;
      });
      check('settings: a slider per bus (master first, the game\'s own too), and it drives the bus', st.keys && Math.abs(st.voice - 0.3) < 1e-6 && st.sliders >= 7 && st.label, JSON.stringify(st));
    },
  },
  {
    name: 'Audio: the open-world example sounds through its rule table (wind loop on, footsteps map to sounds it defines)',
    url: '/?cutscene=skip',
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.engine?.stateApplied, null, READY);
      await page.mouse.click(640, 360);
      await ev(() => __t.until(() => engine.audio.running, 5000).catch(() => {}));
      await ev(() => __t.until(() => engine.audio.info.voices.wind === 1, 5000).catch(() => {}));
      const r = await ev(() => {
        const cfg = engine.audio.config, missing = Object.values(cfg.footsteps).filter(n => !(n in cfg.sounds));
        return { amb: engine.ambience.info.map(i => i.sound).join(','), wind: engine.audio.info.voices.wind, missing };
      });
      check('the five ambience rules are installed and the wind loop plays', r.amb === 'wind,rain,water,birds,crickets' && r.wind === 1, JSON.stringify(r));
      check('[guard] every footstep sound name is defined in audio.sounds', r.missing.length === 0, r.missing.join(','));
    },
  },
];
