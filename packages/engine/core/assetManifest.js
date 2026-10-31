// engine.assets.manifest(pack) (helper of Assets.js): registers the named models, textures, sounds and fonts of an asset pack. `a` is the Assets instance.
import { fmt, warnOnce, checkOptions } from './validate.js';
import { codedError } from './errorHints.js';

const STRINGS = {
  clash: 'assets.manifest(): "{name}" is already registered as a {was} (manifest "{list}"), and now as a {type}; one name is one asset, ' +
    'so the second would replace the first. Rename one, e.g. {name}_{type}',
  replaced: 'assets.manifest(): {type} "{name}" from manifest "{was}" is replaced by manifest "{list}" (the later one wins). If both packs mean their own asset, rename one; '
    + 'if the override is intended (a mod replacing a model), ignore this',
};
/** Keys of a manifest / asset pack: anything else is a typo (checkOptions says "did you mean") */
const MANIFEST_KEYS = ['name', 'base', 'models', 'textures', 'sounds', 'fonts'];
/** Keys of one fonts entry: the file, the CSS family it registers (default: the asset name), FontFace descriptors, and the usual asset flags */
const FONT_KEYS = ['url', 'family', 'weight', 'style', 'stretch', 'unicodeRange', 'display', 'featureSettings', 'variationSettings', 'critical', 'preload'];

export function registerManifest(a, pack) {
  checkOptions('assets.manifest()', pack, MANIFEST_KEYS);
  const { models = {}, textures = {}, sounds = {}, fonts = {}, base = null } = pack, list = pack.name ?? 'manifest#' + (a._lists = (a._lists || 0) + 1);
  const at = base == null ? null : new URL(String(base).replace(/\/?$/, '/'), location.href);
  const resolve = u => at && typeof u === 'string' && !u.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(u) ? new URL(u, at).href : u;
  const add = (type, map) => {
    for (const [name, v] of Object.entries(map)) {
      const o0 = typeof v === 'string' ? { url: v } : typeof v === 'function' ? { build: v } : v;
      if (type === 'font') checkOptions(`assets.manifest() fonts.${name}`, o0, FONT_KEYS);
      const o = o0.url && at ? { ...o0, url: resolve(o0.url) } : o0;
      const old = a.entries.get(name);
      if (old?.named && old.type !== type) throw codedError('asset-name-clash', fmt(STRINGS.clash, { name, was: old.type, list: old.manifest, type }));
      // same type from another manifest: allowed (a mod overriding a model) but never silent, the two packs may just share a name by accident
      if (old?.named && old.manifest !== list) warnOnce(fmt(STRINGS.replaced, { type, name, was: old.manifest, list }));
      a.entries.set(name, { type, name, url: o.url ?? name, opts: o, promise: null, named: true, manifest: list });
    }
  };
  add('model', models); add('texture', textures); add('sound', sounds); add('font', fonts);
  return a;
}
