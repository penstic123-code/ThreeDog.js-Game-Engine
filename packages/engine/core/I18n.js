// i18n. Engine and modules hardcode no UI text; they fetch it with engine.t('key', { params }).
// Modules register their default text (zh-CN, en) on install; a game may override it or add languages.
//
// createEngine({ locale: 'en', strings: { en: { 'inventory.title': 'Bag' } } })
// engine.i18n.setLocale('zh-CN')
// engine.t('inventory.got', { name: '胶卷', n: 3 })   // "获得 胶卷 ×3"
//
// {name} in a string is replaced by the param; {key:interact} becomes the currently bound key label.

/** @import { StringTables } from '../types/core' */
import { warnMissing, warnOnce, missingText } from './validate.js';
import { coded } from './errorHints.js';

const CORE = {
  'zh-CN': {
    'common.close': '关闭', 'common.loading': '加载中', 'common.loadingAssets': '加载资源', 'common.preparing': '准备 {name}',
    'common.generating': '生成 {name}', 'common.world': '世界',
    'loading.queued': '等待 {name}', 'loading.download': '下载 {name}', 'loading.decode': '解码 {name}', 'loading.upload': '上传 {name}', 'loading.build': '生成 {name}', 'loading.failed': '加载失败：{name}', 'common.on': '开', 'common.off': '关',
    'input.moveForward': '前进', 'input.moveBack': '后退', 'input.moveLeft': '向左', 'input.moveRight': '向右',
    'input.run': '奔跑', 'input.interact': '交互', 'input.confirm': '确认', 'input.cancel': '返回', 'input.uiUp': '菜单上移', 'input.uiDown': '菜单下移', 'input.uiLeft': '菜单左移', 'input.uiRight': '菜单右移',
    'key.Space': '空格', 'key.Mouse0': '鼠标左键', 'key.Mouse1': '鼠标中键', 'key.Mouse2': '鼠标右键', 'key.Enter': '回车', 'ground.default': '默认',
    'module.world': '世界数据', 'module.terrain': '地形', 'module.vegetation': '植被', 'module.sky': '天空', 'module.calendar': '日历', 'module.weather': '天气', 'module.water': '水面', 'module.collision': '碰撞', 'module.rigid': '物理引擎', 'module.cameraRig': '相机', 'module.characters': '角色', 'module.interactions': '交互', 'module.dialogue': '对话', 'module.inventory': '背包', 'module.pickups': '拾取物', 'module.quests': '任务', 'module.photo': '拍照', 'module.ambience': '环境音', 'module.debugPanel': '调试面板', 'module.level': '关卡', 'module.triggers': '触发区', 'module.particles': '粒子', 'module.settings': '设置', 'module.music': '音乐', 'module.timeline': '时间轴', 'module.nav': '导航网格', 'module.hlod': '远景合并', 'module.lightPool': '光源池', 'module.content': '内容', 'module.flow': '游戏流程', 'module.hud': '目标指示', 'module.net': '联机', 'module.grids': '网格摆放',
  },
  en: {
    'common.close': 'Close', 'common.loading': 'Loading', 'common.loadingAssets': 'Loading assets', 'common.preparing': 'Preparing {name}',
    'common.generating': 'Generating {name}', 'common.world': 'world',
    'loading.queued': 'Waiting for {name}', 'loading.download': 'Downloading {name}', 'loading.decode': 'Decoding {name}', 'loading.upload': 'Uploading {name}', 'loading.build': 'Building {name}', 'loading.failed': 'Failed to load: {name}', 'common.on': 'On', 'common.off': 'Off',
    'input.moveForward': 'Forward', 'input.moveBack': 'Back', 'input.moveLeft': 'Left', 'input.moveRight': 'Right',
    'input.run': 'Run', 'input.interact': 'Interact', 'input.confirm': 'Confirm', 'input.cancel': 'Back', 'input.uiUp': 'Menu up', 'input.uiDown': 'Menu down', 'input.uiLeft': 'Menu left', 'input.uiRight': 'Menu right',
    'key.Space': 'Space', 'key.Mouse0': 'Left click', 'key.Mouse1': 'Middle click', 'key.Mouse2': 'Right click', 'key.Enter': 'Enter', 'ground.default': 'default',
    'module.world': 'world data', 'module.terrain': 'terrain', 'module.vegetation': 'vegetation', 'module.sky': 'sky', 'module.calendar': 'calendar', 'module.weather': 'weather', 'module.water': 'water', 'module.collision': 'collision', 'module.rigid': 'physics', 'module.cameraRig': 'camera', 'module.characters': 'characters', 'module.interactions': 'interactions', 'module.dialogue': 'dialogue', 'module.inventory': 'inventory', 'module.pickups': 'pickups', 'module.quests': 'quests', 'module.photo': 'photo', 'module.ambience': 'ambience', 'module.debugPanel': 'debug panel', 'module.level': 'level', 'module.triggers': 'triggers', 'module.particles': 'particles', 'module.settings': 'settings', 'module.music': 'music', 'module.timeline': 'timeline', 'module.nav': 'navmesh', 'module.hlod': 'distant merge', 'module.lightPool': 'light pool', 'module.content': 'content', 'module.flow': 'game flow', 'module.hud': 'objective markers', 'module.net': 'multiplayer', 'module.grids': 'grid placement',
  },
};

/**
 * Resolve a requested language to a table name: 'auto' reads the browser; then an exact table, else one of the same language ('zh', 'zh-Hans',
 * 'ZH-cn' -> 'zh-CN'; 'en-US' -> 'en'). Why: tables are keyed 'zh-CN' / 'en', and a game writing locale 'zh' got silent English fallback.
 * 'auto' with no match gives 'en'; another unmatched value passes through (a game may add that language later) and t() warns once if it has no table.
 */
function resolveLocale(l, languages) {
  const auto = l === 'auto', s = String(auto ? globalThis.navigator?.language ?? 'en' : l), low = s.toLowerCase(), base = low.split(/[-_]/)[0];
  if (languages.includes(s)) return s;
  return languages.find(x => x.toLowerCase() === low) ?? languages.find(x => x.toLowerCase().split(/[-_]/)[0] === base) ?? (auto ? 'en' : s);
}

/** engine.i18n: string tables; t(key, params) fetches text and replaces {name} with params */
export class I18n {
  /** @internal */
  constructor(engine, { locale = 'auto', fallback = 'en', strings = {} } = {}) {
    /** @internal */ this.engine = engine;
    /** Language used when a key is missing in the current one (default 'en') */
    this.fallback = fallback;
    /** @internal the locale already checked for having a table (t() runs every frame: build the warning text at most once per locale) */ this._checked = null;
    /** @internal keys already reported missing (t() may run every frame) */ this._missing = new Set();
    /** @internal @type {StringTables} */ this.tables = {};
    this.add(CORE);
    /** @internal Game-given text wins @type {StringTables} */ this.overrides = strings;
    /** Current language, e.g. 'zh-CN' ('zh' and 'zh-Hans' resolve to it, 'en-US' to 'en') */
    this.locale = resolveLocale(locale, this.languages);
  }
  /**
   * Register string tables (never overrides text the game gave)
   * @param {StringTables} tables
   * @returns {this}
   * @example engine.i18n.add({ 'zh-CN': { 'shop.buy': '购买 {name}' }, en: { 'shop.buy': 'Buy {name}' } });
   */
  add(tables) { for (const lang in tables) this.tables[lang] = { ...this.tables[lang], ...tables[lang] }; return this; }
  /** Switch language ('auto' picks from the browser like createEngine) @param {string} l */
  setLocale(l) { this.locale = resolveLocale(l, this.languages); this.engine.events.emit('i18n:change', this.locale); }
  /** All available languages @returns {string[]} */
  get languages() { return [...new Set([...Object.keys(this.tables), ...Object.keys(this.overrides)])]; }
  /** Whether the key exists @param {string} key @returns {boolean} */
  has(key) { return this._raw(key) != null; }
  /** @internal */
  _raw(key) {
    // A language with no table at all shows the fallback everywhere: say so once instead of looking like a missing-translation bug per key
    const l0 = this.locale;
    if (this._checked !== l0) {
      this._checked = l0;
      if (!this.tables[l0] && !this.overrides[l0]) warnOnce(coded('unknown-name', missingText('locale', l0, this.languages)
        + `; every text falls back to '${this.fallback}'. Add it with createEngine({ strings: { '${l0}': { ... } } }) or engine.i18n.add`));
    }
    for (const l of [this.locale, this.fallback]) {
      const v = this.overrides[l]?.[key] ?? this.tables[l]?.[key];
      if (v != null) return v;
    }
    return null;
  }
  /**
   * Fetch text; params replace {name}, {key:action} shows the key label
   * @param {string} key
   * @param {Record<string, any>} [params]
   * @returns {string}
   * @example engine.i18n.t('shop.buy', { name: '鱼' });
   */
  t(key, params = {}) {
    const raw = this._raw(key);
    if (raw == null) {
      // Looks like a key (a.b form) but has no text: probably misspelled or never registered
      if (/^[\w-]+(\.[\w-]+)+$/.test(key) && !this._missing.has(key) && this._missing.add(key)) warnMissing('text', key, Object.keys({ ...this.tables[this.fallback], ...this.overrides[this.fallback], ...this.tables[this.locale], ...this.overrides[this.locale] }));
      return key;
    }
    return String(raw).replace(/\{(\w+)(?::(\w+))?\}/g, (m, a, b) => {
      if (a === 'key' && b) return this.engine.input.label(b);
      return params[a] ?? m;
    });
  }
}
