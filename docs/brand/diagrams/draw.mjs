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
      { x: 650, y: 60, w: 260, h: 150, title: 'Engine coordinates', sub: 'time · saves · input\nweather · signals', fill: C.yellow },
      { x: 960, y: 60, w: 250, h: 150, title: 'AI checks it', sub: 'describe · errors\ntests · screenshots', fill: C.pink },
    ], arrows: [
      { from: [290, 135], to: [340, 135] }, { from: [600, 135], to: [650, 135] }, { from: [910, 135], to: [960, 135] },
      { from: [1085, 210], to: [160, 210], curve: 150, dashed: true, label: 'next change' },
    ] },
    arch: { w: 1240, h: 720, boxes: [
      { x: 60, y: 30, w: 800, h: 100, title: 'Your game', sub: 'rules · content · picture · plugins · plain three.js', fill: C.blue },
      { x: 60, y: 165, w: 800, h: 100, title: 'Modules', sub: 'world · picture · actor · rules · ui · net · tool', fill: C.green },
      { x: 60, y: 300, w: 800, h: 130, title: 'Core', sub: 'lifecycle · one time source · shared values\ninput by context · character control · saves · actions', fill: C.yellow },
      { x: 60, y: 465, w: 800, h: 100, title: 'Rendering', sub: 'WebGL or WebGPU, new projects start on WebGPU', fill: C.orange },
      { x: 60, y: 600, w: 800, h: 90, title: 'three.js + Rapier', sub: '', fill: C.gray },
      { x: 930, y: 30, w: 270, h: 200, title: 'Agent tools', sub: 'how · check · play\ndescribe · shot · verify\neditor · MCP', fill: C.purple },
    ], arrows: [
      { from: [460, 130], to: [460, 165] }, { from: [460, 265], to: [460, 300] }, { from: [460, 430], to: [460, 465] }, { from: [460, 565], to: [460, 600] },
      { from: [930, 80], to: [860, 80], dashed: true },
    ] },
    module: { w: 1240, h: 470, boxes: [
      { x: 30, y: 40, w: 330, h: 390, title: 'A module', sub: '', fill: C.green, dashed: true },
      { x: 60, y: 110, w: 270, h: 80, title: 'one type', sub: 'world · picture · actor · …', fill: C.paper },
      { x: 60, y: 215, w: 270, h: 80, title: 'slots', sub: 'provides · requires', fill: C.paper },
      { x: 60, y: 320, w: 270, h: 80, title: 'install(engine, ctx)', sub: '', fill: C.paper },
      { x: 450, y: 250, w: 330, h: 130, title: 'ctx', sub: 'listeners · shared values\ninput actions · control', fill: C.yellow },
      { x: 880, y: 90, w: 320, h: 120, title: 'Engine', sub: 'core · other modules\nthrough contracts', fill: C.blue },
      { x: 880, y: 290, w: 320, h: 130, title: 'Leaves with it', sub: 'on uninstall, failure\nor dispose', fill: C.pink },
    ], arrows: [
      { from: [330, 360], to: [450, 320] }, { from: [780, 290], to: [880, 160] }, { from: [780, 330], to: [880, 350] },
    ] },
    layers: { w: 1240, h: 440, steps: [
      ['engine', 'default', C.gray], ['game', "the game's value", C.green],
      ['effect', 'weather\nslow motion: × or +', C.yellow], ['system', 'menus · cutscenes', C.orange],
      ['settings', 'the player only\nlowers or turns off', C.pink], ['debug', '', C.purple] ],
      foot: 'lowest  →  highest' },
    picture: { w: 1240, h: 500, boxes: [
      { x: 30, y: 50, w: 270, h: 150, title: 'Game systems', sub: 'time · weather · cutscenes\nsettings · quality tier', fill: C.yellow },
      { x: 360, y: 50, w: 270, h: 150, title: 'Signals', sub: 'engine.uniforms\nsun · rain · wind · …', fill: C.orange },
      { x: 690, y: 50, w: 280, h: 150, title: 'picture/ folder', sub: 'your plain three.js\nlights · fog · materials', fill: C.blue },
      { x: 1030, y: 50, w: 180, h: 150, title: 'three.js', sub: 'WebGL or\nWebGPU', fill: C.gray },
      { x: 360, y: 320, w: 270, h: 140, title: 'Big pieces', sub: 'terrain · plants · water\nsky dome · rain', fill: C.green },
      { x: 760, y: 320, w: 450, h: 140, title: 'Checks', sub: 'screenshot facts\nwhich line wrote a value', fill: C.pink },
    ], arrows: [
      { from: [300, 125], to: [360, 125] }, { from: [630, 125], to: [690, 125] }, { from: [970, 125], to: [1030, 125] },
      { from: [560, 320], to: [740, 200], label: 'hand out materials', lx: 545, ly: 255 },
      { from: [1120, 200], to: [1050, 320], dashed: true, label: 'read the result', lx: 985, ly: 262 },
    ] },
  },
};
const ZH = {
  design: ['AI 写 three.js', '网格 · 灯\n材质 · 着色器', '引擎把它接上', 'scene.add · 一盏灯\n后期通道 · plugins/', '引擎负责协调', '时间 · 存档 · 按键\n天气 · 信号', 'AI 检查结果', 'describe · 报错\n测试 · 截图', '下一次修改'],
};
// Chinese: same geometry, translated text
const zh = JSON.parse(JSON.stringify(T.en));
const tr = (b, title, sub) => { b.title = title; b.sub = sub; };
{ const b = zh.design.boxes; tr(b[0], ZH.design[0], ZH.design[1]); tr(b[1], ZH.design[2], ZH.design[3]); tr(b[2], ZH.design[4], ZH.design[5]); tr(b[3], ZH.design[6], ZH.design[7]); zh.design.arrows[3].label = ZH.design[8]; }
{ const b = zh.arch.boxes; tr(b[0], '你的游戏', '规则 · 内容 · 画面 · 插件 · 原生 three.js'); tr(b[1], '模块', 'world · picture · actor · rules · ui · net · tool');
  tr(b[2], '核心', '生命周期 · 统一的时间 · 共享数值\n按场合分组的按键 · 角色控制权 · 存档 · 玩家操作'); tr(b[3], '渲染', 'WebGL 或 WebGPU，新项目默认 WebGPU'); tr(b[4], 'three.js + Rapier', '');
  tr(b[5], '给 AI 的工具', 'how · check · play\ndescribe · shot · verify\n编辑器 · MCP'); }
{ const b = zh.module.boxes; tr(b[0], '一个模块', ''); tr(b[1], '一种类型', 'world · picture · actor · …'); tr(b[2], '插槽', '提供 · 需要'); tr(b[3], 'install(engine, ctx)', '');
  tr(b[4], 'ctx', '监听 · 共享数值\n按键动作 · 控制权'); tr(b[5], '引擎', '核心 · 其他模块\n经过公开约定'); tr(b[6], '随模块一起离开', '卸载、出错\n或销毁时'); }
zh.layers.steps = [['engine', '默认值', C.gray], ['game', '游戏自己的值', C.green], ['effect', '天气\n慢动作：乘或加', C.yellow],
  ['system', '菜单 · 过场', C.orange], ['settings', '玩家设置\n只能调低或关掉', C.pink], ['debug', '', C.purple]]; zh.layers.foot = '低  →  高';
{ const b = zh.picture.boxes; tr(b[0], '游戏里的系统', '时间 · 天气 · 过场\n设置 · 画质档位'); tr(b[1], '信号', 'engine.uniforms\n太阳 · 雨 · 风 · …'); tr(b[2], 'picture/ 文件夹', '你的原生 three.js\n灯 · 雾 · 材质');
  tr(b[3], 'three.js', 'WebGL 或\nWebGPU'); tr(b[4], '引擎的大件', '地形 · 植被 · 水面\n穹顶 · 雨雪'); tr(b[5], '检查', '截图的事实\n值是哪一行写的');
  zh.picture.arrows[3].label = '交出材质'; zh.picture.arrows[4].label = '读结果'; }
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
      if (a.label && !a.curve) text(a.label, a.lx ?? (x1 + x2) / 2 + 8, a.ly ?? (y1 + y2) / 2 - 22, 17, false);
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
