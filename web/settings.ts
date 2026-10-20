import type { ApiConfig, MimoConfig, DoubaoConfig, RewriteConfig } from './types';
import { icon } from './ui';

type ProviderName = 'mimo' | 'doubao';
const defaults = () => ({
  selected: 'mimo' as ProviderName,
  mimo: { provider: 'mimo', baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: '', model: 'mimo-v2.5-asr', language: 'zh' } as MimoConfig,
  doubao: { provider: 'doubao', baseUrl: 'https://openspeech.bytedance.com/api/v3', apiKey: '', appId: '', accessToken: '', resourceId: 'volc.bigasr.auc_turbo', language: 'zh', auth: 'key' } as DoubaoConfig & { auth: 'key' | 'legacy' },
  deepseek: { baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-flash' } as RewriteConfig,
});

export const settingsHTML = `
<dialog id="settings-dialog" class="settings-dialog provider-dialog" aria-labelledby="settings-title">
  <form id="settings-form" autocomplete="off">
    <div class="dialog-heading"><div><div class="eyebrow">YOUR VOICE, YOUR MODELS</div><h2 id="settings-title">连接你的 AI</h2></div><button type="button" class="icon-button" id="settings-close" aria-label="关闭 AI 设置">${icon('close')}</button></div>
    <p class="muted">选一家服务转写录音，再交给 DeepSeek 去口水词、整理表达。</p>
    <section class="provider-section" aria-label="语音转写设置">
      <div class="provider-heading"><span class="section-number">01</span><h3>语音转写</h3><span class="chip">音频 → 文字</span></div>
      <label>转写服务<select name="selected" aria-label="转写服务"><option value="mimo">小米 MiMo</option><option value="doubao">豆包语音</option></select></label>
      <fieldset id="mimo-fields">
        <label>MiMo API Key<input name="mimo.apiKey" type="password" maxlength="4096" placeholder="填写小米 MiMo 开放平台密钥" /></label>
        <div class="settings-grid"><label>MiMo 转写模型<input name="mimo.model" required maxlength="120" spellcheck="false" /></label><label>MiMo 识别语言<select name="mimo.language"><option value="zh">中文</option><option value="">自动识别</option><option value="en">English</option></select></label></div>
        <p class="field-help">热词会在 DeepSeek 整理时纠正；MiMo ASR 当前不支持传入热词。</p>
      </fieldset>
      <fieldset id="doubao-fields" hidden disabled>
        <label>豆包鉴权方式<select name="doubao.auth"><option value="key">API Key（新版控制台）</option><option value="legacy">APP ID + Access Token（旧版控制台）</option></select></label>
        <fieldset id="doubao-key-fields"><label>豆包语音 API Key<input name="doubao.apiKey" type="password" maxlength="4096" placeholder="填写豆包语音密钥" /></label></fieldset>
        <fieldset id="doubao-legacy-fields" hidden disabled><div class="settings-grid"><label>豆包 APP ID<input name="doubao.appId" type="password" maxlength="4096" /></label><label>豆包 Access Token<input name="doubao.accessToken" type="password" maxlength="4096" /></label></div></fieldset>
        <div class="settings-grid"><label>豆包资源 ID<input name="doubao.resourceId" required maxlength="120" spellcheck="false" /></label><label>豆包识别语言<select name="doubao.language"><option value="zh">中文</option><option value="">自动识别（中英及方言）</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label></div>
        <p class="field-help">需开通「录音文件识别极速版」。请使用豆包语音控制台凭证；热词会一同用于识别。</p>
      </fieldset>
    </section>
    <section class="provider-section" aria-label="文字整理设置">
      <div class="provider-heading"><span class="section-number">02</span><h3>DeepSeek 整理</h3><span class="chip">文字 → 清晰表达</span></div>
      <div class="settings-grid"><label>DeepSeek API Key<input name="deepseek.apiKey" type="password" maxlength="4096" placeholder="填写 DeepSeek 开放平台密钥" /></label><label>DeepSeek 整理模型<input name="deepseek.model" required maxlength="120" spellcheck="false" /></label></div>
    </section>
    <details class="provider-advanced"><summary>高级设置 · API 地址</summary><label>MiMo API 地址<input name="mimo.baseUrl" type="url" spellcheck="false" /></label><label>豆包 API 地址<input name="doubao.baseUrl" type="url" spellcheck="false" /></label><label>DeepSeek API 地址<input name="deepseek.baseUrl" type="url" required spellcheck="false" /></label><p class="field-help">默认使用官方接口。如使用代理，分别填写对应协议的基础地址。</p></details>
    <div class="privacy-note">${icon('shield')}<p>密钥仅保存在当前页面内存，刷新后需重新填写。音频发送给所选转写服务；文字和启用的热词发送给 DeepSeek。</p></div>
    <div id="settings-error" class="inline-error" role="alert" hidden></div>
    <div class="dialog-actions"><button type="button" class="button secondary" id="settings-cancel">取消</button><button type="submit" class="button primary">保存设置 ${icon('arrow')}</button></div>
  </form>
</dialog>`;

export class AISettings {
  private value = defaults();
  private form: HTMLFormElement;
  private dialog: HTMLDialogElement;
  constructor(private onChange: () => void, private notify: (message: string, error?: boolean) => void) {
    // Copy an explicit allowlist of non-secret fields; never restore keys from storage.
    try {
      const saved = JSON.parse(localStorage.getItem('notle.providers.v1') || '{}');
      if (saved.selected === 'mimo' || saved.selected === 'doubao') this.value.selected = saved.selected;
      for (const name of ['mimo', 'doubao', 'deepseek'] as const) {
        for (const field of ['baseUrl', 'model', 'resourceId', 'language', 'auth'] as const) {
          if (field in this.value[name] && typeof saved[name]?.[field] === 'string') Object.assign(this.value[name], { [field]: saved[name][field] });
        }
      }
    } catch { /* Storage may be unavailable. */ }
    this.form = document.querySelector('#settings-form')!;
    this.dialog = document.querySelector('#settings-dialog')!;
    document.querySelector<HTMLButtonElement>('#settings-open')!.onclick = () => this.open();
    for (const id of ['#settings-close', '#settings-cancel']) document.querySelector<HTMLButtonElement>(id)!.onclick = () => this.dialog.close();
    this.field('selected').onchange = () => this.toggle();
    this.field('doubao.auth').onchange = () => this.toggle();
    this.form.onsubmit = event => { event.preventDefault(); this.save(); };
  }
  private field(name: string) { return this.form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement; }
  private toggle() {
    const mimo = this.field('selected').value === 'mimo';
    const legacy = this.field('doubao.auth').value === 'legacy';
    this.field('mimo.baseUrl').disabled = !mimo;
    this.field('doubao.baseUrl').disabled = mimo;
    for (const [id, enabled] of [['mimo-fields', mimo], ['doubao-fields', !mimo], ['doubao-key-fields', !legacy], ['doubao-legacy-fields', legacy]] as const) {
      const fields = document.getElementById(id) as HTMLFieldSetElement;
      fields.hidden = !enabled; fields.disabled = !enabled;
    }
  }
  open() {
    this.field('selected').value = this.value.selected;
    for (const name of ['mimo', 'doubao', 'deepseek'] as const) {
      for (const [key, value] of Object.entries(this.value[name])) {
        const field = this.form.elements.namedItem(`${name}.${key}`) as HTMLInputElement | null;
        if (field) field.value = value;
      }
    }
    document.querySelector<HTMLElement>('#settings-error')!.hidden = true;
    this.toggle(); this.dialog.showModal();
  }
  get config(): ApiConfig {
    const selected = this.value.selected;
    const { auth, ...doubao } = this.value.doubao;
    if (auth === 'key') { doubao.appId = ''; doubao.accessToken = ''; } else { doubao.apiKey = ''; }
    return { transcription: selected === 'mimo' ? { ...this.value.mimo } : doubao, rewrite: { ...this.value.deepseek } };
  }
  ready(rewriteOnly = false) {
    const config = this.config;
    const asr = config.transcription;
    return !!config.rewrite.apiKey && (rewriteOnly || !!asr.apiKey || (asr.provider === 'doubao' && !!asr.appId && !!asr.accessToken));
  }
  get label() { return `${this.value.selected === 'mimo' ? 'MiMo' : '豆包'} 转写 · DeepSeek 整理`; }
  require(rewriteOnly = false) {
    if (this.ready(rewriteOnly)) return true;
    this.open();
    const error = document.querySelector<HTMLElement>('#settings-error')!;
    error.textContent = rewriteOnly ? '重新整理只需填写 DeepSeek API Key。' : '请填写所选转写服务的密钥，以及 DeepSeek API Key。'; error.hidden = false;
    return false;
  }
  private save() {
    const next = defaults();
    next.selected = this.field('selected').value as ProviderName;
    for (const name of ['mimo', 'doubao', 'deepseek'] as const) {
      for (const key of Object.keys(next[name])) if (key !== 'provider') Object.assign(next[name], { [key]: this.field(`${name}.${key}`).value.trim() });
    }
    try {
      for (const base of [next[next.selected].baseUrl, next.deepseek.baseUrl]) {
        const url = new URL(base);
        if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error();
      }
    } catch {
      const error = document.querySelector<HTMLElement>('#settings-error')!;
      error.textContent = '请填写有效的 HTTPS API 地址。本机服务可用 HTTP；地址中不能包含账号、查询参数或片段。'; error.hidden = false;
      this.form.querySelector<HTMLDetailsElement>('details')!.open = true; return;
    }
    this.value = next;
    const { apiKey: _mimoKey, ...mimo } = next.mimo;
    const { apiKey: _doubaoKey, appId: _appId, accessToken: _token, ...doubao } = next.doubao;
    const { apiKey: _deepseekKey, ...deepseek } = next.deepseek;
    try { localStorage.setItem('notle.providers.v1', JSON.stringify({ selected: next.selected, mimo, doubao, deepseek })); }
    catch { this.notify('设置已用于当前页面，浏览器未允许保存偏好。', true); }
    this.dialog.close(); this.onChange(); this.notify(this.ready() ? 'AI 设置已保存，可以开始转写。' : 'AI 设置已保存，填写服务密钥后即可使用。');
  }
}
