import type { Hotword } from './types';
import { request } from './api';
import { icon, escapeHTML } from './ui';

export function renderHotwords(words: Hotword[], onChanged: () => Promise<void>, notify: (message: string, error?: boolean) => void) {
  const content = document.querySelector<HTMLElement>('#content')!;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => content.querySelector<T>(selector)!;
  content.innerHTML = `<section class="intro"><div><div class="eyebrow"><span class="small-line"></span> WORDS THAT MATTER TO YOU</div><h1>你的词汇，<span>它都懂。</span></h1><p>让人名、产品名和专业术语，回到正确的写法。</p></div><button id="add-hotword" class="button primary">＋ 添加热词</button></section>
    <div class="glossary-explainer"><div class="glossary-mark">Aa<span>↗</span></div><div><h2>一次记住，每次说对。</h2><p>热词会作为识别提示发送给转写模型；整理时会纠正常见误识别，统一为你设定的标准写法。</p><span>例如：诺特尔 → Notle　·　拉斯特 → Rust</span></div></div>
    <div class="history-heading"><div class="glossary-heading"><h2>我的词典</h2><span class="chip">${words.filter(word => word.enabled).length} 个已启用 / ${words.length} 个热词</span></div><input id="hotword-search" type="search" placeholder="搜索热词或误识别…" aria-label="搜索热词" /></div>
    <div id="hotword-list"></div><div class="glossary-footnote">最多 100 个热词，每词最多 10 个误识别写法。提示词长度有限，识别效果取决于模型；原始转写始终保留。</div>
    <dialog id="hotword-dialog" class="settings-dialog" aria-labelledby="hotword-title"><form id="hotword-form"><div class="dialog-heading"><div><div class="eyebrow">YOUR PERSONAL DICTIONARY</div><h2 id="hotword-title">添加热词</h2></div><button id="hotword-close" type="button" class="icon-button" aria-label="关闭热词编辑">${icon('close')}</button></div><p class="muted">把那些容易听错的词，变成你熟悉的写法。</p><label>标准写法<input name="term" required maxlength="80" placeholder="例如：Notle" autocomplete="off" /></label><label>常见误识别（可选）<textarea name="aliases" rows="3" placeholder="例如：诺特，诺特尔"></textarea></label><p class="field-help">多个写法用逗号或换行分隔。每个写法最多 80 字。</p><label class="checkbox-label"><input type="checkbox" name="enabled" checked />启用此热词</label><div id="hotword-error" class="inline-error" role="alert" hidden></div><div class="dialog-actions"><button id="hotword-cancel" type="button" class="button secondary">取消</button><button id="hotword-save" type="submit" class="button primary">保存热词 ${icon('check')}</button></div></form></dialog>`;
  let editing: Hotword | undefined;
  const dialog = $<HTMLDialogElement>('#hotword-dialog');
  function open(word?: Hotword) {
    editing = word; $('#hotword-title').textContent = word ? '编辑热词' : '添加热词';
    const form = $<HTMLFormElement>('#hotword-form');
    (form.elements.namedItem('term') as HTMLInputElement).value = word?.term || '';
    (form.elements.namedItem('aliases') as HTMLTextAreaElement).value = word?.aliases.join('，') || '';
    (form.elements.namedItem('enabled') as HTMLInputElement).checked = word?.enabled ?? true;
    $('#hotword-error').hidden = true; dialog.showModal();
  }
  $('#add-hotword').onclick = () => open();
  $('#hotword-close').onclick = $('#hotword-cancel').onclick = () => dialog.close();
  $('#hotword-form').onsubmit = async event => {
    event.preventDefault();
    const form = $<HTMLFormElement>('#hotword-form');
    const term = (form.elements.namedItem('term') as HTMLInputElement).value.trim();
    const aliases = (form.elements.namedItem('aliases') as HTMLTextAreaElement).value.split(/[,，;；\n]/).map(item => item.trim()).filter(Boolean);
    const enabled = (form.elements.namedItem('enabled') as HTMLInputElement).checked;
    const save = $<HTMLButtonElement>('#hotword-save'); save.disabled = true;
    try {
      await request(`/hotwords${editing ? `/${encodeURIComponent(editing.id)}` : ''}`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term, aliases, enabled }) });
      dialog.close(); await onChanged(); notify(editing ? '热词已更新。' : '热词已添加，下次转写就能使用。');
    } catch (error) { $('#hotword-error').textContent = error instanceof Error ? error.message : '热词保存失败。'; $('#hotword-error').hidden = false; save.disabled = false; }
  };
  function list(query: string) {
    const filtered = words.filter(word => `${word.term} ${word.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    $('#hotword-list').innerHTML = filtered.length ? `<div class="glossary-table"><div class="glossary-table-header"><span>标准写法</span><span>常见误识别</span><span>状态</span><span>操作</span></div>${filtered.map(word => `<article class="glossary-row ${word.enabled ? '' : 'disabled'}"><div class="glossary-term">${escapeHTML(word.term)}</div><div class="alias-list">${word.aliases.length ? word.aliases.map(alias => `<span>${escapeHTML(alias)}</span>`).join('') : '<small>仅提示标准写法</small>'}</div><label class="switch-label"><input type="checkbox" class="hotword-toggle" data-id="${escapeHTML(word.id)}" aria-label="启用 ${escapeHTML(word.term)}" ${word.enabled ? 'checked' : ''} /><span class="switch-track"></span></label><div class="glossary-actions"><button class="text-button hotword-edit" data-id="${escapeHTML(word.id)}" aria-label="编辑 ${escapeHTML(word.term)}">编辑</button><button class="icon-button hotword-delete" data-id="${escapeHTML(word.id)}" aria-label="删除 ${escapeHTML(word.term)}">${icon('trash')}</button></div></article>`).join('')}</div>` : `<div class="history-empty">${icon('book')}<h3>${query ? '没有找到这个词' : '从一个专属词汇开始'}</h3><p>${query ? '试试标准写法或常见误识别。' : '添加常用的人名、品牌名或技术术语，让每次表达更准确。'}</p></div>`;
    content.querySelectorAll<HTMLButtonElement>('.hotword-edit').forEach(button => { button.onclick = () => open(words.find(word => word.id === button.dataset.id)); });
    content.querySelectorAll<HTMLInputElement>('.hotword-toggle').forEach(input => { input.onchange = async () => {
      const word = words.find(word => word.id === input.dataset.id)!; input.disabled = true;
      try { await request(`/hotwords/${encodeURIComponent(word.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term: word.term, aliases: word.aliases, enabled: input.checked }) }); await onChanged(); }
      catch (error) { input.checked = word.enabled; input.disabled = false; notify(error instanceof Error ? error.message : '热词更新失败。', true); }
    }; });
    content.querySelectorAll<HTMLButtonElement>('.hotword-delete').forEach(button => { button.onclick = async () => {
      const word = words.find(word => word.id === button.dataset.id)!;
      if (!window.confirm(`删除热词「${word.term}」？`)) return;
      button.disabled = true;
      try { await request(`/hotwords/${encodeURIComponent(word.id)}`, { method: 'DELETE' }); await onChanged(); notify('热词已删除。'); }
      catch (error) { button.disabled = false; notify(error instanceof Error ? error.message : '删除失败。', true); }
    }; });
  }
  $('#hotword-search').oninput = () => list($<HTMLInputElement>('#hotword-search').value);
  list('');
}
