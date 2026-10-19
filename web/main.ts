import './style.css';
import type { ApiConfig, AudioTake, Database, NoteRecord, Style } from './types';
import { loadState, transcribe, rewrite, deleteRecord } from './api';
import { Recorder } from './recorder';

import { icon, escapeHTML } from './ui';
import { renderHotwords } from './hotwords';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const formatTime = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const styles: Record<Style, string> = { natural: '自然表达', paragraphs: '清晰分段', bullets: '要点列表' };
let database: Database = { records: [], hotwords: [] };
let selected: NoteRecord | undefined;
let take: AudioTake | undefined;
let style: Style = 'natural';
let view: 'workspace' | 'history' | 'hotwords' = 'workspace';
let busy = false;
let isDemo = false;
let elapsed = 0;
let serverError = '';
const defaults: ApiConfig = { baseUrl: 'https://api.openai.com/v1', apiKey: '', transcriptionModel: 'whisper-1', rewriteModel: 'gpt-4o-mini', language: 'zh' };
let config = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem('notle.preferences') || '{}') as Partial<ApiConfig>;
  for (const key of ['baseUrl', 'transcriptionModel', 'rewriteModel', 'language'] as const) if (typeof saved[key] === 'string') config[key] = saved[key];
} catch { /* Storage may be unavailable; defaults still work. */ }

const recorder = new Recorder((_, time) => { elapsed = time; updateRecording(); }, audio => { if (take) URL.revokeObjectURL(take.url); take = audio; selected = undefined; isDemo = false; renderContent(); }, message => toast(message, true), levels => {
  document.querySelectorAll<HTMLElement>('.wave-bar').forEach((bar, index) => { bar.style.height = `${5 + (levels[index] || 0) * 39}px`; });
});

$('#app').innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="#" aria-label="Notle 首页"><span class="brand-mark"><i></i><i></i><i></i><i></i></span>notle<span class="brand-period">.</span></a>
    <div class="sidebar-label">你的语音空间</div>
    <nav class="navigation" aria-label="主导航">
      <button id="nav-workspace" class="nav-item active" aria-label="录音工作台">${icon('grid')}<span>录音工作台</span><span class="nav-key">⌘ 1</span></button>
      <button id="nav-history" class="nav-item" aria-label="转写记录">${icon('history')}<span>转写记录</span><span id="history-count" class="count">0</span></button>
      <button id="nav-hotwords" class="nav-item" aria-label="热词词典">${icon('book')}<span>热词词典</span><span id="hotword-count" class="count">0</span></button>
    </nav>
    <div class="sidebar-bottom"><div class="local-badge">${icon('shield')}<span>文字保存在本机</span></div><p>少一点打字<br>多一点自由表达。</p><span class="version">NOTLE / V0.1</span></div>
  </aside>
  <div class="app-main">
    <header class="topbar"><div><span class="breadcrumb">我的空间</span><span class="slash">/</span><span id="page-title">录音工作台</span></div><button id="settings-open" class="settings-button">${icon('settings')}<span>AI 设置</span><span id="config-dot" class="status-dot"></span></button></header>
    <main id="content"></main>
    <footer class="page-footer"><span>把说出口的想法，变成值得留下的文字。</span><span>BUILT FOR YOUR FLOW <span class="tiny-wave">▂▆▃▇▂</span></span></footer>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <dialog id="settings-dialog" class="settings-dialog" aria-labelledby="settings-title">
    <form id="settings-form">
      <div class="dialog-heading"><div><div class="eyebrow">MAKE IT YOURS</div><h2 id="settings-title">连接你的 AI</h2></div><button type="button" class="icon-button" id="settings-close" aria-label="关闭 AI 设置">${icon('close')}</button></div>
      <p class="muted">使用同时支持语音转写和文字生成的 OpenAI 兼容服务。</p>
      <label>API 地址<input name="baseUrl" type="url" required placeholder="https://api.openai.com/v1" spellcheck="false" /></label>
      <label>API Key<input name="apiKey" type="password" required placeholder="输入你的 API Key" autocomplete="off" maxlength="4096" /></label>
      <div class="settings-grid"><label>转写模型<input name="transcriptionModel" required maxlength="120" placeholder="whisper-1" spellcheck="false" /></label><label>整理模型<input name="rewriteModel" required maxlength="120" placeholder="gpt-4o-mini" spellcheck="false" /></label></div>
      <label>识别语言<select name="language"><option value="zh">中文</option><option value="">自动识别</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label>
      <div class="privacy-note">${icon('shield')}<p>API Key 仅在当前页面内存中使用，刷新后需重新填写。提交转写时，录音和文字将发送至你配置的服务；配置热词后也会一同发送。</p></div>
      <div id="settings-error" class="inline-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="button secondary" id="settings-cancel">取消</button><button type="submit" class="button primary">保存设置 ${icon('arrow')}</button></div>
    </form>
  </dialog>`;

let toastTimer: number | undefined;
export function toast(message: string, error = false) {
  const element = $('#toast'); element.textContent = message; element.classList.toggle('error', error); element.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { element.hidden = true; }, error ? 12_000 : 3500);
}
function changeView(next: typeof view) { if (busy || recorder.state !== 'idle') return; view = next; renderContent(); }
$('#nav-workspace').onclick = () => changeView('workspace');
$('#nav-history').onclick = () => changeView('history');
$('#nav-hotwords').onclick = () => changeView('hotwords');
$('.brand').onclick = event => { event.preventDefault(); changeView('workspace'); };
function openSettings() {
  const form = $('#settings-form') as HTMLFormElement;
  for (const [key, value] of Object.entries(config)) (form.elements.namedItem(key) as HTMLInputElement).value = value;
  $('#settings-error').hidden = true; ($('#settings-dialog') as HTMLDialogElement).showModal();
}
$('#settings-open').onclick = openSettings;
for (const id of ['#settings-close', '#settings-cancel']) $(id).onclick = () => ($('#settings-dialog') as HTMLDialogElement).close();
$('#settings-form').onsubmit = event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const next = Object.fromEntries(form.entries()) as unknown as ApiConfig;
  for (const key of Object.keys(next) as (keyof ApiConfig)[]) next[key] = next[key].trim();
  try {
    const url = new URL(next.baseUrl);
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { $('#settings-error').textContent = '请填写 HTTPS API 地址。本机服务可以使用 HTTP；地址中不能包含账号、查询参数或片段。'; $('#settings-error').hidden = false; return; }
  config = next;
  const { apiKey: _secret, ...preferences } = config;
  try { localStorage.setItem('notle.preferences', JSON.stringify(preferences)); } catch { toast('设置已用于当前页面，浏览器未允许保存偏好。', true); }
  ($('#settings-dialog') as HTMLDialogElement).close(); updateConfig(); toast('AI 设置已保存，可以开始转写。');
};
function updateConfig() { $('#config-dot').classList.toggle('ready', !!config.apiKey); $('#config-dot').title = config.apiKey ? '已填写 API Key' : '尚未填写 API Key'; const hint = document.querySelector('#config-hint'); if (hint) hint.textContent = config.apiKey ? 'AI 已配置，准备好接住你的想法' : '首次使用，请先在右上角连接你的 AI'; }
function requireConfig(): boolean { if (config.apiKey) return true; openSettings(); return false; }

function renderContent() {
  $('#page-title').textContent = view === 'workspace' ? '录音工作台' : view === 'history' ? '转写记录' : '热词词典';
  $('#nav-workspace').classList.toggle('active', view === 'workspace'); $('#nav-history').classList.toggle('active', view === 'history');
  $('#nav-hotwords').classList.toggle('active', view === 'hotwords');
  $('#hotword-count').textContent = String(database.hotwords.filter(word => word.enabled).length);
  if (view === 'hotwords') {
    renderHotwords(database.hotwords, async () => { await refreshState(); renderContent(); }, toast); updateConfig(); return;
  }
  $('#history-count').textContent = String(database.records.length);
  $('#content').innerHTML = view === 'workspace' ? workspaceHTML() : historyHTML();
  if (view === 'workspace') bindWorkspace(); else bindHistory();
  updateConfig(); updateRecording();
}
function workspaceHTML() {
  return `<section class="intro"><div><div class="eyebrow"><span class="small-line"></span> FROM VOICE TO CLARITY</div><h1>说出来，<span>就有条理。</span></h1><p>思绪尽管自由，文字交给 Notle。</p></div><div class="intro-note"><span class="status-dot ${config.apiKey ? 'ready' : ''}"></span><span id="config-hint"></span></div></section>
  ${serverError ? `<div class="connection-error" role="alert">${escapeHTML(serverError)} <button id="retry-connection">重新连接</button></div>` : ''}
  <section class="recording-card" aria-labelledby="recording-title">
    <div class="card-top"><div><span class="section-number">01</span><h2 id="recording-title">录下此刻的想法</h2></div><span class="chip">${icon('mic')} 录音后转写</span></div>
    <div class="recording-stage"><div class="waveform" aria-hidden="true">${Array.from({length: 32}, (_, i) => `<i class="wave-bar" style="height:${5 + Math.sin(i * 1.7) ** 2 * 14}px"></i>`).join('')}</div><div id="recording-time" class="recording-time">${formatTime(take?.durationMs || 0)}</div><p id="recording-status" class="recording-status">${take ? '录音已就绪，回听一下或开始转写' : '不必打草稿，从第一句话开始'}</p><button id="record-button" class="record-button" aria-label="开始录音">${icon('mic')}</button><div id="shortcut-hint" class="shortcut-hint">点击开始录音 <span>或</span> <kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd><kbd>⇧</kbd><kbd>Space</kbd></div></div>
    ${take ? `<div class="audio-preview"><div class="audio-caption">${icon('file')}<span>${escapeHTML(take.name)}</span><small>${(take.blob.size / 1_000_000).toFixed(2)} MB</small></div><audio controls src="${escapeHTML(take.url)}" aria-label="录音回放"></audio><button id="download-audio" class="icon-button" title="下载原始录音" aria-label="下载原始录音">${icon('download')}</button></div>` : ''}
    <div class="recording-bottom"><span>每段最长 10 分钟 · 最大 25 MB</span><button id="upload-button" class="text-button">${icon('upload')} 导入音频</button><input id="audio-file" type="file" accept="audio/*,video/webm,video/mp4,.m4a" hidden /></div>
  </section>
  <section class="flow-controls"><div><div class="control-label">整理成你需要的样子</div><div class="style-options" role="group" aria-label="整理风格">${Object.entries(styles).map(([value, label]) => `<button data-style="${value}" class="style-option ${style === value ? 'selected' : ''}" aria-pressed="${style === value}">${value === 'natural' ? icon('sparkle') : value === 'paragraphs' ? icon('file') : '<span class="list-icon">☷</span>'}${label}</button>`).join('')}</div></div><button id="process-button" class="button primary process-button" ${!take || busy ? 'disabled' : ''}>${icon('sparkle')}<span>${busy ? '正在转写并整理…' : '转写并整理'}</span>${icon('arrow')}</button></section>
  <div class="hotword-hint">${icon('book')}<span>${database.hotwords.some(word => word.enabled) ? `${database.hotwords.filter(word => word.enabled).length} 个热词已启用，会用于转写和整理` : '有独特的人名、产品名或专业术语？让 Notle 认识它们。'}</span><button class="text-button" id="manage-hotwords">管理热词 ${icon('arrow')}</button></div>
  <section class="result-section" aria-labelledby="result-title"><div class="result-heading"><div><span class="section-number">02</span><h2 id="result-title">让文字，清晰一点</h2></div>${selected ? `<span class="result-meta">${isDemo ? '示例内容 · 未调用 AI' : '已保存到转写记录'}</span>` : '<button id="demo-button" class="text-button">体验一段示例 '+icon('arrow')+'</button>'}</div><div id="result-content">${resultHTML()}</div></section>`;
}
function resultHTML() {
  if (!selected) return `<div class="empty-result">${icon('sparkle')}<div><strong>你的下一段好文字，从这里开始。</strong><p>录音、转写、去掉口水词，让表达回到重点。</p></div><span class="empty-dots">· · ·</span></div>`;
  return `${selected.warning ? `<div class="warning" role="alert">${escapeHTML(selected.warning)}</div>` : ''}<div class="comparison"><article class="text-card original-card"><div class="text-card-heading"><h3><span class="status-dot"></span>原始转写</h3><span>${selected.original.length} 字符</span></div><textarea readonly aria-label="原始转写">${escapeHTML(selected.original)}</textarea><div class="text-card-footer">保留原声里的每一个意思</div></article><article class="text-card polished-card"><div class="text-card-heading"><h3>${icon('sparkle')}整理结果</h3><span class="chip success">${selected.polished ? '已整理' : '待重试'}</span></div><textarea id="polished-text" aria-label="整理结果，可编辑后复制" placeholder="原始转写已保留，点击下方重新整理。">${escapeHTML(selected.polished || '')}</textarea><div class="text-card-footer"><span>可编辑后复制 · 编辑不会自动保存</span><div><button id="export-result" class="icon-button" aria-label="导出文字" title="导出文字" ${!selected.polished ? 'disabled' : ''}>${icon('download')}</button><button id="copy-result" class="copy-button" ${!selected.polished ? 'disabled' : ''}>${icon('copy')}复制</button></div></div></article></div><div class="result-actions"><span>${isDemo ? '示例展示整理前后的区别，真实结果由配置的 AI 生成。' : '保留原意，去掉赘词。重要信息建议对照原文确认。'}</span><button id="rewrite-button" class="text-button" ${isDemo || busy ? 'disabled' : ''}>${icon('sparkle')}重新整理</button></div>`;
}
function updateRecording() {
  if (view !== 'workspace') return;
  const button = document.querySelector<HTMLButtonElement>('#record-button'); if (!button) return;
  const active = recorder.state === 'recording';
  button.classList.toggle('recording', active); button.innerHTML = active ? '<span class="stop-square"></span>' : icon('mic');
  button.setAttribute('aria-label', active ? '停止录音' : '开始录音');
  button.disabled = busy || recorder.state === 'requesting' || recorder.state === 'stopping';
  const status = $('#recording-status');
  status.textContent = busy ? '正在转写并整理，较长录音可能需要几分钟…' : recorder.state === 'requesting' ? '请在浏览器提示中允许使用麦克风…' : recorder.state === 'stopping' ? '正在保存录音…' : active ? '正在聆听，尽管自由表达' : take ? '录音已就绪，回听一下或开始转写' : '不必打草稿，从第一句话开始';
  status.setAttribute('aria-live', 'polite');
  $('#recording-time').textContent = formatTime(active ? elapsed : take?.durationMs || 0);
  $('#recording-time').classList.toggle('active', active);
  $('#shortcut-hint').innerHTML = active ? '点击停止录音 <span>·</span> 快捷键仅在本页面内生效' : `点击开始录音 <span>或</span> <kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd><kbd>⇧</kbd><kbd>Space</kbd>`;
  for (const selector of ['#upload-button', '#process-button', '#rewrite-button']) { const element = document.querySelector<HTMLButtonElement>(selector); if (element) element.disabled = busy || recorder.state !== 'idle' || (selector === '#process-button' && !take) || (selector === '#rewrite-button' && isDemo); }
  document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(element => { element.disabled = busy; });
}
function bindWorkspace() {
  $('#manage-hotwords').onclick = () => changeView('hotwords');
  $('#record-button').onclick = () => { if (recorder.state === 'recording') recorder.stop(); else void recorder.start(); };
  $('#upload-button').onclick = () => $('#audio-file').click();
  $('#audio-file').onchange = event => {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const mime = ({ webm: 'audio/webm', mp4: 'audio/mp4', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' } as Record<string, string>)[extension];
    if (!mime || !file.size || file.size > 25_000_000) { toast('请选择不超过 25 MB 的 WebM、MP4、MP3、M4A、WAV 或 OGG 音频。', true); return; }
    if (take) URL.revokeObjectURL(take.url);
    const blob = new Blob([file], { type: mime }); take = { blob, name: file.name, durationMs: 0, url: URL.createObjectURL(blob) }; selected = undefined; isDemo = false;
    renderContent();
    const audio = document.querySelector<HTMLAudioElement>('audio'); if (audio) audio.onloadedmetadata = () => { if (take && Number.isFinite(audio.duration)) { take.durationMs = audio.duration * 1000; updateRecording(); } };
  };
  document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(button => { button.onclick = () => { style = button.dataset.style as Style; document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); }); }; });
  $('#process-button').onclick = async () => {
    if (!take || busy || !requireConfig()) return;
    busy = true; renderContent();
    try { selected = await transcribe(take, { ...config }, style); isDemo = false; await refreshState(); toast(selected.warning ? '转写已完成，整理需要重试。' : '整理好了，你的想法已成为文字。', !!selected.warning); }
    catch (error) { toast(messageOf(error), true); }
    finally { busy = false; renderContent(); if (selected) $('#result-title').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  };
  const demo = document.querySelector<HTMLButtonElement>('#demo-button'); if (demo) demo.onclick = () => { selected = { id: 'demo', createdAt: Date.now(), durationMs: 0, original: '嗯，我想说的是，那个，我们下周需要先做用户访谈，然后就是，嗯，把反馈整理一下。对了，记得周五之前给出第一版方案，不用急着开发，先确认方向。', polished: '下周先做用户访谈，再整理反馈。\n\n周五之前给出第一版方案。先确认方向，不用急着开发。', style: 'paragraphs', warning: null }; isDemo = true; renderContent(); };
  const retry = document.querySelector<HTMLButtonElement>('#rewrite-button'); if (retry) retry.onclick = async () => {
    if (!selected || isDemo || busy || !requireConfig()) return;
    busy = true; renderContent();
    try { selected = await rewrite(selected.id, { ...config }, style); await refreshState(); toast('已按当前风格重新整理。'); } catch (error) { toast(messageOf(error), true); } finally { busy = false; renderContent(); }
  };
  const copy = document.querySelector<HTMLButtonElement>('#copy-result'); if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText($('#polished-text') instanceof HTMLTextAreaElement ? ($('#polished-text') as HTMLTextAreaElement).value : ''); toast('已复制，可以去任何地方粘贴。'); } catch { ($('#polished-text') as HTMLTextAreaElement).select(); toast('浏览器未允许复制，文字已选中，请手动复制。', true); } };
  const exported = document.querySelector<HTMLButtonElement>('#export-result'); if (exported) exported.onclick = () => download(new Blob([($('#polished-text') as HTMLTextAreaElement).value], { type: 'text/plain;charset=utf-8' }), 'notle-notes.txt');
  const audioDownload = document.querySelector<HTMLButtonElement>('#download-audio'); if (audioDownload) audioDownload.onclick = () => { if (take) download(take.blob, take.name); };
  const reconnect = document.querySelector<HTMLButtonElement>('#retry-connection'); if (reconnect) reconnect.onclick = async () => { await refreshState(); renderContent(); };
}
function historyHTML() {
  return `<section class="intro"><div><div class="eyebrow"><span class="small-line"></span> YOUR WORDS, KEPT CLOSE</div><h1>每个想法，<span>都有回声。</span></h1><p>${database.records.length} 段表达，保存在运行服务的这台电脑。</p></div><button class="button primary" id="new-recording">${icon('mic')}开始录音</button></section><div class="history-heading"><h2>全部转写</h2><input id="history-search" type="search" placeholder="搜索你的文字…" aria-label="搜索转写记录" /></div><div id="history-list"></div>`;
}
function bindHistory() {
  $('#new-recording').onclick = () => changeView('workspace');
  $('#history-search').oninput = () => renderHistoryList(($('#history-search') as HTMLInputElement).value);
  renderHistoryList('');
}
function renderHistoryList(query: string) {
  const records = database.records.filter(item => `${item.original} ${item.polished || ''}`.toLowerCase().includes(query.toLowerCase()));
  $('#history-list').innerHTML = records.length ? records.map(item => `<article class="history-row"><div class="history-icon">${icon('file')}</div><button class="history-open" data-id="${escapeHTML(item.id)}"><strong>${escapeHTML((item.polished || item.original).slice(0, 65))}</strong><span>${new Date(item.createdAt).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}<i>·</i>${item.durationMs ? formatTime(item.durationMs) : '导入音频'}<i>·</i>${styles[item.style]}${!item.polished ? '<i>·</i>待整理' : ''}</span></button><button class="icon-button history-delete" data-id="${escapeHTML(item.id)}" aria-label="删除转写记录">${icon('trash')}</button></article>`).join('') : `<div class="history-empty">${icon('history')}<h3>${query ? '还没有找到匹配的文字' : '这里会留下你的好想法'}</h3><p>${query ? '试试更简短的关键词。' : '完成第一段转写后，就能在这里回看。'}</p></div>`;
  document.querySelectorAll<HTMLButtonElement>('.history-open').forEach(button => { button.onclick = () => { selected = database.records.find(item => item.id === button.dataset.id); if (selected) style = selected.style; isDemo = false; changeView('workspace'); }; });
  document.querySelectorAll<HTMLButtonElement>('.history-delete').forEach(button => { button.onclick = async () => { if (!window.confirm('删除这条文字记录？删除后无法恢复。')) return; button.disabled = true; try { await deleteRecord(button.dataset.id!); if (selected?.id === button.dataset.id) selected = undefined; await refreshState(); renderContent(); toast('记录已删除。'); } catch (error) { button.disabled = false; toast(messageOf(error), true); } }; });
}
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
function messageOf(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }
async function refreshState() { try { database = await loadState(); serverError = ''; } catch (error) { serverError = messageOf(error); } }
document.addEventListener('keydown', event => {
  if (($('#settings-dialog') as HTMLDialogElement).open || event.repeat || (event.target instanceof HTMLElement && event.target.matches('input,textarea,select,[contenteditable]'))) return;
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'Space' && view === 'workspace' && !busy) { event.preventDefault(); if (recorder.state === 'recording') recorder.stop(); else void recorder.start(); }
  if ((event.metaKey || event.ctrlKey) && event.key === '1') { event.preventDefault(); changeView('workspace'); }
});
window.addEventListener('pagehide', () => { recorder.dispose(); if (take) URL.revokeObjectURL(take.url); });
window.addEventListener('beforeunload', event => { if (busy || recorder.state !== 'idle' || (take && !selected)) event.preventDefault(); });
renderContent();
void refreshState().then(renderContent);
