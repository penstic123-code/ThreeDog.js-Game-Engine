// i18n: engine and modules hardcode no UI text; they fetch it with engine.t('key', { params }).
// Modules register their default text (zh-CN, en) on install; a game may override it or add languages.
//
// createEngine({ locale: 'en', strings: { en: { 'inventory.title': 'Bag' } } })
// engine.i18n.setLocale('zh-CN')
// engine.t('inventory.got', { name: '胶卷', n: 3 })   // "获得 胶卷 ×3"
//
// {name} in a string is replaced by the param; {key:interact} becomes the currently bound key label.

/** @import { StringTables } from '../types/core' */
import { warnMissing } from './validate.js';

const CORE = {
  'zh-CN': {
    'common.close': '关闭', 'common.loading': '加载中', 'common.loadingAssets': '加载资源', 'common.preparing': '准备 {name}',
    'common.generating': '生成 {name}', 'common.world': '世界',
    'loading.queued': '等待 {name}', 'loading.download': '下载 {name}', 'loading.decode': '解码 {name}', 'loading.upload': '上传 {name}', 'loading.build': '生成 {name}', 'loading.failed': '加载失败：{name}', 'common.on': '开', 'common.off': '关',
    'input.moveForward': '前进', 'input.moveBack': '后退', 'input.moveLeft': '向左', 'input.moveRight': '向右',
    'input.run': '奔跑', 'input.interact': '交互', 'input.confirm': '确认', 'input.cancel': '返回',
    'key.Space': '空格', 'key.Mouse0': '鼠标左键', 'key.Mouse1': '鼠标中键', 'key.Mouse2': '鼠标右键', 'key.Enter': '回车', 'ground.default': '默认',
    'module.world': '世界数据', 'module.terrain': '地形', 'module.vegetation': '植被', 'module.sky': '天空', 'module.weather': '天气', 'module.water': '水面', 'module.collision': '碰撞', 'module.rigid': '物理引擎', 'module.cameraRig': '相机', 'module.characters': '角色', 'module.interactions': '交互', 'module.dialogue': '对话', 'module.inventory': '背包', 'module.quests': '任务', 'module.photo': '拍照', 'module.ambience': '环境音', 'module.debugPanel': '调试面板', 'module.level': '关卡', 'module.triggers': '触发区', 'module.entities': '实体', 'module.particles': '粒子', 'module.settings': '设置', 'module.music': '音乐', 'module.timeline': '时间轴', 'module.nav': '导航网格', 'module.hlod': '远景合并', 'module.lightPool': '光源池', 'module.content': '内容', 'module.flow': '游戏流程', 'module.hud': '目标指示', 'module.net': '联机', 'module.grids': '网格摆放',
  },
  en: {
    'common.close': 'Close', 'common.loading': 'Loading', 'common.loadingAssets': 'Loading assets', 'common.preparing': 'Preparing {name}',
    'common.generating': 'Generating {name}', 'common.world': 'world',
    'loading.queued': 'Waiting for {name}', 'loading.download': 'Downloading {name}', 'loading.decode': 'Decoding {name}', 'loading.upload': 'Uploading {name}', 'loading.build': 'Building {name}', 'loading.failed': 'Failed to load: {name}', 'common.on': 'On', 'common.off': 'Off',
    'input.moveForward': 'Forward', 'input.moveBack': 'Back', 'input.moveLeft': 'Left', 'input.moveRight': 'Right',
    'input.run': 'Run', 'input.interact': 'Interact', 'input.confirm': 'Confirm', 'input.cancel': 'Back',
    'key.Space': 'Space', 'key.Mouse0': 'Left click', 'key.Mouse1': 'Middle click', 'key.Mouse2': 'Right click', 'key.Enter': 'Enter', 'ground.default': 'default',
    'module.world': 'world data', 'module.terrain': 'terrain', 'module.vegetation': 'vegetation', 'module.sky': 'sky', 'module.weather': 'weather', 'module.water': 'water', 'module.collision': 'collision', 'module.rigid': 'physics', 'module.cameraRig': 'camera', 'module.characters': 'characters', 'module.interactions': 'interactions', 'module.dialogue': 'dialogue', 'module.inventory': 'inventory', 'module.quests': 'quests', 'module.photo': 'photo', 'module.ambience': 'ambience', 'module.debugPanel': 'debug panel', 'module.level': 'level', 'module.triggers': 'triggers', 'module.entities': 'entities', 'module.particles': 'particles', 'module.settings': 'settings', 'module.music': 'music', 'module.timeline': 'timeline', 'module.nav': 'navmesh', 'module.hlod': 'distant merge', 'module.lightPool': 'light pool', 'module.content': 'content', 'module.flow': 'game flow', 'module.hud': 'objective markers', 'module.net': 'multiplayer', 'module.grids': 'grid placement',
  },
};

/** Resolve 'auto' from the browser: a language starting with zh gives 'zh-CN', anything else 'en'; other values pass through */
function resolveLocale(l) {
  if (l !== 'auto') return l;
  return /^zh/i.test(globalThis.navigator?.language ?? '') ? 'zh-CN' : 'en';
}

/** engine.i18n: string tables; t(key, params) fetches text and replaces {name} with params */
export class I18n {
  /** @internal */
  constructor(engine, { locale = 'auto', fallback = 'en', strings = {} } = {}) {
    /** @internal */ this.engine = engine;
    /** Current language, e.g. 'zh-CN' */
    this.locale = resolveLocale(locale);
    /** Language used when a key is missing in the current one (default 'en') */
    this.fallback = fallback;
    /** @internal keys already reported missing (t() may run every frame) */ this._missing = new Set();
    /** @internal @type {StringTables} */ this.tables = {};
    this.add(CORE);
    /** @internal Game-given text wins @type {StringTables} */ this.overrides = strings;
  }
  /**
   * Register string tables (never overrides text the game gave)
   * @param {StringTables} tables
   * @returns {this}
   * @example engine.i18n.add({ 'zh-CN': { 'shop.buy': '购买 {name}' }, en: { 'shop.buy': 'Buy {name}' } });
   */
  add(tables) { for (const lang in tables) this.tables[lang] = { ...this.tables[lang], ...tables[lang] }; return this; }
  /** Switch language ('auto' picks from the browser like createEngine) @param {string} l */
  setLocale(l) { this.locale = resolveLocale(l); this.engine.events.emit('i18n:change', this.locale); }
  /** All available languages @returns {string[]} */
  get languages() { return [...new Set([...Object.keys(this.tables), ...Object.keys(this.overrides)])]; }
  /** Whether the key exists @param {string} key @returns {boolean} */
  has(key) { return this._raw(key) != null; }
  /** @internal */
  _raw(key) {
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
