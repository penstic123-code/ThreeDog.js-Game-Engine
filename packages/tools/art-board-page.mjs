// The page of `threedog art board`: one static HTML file over the scan's data, built on the same shell as `threedog lib page` (lib.mjs htmlPage).
// Nothing is stored anywhere: copying goes to the clipboard, a selection lives in the open tab. No account, no server.
// Page text follows the browser language (Chinese, otherwise English): the words below are the only copy of them; the data itself stays English,
// because the copied line goes to the AI and --json must read the same.
import { relative, dirname, join, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { htmlPage } from './lib.mjs';

const WORDS = {
  en: { title: 'Art board', all: 'All', search: 'Search name, file…', copy: 'Copy line', copied: 'Copied', total: 'items', size: 'total size', biggest: 'Biggest', none: 'none',
    used: 'used', unused: 'unused', missing: 'missing', 'not-traced': 'not traced', noPreview: 'no preview', modelHint: 'threedog gallery --shots makes a picture', code: 'made in code',
    usedAt: 'Used at', maybeAt: 'Maybe', selected: 'selected', note: 'What do you want changed? Write it here…', copyAsk: 'Copy request for the AI', clear: 'Clear', ask: 'Art request for game',
    items: 'Items', limits: 'What this page cannot see', dynamic: 'Built at run time (cannot be followed)', problems: 'Problems reading the game', live: 'running game: loaded', liveSum: 'Compared with the running game',
    model: 'Models', texture: 'Textures', sound: 'Sounds', font: 'Fonts', material: 'Materials', shader: 'Shaders', library: 'From the library', noLive: 'Static scan only. `threedog art board --live` also asks the running game what it loaded.' },
  zh: { title: '美术资源面板', all: '全部', search: '搜名字、文件…', copy: '复制这行', copied: '已复制', total: '项', size: '总大小', biggest: '最大的', none: '无',
    used: '在用', unused: '没用到', missing: '缺失', 'not-traced': '查不到', noPreview: '没有预览', modelHint: 'threedog gallery --shots 可以生成图片', code: '代码生成',
    usedAt: '用在', maybeAt: '可能用在', selected: '已选', note: '想怎么改？写在这里…', copyAsk: '复制给 AI 的请求', clear: '清空', ask: 'Art request for game',
    items: 'Items', limits: '这个页面看不到的', dynamic: '运行时才拼出来的名字（查不到去向）', problems: '读游戏时的问题', live: '运行中的游戏：已加载', liveSum: '已和运行中的游戏对照',
    model: '模型', texture: '贴图', sound: '声音', font: '字体', material: '材质', shader: '着色器', library: '来自素材库', noLive: '这是静态扫描。加 --live 还会问运行中的游戏实际加载了什么。',
    runtimeNames: '运行时拼出来的名字追不到：它可能碰到的资源标“查不到”，不标“没用到”。--live 会问运行中的游戏。', embedded: '.glb 里面的贴图和材质不逐个列出；--live 会补上场景里的。',
    codeMeshes: '代码里直接搭的网格、现场合成的声音，没有注册名字就不列出；这些网格的材质会列出。', liveNow: '--live 只看到现在已加载的：没去过的关卡看起来没加载，所以它不会把任何东西判成“没用到”。' },
};

const STYLE = `.top{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0}.top section{background:#2a2a2f;border-radius:6px;padding:8px 12px;min-width:150px}.top b{font-size:20px;display:block}
.top ul{margin:4px 0 0;padding:0 0 0 16px;font-size:12px;color:#bbb}.bar{position:sticky;top:0;z-index:2;background:#1d1d20;padding:8px 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
button,input,textarea{font:inherit;color:#ddd;background:#333338;border:1px solid #4a4a52;border-radius:4px;padding:4px 8px}button{cursor:pointer}button.on{background:#47637a;border-color:#6d94b3}
input[type=search]{flex:1;min-width:160px}article{position:relative}article.sel{outline:2px solid #6d94b3}article label{position:absolute;top:14px;left:14px;background:#000a;padding:2px 4px;border-radius:3px}
.pv{height:160px;overflow:hidden}.pv img{max-width:100%;max-height:100%;object-fit:contain}.pv pre{margin:0;padding:6px;font-size:10px;color:#8c9;width:100%;height:100%;overflow:hidden;box-sizing:border-box}.pv span{color:#888;text-align:center;padding:0 12px}
.pv i{display:block;width:100%;height:100%}.pv audio{width:92%}.st{font-size:11px;white-space:nowrap;padding:1px 6px;border-radius:9px;margin-left:6px;vertical-align:middle;color:#111}.st.used{background:#8fc79a}.st.unused{background:#d9c27a}.st.missing{background:#e58a7e}.st.not-traced{background:#a7b4c9}
.at{font-size:12px;color:#bbb;word-break:break-all;margin:4px 0}.at b{color:#999;font-weight:normal}#ask{position:sticky;bottom:0;background:#26262b;border-top:1px solid #444;padding:8px;margin:12px -16px -16px;display:none}#ask.on{display:block}#ask textarea{width:100%;box-sizing:border-box;height:56px;margin-bottom:6px}
details{margin:12px 0;color:#bbb;font-size:13px}details li{word-break:break-all}`;

/** How the page reaches a file: relative to the page (it opens from file://), so the page keeps working when the game folder moves with it */
function hrefOf(from, target) {
  const r = relative(dirname(from), target);
  if (isAbsolute(r)) return pathToFileURL(target).href;   // another drive on Windows
  return r.split(sep).map(encodeURIComponent).join('/');
}

/** The board as one HTML document. @param {any} data scanArt() result @param {string} out where the page will be written */
export function boardPage(data, out) {
  const items = data.items.map(it => {
    const p = it.preview, src = p?.abs ?? (p?.file && join(data.dir, p.file));
    return { ...it, preview: p && { ...p, abs: undefined, file: undefined, src: src ? hrefOf(out, src) : undefined } };
  });
  const json = JSON.stringify({ ...data, items, words: WORDS }).replace(/</g, '\\u003c');
  return htmlPage({ title: `art board: ${data.game}`, style: STYLE, body: `<h1><span id="h"></span> <small>${data.game.replace(/[&<>"]/g, '')}</small></h1>
<div class="top" id="top"></div><div class="bar" id="bar"></div><main id="grid"></main><div id="foot"></div><div id="ask"></div>
<script>const D=${json};(${client.toString()})(D);</script>` });
}

/** Runs in the page; sent as text, so it uses nothing from this module */
function client(D) {
  const W = { ...D.words.en, ...((navigator.language || '').startsWith('zh') ? D.words.zh : {}) }, $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const size = n => n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const picked = new Set(); let kind = 'all', status = 'all', word = '';
  const copy = async text => {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  };
  document.title = `${W.title}: ${D.game}`; $('h').textContent = W.title;
  const S = D.summary, list = l => l.length ? `<ul>${l.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}${l.length > 6 ? `<li>+${l.length - 6}</li>` : ''}</ul>` : `<ul><li>${W.none}</li></ul>`;
  $('top').innerHTML = `<section><b>${S.total}</b>${W.total} · ${Object.entries(S.counts).map(([k, n]) => `${W[k]} ${n}`).join(' · ')}</section><section><b>${size(S.totalBytes) || '0 B'}</b>${W.size}</section>
<section>${W.biggest}${list(S.biggest.map(b => `${b.ref} ${size(b.size)}`))}</section><section>${W.missing} (${S.missing.length})${list(S.missing)}</section>
<section>${W.unused} (${S.unused.length})${list(S.unused)}</section><section>${W['not-traced']} (${S.notTraced.length})${list(S.notTraced)}</section>`;
  const button = (label, on, click) => { const b = document.createElement('button'); b.textContent = label; b.className = on() ? 'on' : ''; b.onclick = click; return b; };
  const bar = () => {
    const box = $('bar'); box.replaceChildren();
    for (const k of ['all', ...Object.keys(S.counts)]) box.append(button(k === 'all' ? W.all : W[k], () => kind === k, () => { kind = k; draw(); }));
    box.append(' | ');
    for (const s of ['all', 'missing', 'not-traced', 'unused', 'used']) box.append(button(s === 'all' ? W.all : W[s], () => status === s, () => { status = s; draw(); }));
    const q = Object.assign(document.createElement('input'), { type: 'search', placeholder: W.search, value: word });
    q.oninput = () => { word = q.value.toLowerCase(); grid(); };
    box.append(q);
  };
  const preview = it => {
    const p = it.preview;
    if (p?.type === 'image') return `<img loading="lazy" src="${esc(p.src)}" alt="${esc(it.name)}">`;
    if (p?.type === 'color') return `<i style="background:${esc(p.value)}" title="${esc(p.value)}"></i>`;
    if (p?.type === 'code') return `<pre>${esc(p.text)}</pre>`;
    if (p?.type === 'audio') return `<audio controls preload="none" src="${esc(p.src)}"></audio>`;
    return `<span>${it.made ? W.code : it.kind === 'model' ? W.modelHint : W.noPreview}</span>`;
  };
  const where = (label, l) => l.length ? `<p class="at"><b>${label}:</b> ${[...new Set(l.map(u => u.at))].slice(0, 8).map(esc).join(', ')}</p>` : '';
  const grid = () => {
    const shown = D.items.filter(it => (kind === 'all' || it.kind === kind) && (status === 'all' || it.status === status) && (!word || it.line.toLowerCase().includes(word)));
    $('grid').innerHTML = shown.map(it => `<article data-ref="${esc(it.ref)}" class="${picked.has(it.ref) ? 'sel' : ''}"><label><input type="checkbox"${picked.has(it.ref) ? ' checked' : ''}></label><div class="pv">${preview(it)}</div>
<h2>${esc(it.name)}<span class="st ${it.status}">${W[it.status]}</span></h2><p class="b">${W[it.kind]}${it.size ? ' · ' + size(it.size) : ''}${it.loaded ? ' · ' + W.live : ''}${it.library ? ' · ' + W.library + ': ' + esc(it.library) : ''}${it.pulled ? ' · ' + esc(it.pulled) + (it.libraryState === 'newer' ? ' · newer in the library' : '') : ''}</p>
<p class="at">${esc(it.file)}${it.problem ? ' · ' + esc(it.problem) : ''}</p>${where(W.usedAt, it.uses)}${where(W.maybeAt, it.maybe)}<button>${W.copy}</button></article>`).join('');
  };
  $('grid').addEventListener('click', e => {
    const card = e.target.closest('article'); if (!card) return;
    const it = D.items.find(x => x.ref === card.dataset.ref);
    if (e.target.tagName === 'BUTTON') { copy(it.line); e.target.textContent = W.copied; setTimeout(() => { e.target.textContent = W.copy; }, 1200); }
    if (e.target.type === 'checkbox') { if (e.target.checked) picked.add(it.ref); else picked.delete(it.ref); card.classList.toggle('sel', e.target.checked); ask(); }
  });
  const ask = () => {
    const box = $('ask'); box.className = picked.size ? 'on' : '';
    if (box.dataset.ready) { box.querySelector('b').textContent = `${W.selected} ${picked.size}`; return; }
    box.dataset.ready = '1';
    box.innerHTML = `<textarea placeholder="${esc(W.note)}"></textarea><b>${W.selected} ${picked.size}</b> <button>${W.copyAsk}</button> <button>${W.clear}</button>`;
    const [go, clear] = box.querySelectorAll('button');
    go.onclick = () => {
      const note = box.querySelector('textarea').value.trim(), lines = D.items.filter(i => picked.has(i.ref)).map(i => '- ' + i.line);
      copy(`${W.ask} ${D.game}:\n${note ? note + '\n' : ''}\n${W.items}:\n${lines.join('\n')}`);
      go.textContent = W.copied; setTimeout(() => { go.textContent = W.copyAsk; }, 1200);
    };
    clear.onclick = () => { picked.clear(); ask(); grid(); };
  };
  const draw = () => { bar(); grid(); };
  const li = l => `<ul>${l.map(x => `<li>${x}</li>`).join('')}</ul>`;
  $('foot').innerHTML = (D.problems.length ? `<details open><summary>${W.problems}</summary>${li(D.problems.map(esc))}</details>` : '')
    + (D.dynamic.length ? `<details><summary>${W.dynamic} (${D.dynamic.length})</summary>${li(D.dynamic.map(d => `${esc(d.at)} <code>${esc(d.text)}</code>`))}</details>` : '')
    + `<details><summary>${W.limits}</summary><p>${D.live ? `${W.liveSum}: ${D.live.assets} / ${D.live.materials} / ${D.live.textures}` : esc(W.noLive)}</p>${li(D.limits.map(l => esc(W[l.id] ?? l.text)))}</details>`;
  draw();
}
