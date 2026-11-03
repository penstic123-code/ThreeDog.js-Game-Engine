// Renders the README diagrams as hand-drawn PNGs with rough.js in headless Chromium.
// Usage: npm i --no-save roughjs@4.6.6, then: node docs/brand/diagrams/draw.mjs docs/brand/diagrams <path to node_modules/playwright>
// Fonts: Segoe Print (Latin) and STKaiti (Chinese), as installed on Windows.
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [outDir, pwPath] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(pwPath);
const roughSrc = readFileSync(require.resolve('roughjs/bundled/rough.cjs.js'), 'utf8');
mkdirSync(outDir, { recursive: true });

const C = { ink: '#2d2a26', paper: '#fdfbf5', blue: '#a9cbe8', green: '#b9dfb0', yellow: '#f6dc8c', pink: '#f2b8b0', purple: '#cdb9e6', gray: '#d9d6cf', orange: '#f5c08a' };

// Each diagram: size, boxes { x, y, w, h, title, sub, fill, dashed }, arrows { from:[x,y], to:[x,y], dashed, curve, label }
const T = {
  en: {
    design: { w: 1240, h: 430, boxes: [
      { x: 30, y: 60, w: 260, h: 150, title: 'AI writes three.js', sub: 'meshes · lights\nmaterials · shaders', fill: C.blue },
      { x: 340, y: 60, w: 260, h: 150, title: 'Engine plugs it in', sub: 'scene.add · a light\na pass · plugins/', fill: C.green },
      { x: 650, y: 60, w: 260, h: 150, title: 'Engine coordinates', sub: 'time · saves · input\nweather · look values', fill: C.yellow },
      { x: 960, y: 60, w: 250, h: 150, title: 'AI checks it', sub: 'describe · errors\ntests · screenshots', fill: C.pink },
    ], arrows: [
      { from: [290, 135], to: [340, 135] }, { from: [600, 135], to: [650, 135] }, { from: [910, 135], to: [960, 135] },
      { from: [1085, 210], to: [160, 210], curve: 150, dashed: true, label: 'next change' },
    ] },
    arch: { w: 1240, h: 720, boxes: [
      { x: 60, y: 30, w: 800, h: 100, title: 'Your game', sub: 'rules · content · style · plugins · plain three.js', fill: C.blue },
      { x: 60, y: 165, w: 800, h: 100, title: 'Modules', sub: 'world · look · actor · rules · ui · net · tool', fill: C.green },
      { x: 60, y: 300, w: 800, h: 130, title: 'Core', sub: 'lifecycle · one time source · shared values\ninput by context · character control · saves · actions', fill: C.yellow },
      { x: 60, y: 465, w: 800, h: 100, title: 'Rendering', sub: 'WebGL or WebGPU, chosen at start', fill: C.orange },
      { x: 60, y: 600, w: 800, h: 90, title: 'three.js + Rapier', sub: '', fill: C.gray },
      { x: 930, y: 30, w: 270, h: 200, title: 'Agent tools', sub: 'how · describe\ntest · shot · MCP\ndrive and read the game', fill: C.purple },
    ], arrows: [
      { from: [460, 130], to: [460, 165] }, { from: [460, 265], to: [460, 300] }, { from: [460, 430], to: [460, 465] }, { from: [460, 565], to: [460, 600] },
      { from: [930, 80], to: [860, 80], dashed: true },
    ] },
    module: { w: 1240, h: 470, boxes: [
      { x: 30, y: 40, w: 330, h: 390, title: 'A module', sub: '', fill: C.green, dashed: true },
      { x: 60, y: 110, w: 270, h: 80, title: 'one type', sub: 'world · look · actor · …', fill: C.paper },
      { x: 60, y: 215, w: 270, h: 80, title: 'slots', sub: 'provides · requires', fill: C.paper },
      { x: 60, y: 320, w: 270, h: 80, title: 'install(engine, ctx)', sub: '', fill: C.paper },
      { x: 450, y: 250, w: 330, h: 130, title: 'ctx', sub: 'listeners · shared values\ninput actions · control', fill: C.yellow },
      { x: 880, y: 90, w: 320, h: 120, title: 'Engine', sub: 'core · other modules\nthrough contracts', fill: C.blue },
      { x: 880, y: 290, w: 320, h: 130, title: 'Leaves with it', sub: 'on uninstall, failure\nor dispose', fill: C.pink },
    ], arrows: [
      { from: [330, 360], to: [450, 320] }, { from: [780, 290], to: [880, 160] }, { from: [780, 330], to: [880, 350] },
    ] },
    layers: { w: 1240, h: 520, steps: [
      ['engine', 'default', C.gray], ['style', "the game's look", C.blue], ['game', "the game's value", C.green],
      ['effect', 'weather · sunset\nslow motion: × or +', C.yellow], ['system', 'menus · cutscenes', C.orange],
      ['settings', 'the player\nonly lowers or turns off', C.pink], ['debug', '', C.purple] ],
      foot: 'lowest  →  highest' },
    look: { w: 1240, h: 520, boxes: [
      { x: 30, y: 40, w: 260, h: 110, title: 'Style pack', sub: 'starting values\n+ look plugins', fill: C.purple },
      { x: 30, y: 200, w: 260, h: 110, title: 'plugins/ folder', sub: "the game's own", fill: C.blue },
      { x: 30, y: 360, w: 260, h: 110, title: 'Game code', sub: 'look.*.set · add\nreplace · patch', fill: C.green },
      { x: 400, y: 190, w: 290, h: 130, title: 'Look parts', sub: 'sky · fog · light · materials\nwater · ground · post', fill: C.yellow },
      { x: 790, y: 60, w: 270, h: 130, title: 'Post chain', sub: 'scene → HDR → tone\n→ LDR → final', fill: C.orange },
      { x: 790, y: 330, w: 270, h: 130, title: 'Materials', sub: 'engine-made and\nplain three.js', fill: C.pink },
      { x: 1100, y: 200, w: 120, h: 110, title: 'WebGL\nWebGPU', sub: '', fill: C.gray },
    ], arrows: [
      { from: [290, 95], to: [400, 230] }, { from: [290, 255], to: [400, 255] }, { from: [290, 415], to: [400, 285] },
      { from: [690, 230], to: [790, 125] }, { from: [690, 285], to: [790, 395] },
      { from: [1060, 125], to: [1100, 225] }, { from: [1060, 395], to: [1100, 290] },
    ] },
  },
};
const ZH = {
  design: ['AI 写 three.js', '网格 · 灯\n材质 · 着色器', '引擎把它接上', 'scene.add · 一盏灯\n后期通道 · plugins/', '引擎负责协调', '时间 · 存档 · 按键\n天气 · 画面数值', 'AI 检查结果', 'describe · 报错\n测试 · 截图', '下一次修改'],
};
// Chinese: same geometry, translated text
const zh = JSON.parse(JSON.stringify(T.en));
const tr = (b, title, sub) => { b.title = title; b.sub = sub; };
{ const b = zh.design.boxes; tr(b[0], ZH.design[0], ZH.design[1]); tr(b[1], ZH.design[2], ZH.design[3]); tr(b[2], ZH.design[4], ZH.design[5]); tr(b[3], ZH.design[6], ZH.design[7]); zh.design.arrows[3].label = ZH.design[8]; }
{ const b = zh.arch.boxes; tr(b[0], '你的游戏', '规则 · 内容 · 画风 · 插件 · 原生 three.js'); tr(b[1], '模块', 'world · look · actor · rules · ui · net · tool');
  tr(b[2], '核心', '生命周期 · 统一的时间 · 共享数值\n按场合分组的按键 · 角色控制权 · 存档 · 玩家操作'); tr(b[3], '渲染', 'WebGL 或 WebGPU，开局选定'); tr(b[4], 'three.js + Rapier', '');
  tr(b[5], '给 AI 的工具', 'how · describe\ntest · shot · MCP\n操作和读取游戏'); }
{ const b = zh.module.boxes; tr(b[0], '一个模块', ''); tr(b[1], '一种类型', 'world · look · actor · …'); tr(b[2], '插槽', '提供 · 需要'); tr(b[3], 'install(engine, ctx)', '');
  tr(b[4], 'ctx', '监听 · 共享数值\n按键动作 · 控制权'); tr(b[5], '引擎', '核心 · 其他模块\n经过公开约定'); tr(b[6], '随模块一起离开', '卸载、出错\n或销毁时'); }
zh.layers.steps = [['engine', '默认值', C.gray], ['style', '游戏的画风', C.blue], ['game', '游戏自己的值', C.green], ['effect', '天气 · 日落\n慢动作：乘或加', C.yellow],
  ['system', '菜单 · 过场', C.orange], ['settings', '玩家设置\n只能调低或关掉', C.pink], ['debug', '', C.purple]]; zh.layers.foot = '低  →  高';
{ const b = zh.look.boxes; tr(b[0], '画风包', '起始数值\n+ 画面插件'); tr(b[1], 'plugins/ 文件夹', '游戏自己的'); tr(b[2], '游戏代码', 'look.*.set · add\nreplace · patch');
  tr(b[3], '画面部件', '天空 · 雾 · 光 · 材质\n水面 · 地面 · 后期'); tr(b[4], '后期流程', '场景 → HDR → 色调\n→ LDR → 最终'); tr(b[5], '材质', '引擎做的和\n原生 three.js 的'); tr(b[6], 'WebGL\nWebGPU', ''); }
T.zh = zh;

function page(d) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:${C.paper}} canvas{display:block}</style></head>
<body><canvas id="c" width="${d.w * 1.5}" height="${d.h * 1.5}" style="width:${d.w}px;height:${d.h}px"></canvas></body></html>`;
}

async function drawIn(p, d) {
  await p.addScriptTag({ content: `var module={exports:{}};var exports=module.exports;${roughSrc};window.rough=module.exports.default||module.exports;` });
  await p.evaluate(({ d, C }) => {
    const cv = document.getElementById('c'), ctx = cv.getContext('2d');
    ctx.scale(1.5, 1.5); ctx.fillStyle = C.paper; ctx.fillRect(0, 0, d.w, d.h);
    const rc = window.rough.canvas(cv);
    const font = (size, bold) => `${bold ? '700 ' : ''}${size}px "Segoe Print", "STKaiti", "KaiTi", cursive`;
    const text = (s, x, y, size, bold) => {
      ctx.fillStyle = C.ink; ctx.font = font(size, bold); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lines = String(s).split('\n'), lh = size * 1.3; lines.forEach((l, i) => ctx.fillText(l, x, y + (i - (lines.length - 1) / 2) * lh));
    };
    const box = b => {
      rc.rectangle(b.x, b.y, b.w, b.h, { roughness: 1.4, bowing: 1.2, stroke: C.ink, strokeWidth: 2, fill: b.fill, fillStyle: b.dashed ? 'solid' : 'hachure', hachureGap: 7, fillWeight: 1.6, strokeLineDash: b.dashed ? [10, 8] : undefined });
      if (b.fill === C.paper || b.dashed) { /* plain card */ }
      const cx = b.x + b.w / 2, hasSub = !!b.sub;
      if (b.dashed) { text(b.title, cx, b.y + 30, 24, true); return; }
      // white label plate so text reads over the hachure
      ctx.fillStyle = 'rgba(253,251,245,0.85)';
      const pw = b.w - 26, ph = b.h - 26; ctx.fillRect(b.x + 13, b.y + 13, pw, ph);
      if (hasSub) { const subLines = b.sub.split('\n').length; text(b.title, cx, b.y + b.h / 2 - subLines * 12, 24, true); text(b.sub, cx, b.y + b.h / 2 + 18 + (subLines - 1) * 4, 17, false); }
      else text(b.title, cx, b.y + b.h / 2, 24, true);
    };
    const arrow = a => {
      const [x1, y1] = a.from, [x2, y2] = a.to, o = { roughness: 1.2, stroke: C.ink, strokeWidth: 2.2, strokeLineDash: a.dashed ? [9, 7] : undefined };
      let ex = x2, ey = y2, sx = x1, sy = y1;
      if (a.curve) {
        const my = Math.max(y1, y2) + a.curve, cx1 = x1, cx2 = x2;
        rc.curve([[x1, y1], [x1 - 20, my - 40], [(x1 + x2) / 2, my], [x2 + 20, my - 40], [x2, y2 + 4]], o);
        sx = x2 + 20; sy = my - 40; ex = x2; ey = y2 + 4;
        if (a.label) text(a.label, (x1 + x2) / 2, my - 22, 18, false);
      } else rc.line(x1, y1, x2, y2, o);
      const ang = Math.atan2(ey - sy, ex - sx), L = 16;
      rc.line(ex, ey, ex - L * Math.cos(ang - 0.45), ey - L * Math.sin(ang - 0.45), o);
      rc.line(ex, ey, ex - L * Math.cos(ang + 0.45), ey - L * Math.sin(ang + 0.45), o);
      if (a.label && !a.curve) text(a.label, (x1 + x2) / 2 + 8, (y1 + y2) / 2 - 22, 17, false);
    };
    if (d.steps) {
      const n = d.steps.length, sw = (d.w - 80) / n, base = d.h - 70;
      d.steps.forEach(([name, sub, fill], i) => {
        const h = 110 + i * 42, x = 40 + i * sw, y = base - h;
        rc.rectangle(x, y, sw - 10, h, { roughness: 1.4, stroke: C.ink, strokeWidth: 2, fill, fillStyle: 'hachure', hachureGap: 7, fillWeight: 1.6 });
        ctx.fillStyle = 'rgba(253,251,245,0.88)'; ctx.fillRect(x + 8, y + 10, sw - 26, sub ? 100 : 46);
        text(name, x + (sw - 10) / 2, y + 32, 23, true); if (sub) text(sub, x + (sw - 10) / 2, y + 74, 15, false);
      });
      rc.line(40, base + 20, d.w - 40, base + 20, { roughness: 1, stroke: C.ink, strokeWidth: 2 });
      rc.line(d.w - 40, base + 20, d.w - 56, base + 10, { stroke: C.ink, strokeWidth: 2 }); rc.line(d.w - 40, base + 20, d.w - 56, base + 30, { stroke: C.ink, strokeWidth: 2 });
      text(d.foot, d.w / 2, base + 46, 19, false);
    }
    (d.boxes || []).forEach(box); (d.arrows || []).forEach(arrow);
  }, { d, C });
}

const browser = await chromium.launch();
try {
  for (const lang of ['en', 'zh']) for (const [name, d] of Object.entries(T[lang])) {
    const p = await browser.newPage({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 1 });
    await p.setContent(page(d)); await p.evaluate(() => document.fonts.ready);
    await drawIn(p, d);
    const data = await p.evaluate(() => document.getElementById('c').toDataURL('image/png'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(outDir, `${name}${lang === 'zh' ? '.zh' : ''}.png`), Buffer.from(data.split(',')[1], 'base64'));
    await p.close();
  }
} finally { await browser.close(); }
console.log('done');
