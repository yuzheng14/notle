// Reuses an already installed Playwright; never downloads tooling or browsers.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const artifacts = process.env.NOTLE_QA_ARTIFACTS || '.notle/qa-artifacts';
await mkdir(artifacts, { recursive: true });
const calls = { mimo: 0, doubao: 0, deepseek: 0 };
let failRewrite = true;
const raw = '嗯，那个，我们下周先做用户访谈，然后整理反馈。周五之前交第一版方案，不要直接开始开发。';
const provider = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  response.setHeader('Content-Type', 'application/json');
  const parsed = JSON.parse(body);
  const checkWav = encoded => {
    const wav = Buffer.from(encoded, 'base64');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    assert.ok(wav.length > 16000);
  };
  if (request.url === '/mimo/chat/completions') {
    calls.mimo++;
    assert.equal(request.headers['api-key'], 'mimo-test-key');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(parsed.model, 'mimo-v2.5-asr');
    checkWav(parsed.messages[0].content[0].input_audio.data);
    response.end(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }));
  } else if (request.url === '/doubao/auc/bigmodel/recognize/flash') {
    calls.doubao++;
    assert.equal(request.headers['x-api-key'], 'doubao-test-key');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers['x-api-resource-id'], 'volc.bigasr.auc_turbo');
    assert.equal(parsed.request.enable_ddc, false);
    assert.match(parsed.request.corpus.context, /Notle/);
    checkWav(parsed.audio.data);
    response.setHeader('X-Api-Status-Code', '20000000');
    response.end(JSON.stringify({ result: { text: raw } }));
  } else if (request.url === '/deepseek/chat/completions') {
    calls.deepseek++;
    assert.equal(request.headers.authorization, 'Bearer deepseek-test-key');
    assert.equal(request.headers['api-key'], undefined);
    assert.equal(parsed.model, 'deepseek-flash');
    assert.equal(parsed.thinking.type, 'disabled');
    assert.match(parsed.messages[1].content, /不要直接开始开发/);
    if (failRewrite) { response.statusCode = 429; response.end('{}'); return; }
    response.end(JSON.stringify({ choices: [{ message: { content: '下周先做用户访谈，再整理反馈。\n\n周五之前交第一版方案。不要直接开始开发。' }, finish_reason: 'stop' }] }));
  } else { response.statusCode = 404; response.end('{}'); }
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const port = provider.address().port;
const dataDirectory = `.notle/browser-qa-${process.pid}`;
const app = spawn('target/debug/notle', { env: { ...process.env, NOTLE_PORT: '0', NOTLE_DATA_DIR: dataDirectory }, stdio: 'pipe' });
let browser, page;
try {
  const applicationURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The isolated Rust server did not start.')), 10000);
    app.once('error', error => { clearTimeout(timer); reject(error); });
    app.once('exit', code => { clearTimeout(timer); reject(new Error(`The isolated Rust server exited (${code}).`)); });
    app.stdout.on('data', chunk => {
      const match = chunk.toString().match(/Notle is ready at (http:\/\/localhost:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 980 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  // Local Chromium's fake microphone can wait indefinitely on CoreAudio.
  // Supply a browser-generated audio track; keep real MediaRecorder/codec/upload.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext({ sinkId: { type: 'none' } });
      const destination = audio.createMediaStreamDestination();
      const oscillator = audio.createOscillator();
      oscillator.frequency.value = 440; oscillator.connect(destination); oscillator.start();
      await audio.resume();
      const track = destination.stream.getAudioTracks()[0]; const stop = track.stop.bind(track);
      track.stop = () => { stop(); oscillator.stop(); void audio.close(); };
      return destination.stream;
    };
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(applicationURL);
  await page.getByRole('heading', { name: '说出来，就有条理。' }).waitFor();
  await page.screenshot({ path: `${artifacts}/workspace.png`, fullPage: true });
  await page.getByRole('button', { name: '体验一段示例' }).click();
  assert.match(await page.getByLabel('整理结果，可编辑后复制').inputValue(), /不用急着开发/);
  await page.screenshot({ path: `${artifacts}/comparison.png`, fullPage: true });
  await page.getByRole('button', { name: '热词词典', exact: true }).click();
  await page.getByRole('button', { name: '添加热词', exact: false }).click();
  await page.getByLabel('标准写法').fill('Notle');
  await page.getByLabel('常见误识别（可选）').fill('诺特，诺特尔');
  await page.getByRole('button', { name: '保存热词' }).click();
  await page.getByText('Notle', { exact: true }).waitFor();
  await page.getByRole('button', { name: '编辑 Notle', exact: true }).click();
  await page.getByLabel('常见误识别（可选）').fill('诺特，诺特尔，notel');
  await page.getByRole('button', { name: '保存热词' }).click();
  await page.getByText('notel', { exact: true }).waitFor();
  await page.getByLabel('启用 Notle', { exact: true }).uncheck();
  await page.getByText('0 个已启用 / 1 个热词').waitFor();
  await page.getByLabel('启用 Notle', { exact: true }).check();
  await page.getByText('1 个已启用 / 1 个热词').waitFor();
  await page.screenshot({ path: `${artifacts}/hotwords.png`, fullPage: true });
  await page.getByRole('button', { name: '录音工作台', exact: true }).click();
  await page.getByRole('button', { name: 'AI 设置' }).click();
  await page.screenshot({ path: `${artifacts}/settings-mimo.png`, fullPage: true });
  await page.getByLabel('转写服务', { exact: true }).selectOption('doubao');
  await page.screenshot({ path: `${artifacts}/settings-doubao.png`, fullPage: true });
  await page.locator('[name="doubao.auth"]').selectOption('legacy');
  await page.getByLabel('豆包 APP ID', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('豆包语音 API Key', { exact: true }).isVisible(), false);
  await page.screenshot({ path: `${artifacts}/settings-doubao-legacy.png`, fullPage: true });
  await page.locator('[name="doubao.auth"]').selectOption('key');
  await page.getByLabel('转写服务', { exact: true }).selectOption('mimo');
  await page.getByLabel('MiMo API Key', { exact: true }).fill('mimo-test-key');
  await page.getByLabel('DeepSeek API Key', { exact: true }).fill('deepseek-test-key');
  await page.getByText('高级设置 · API 地址', { exact: true }).click();
  await page.getByLabel('MiMo API 地址', { exact: true }).fill(`http://127.0.0.1:${port}/mimo`);
  await page.getByLabel('DeepSeek API 地址', { exact: true }).fill(`http://127.0.0.1:${port}/deepseek`);
  await page.getByRole('button', { name: '保存设置' }).click();
  assert.ok(!(await page.evaluate(() => localStorage.getItem('notle.providers.v1'))).includes('test-key'));
  await page.getByRole('button', { name: '开始录音', exact: true }).click();
  await page.getByRole('button', { name: '停止录音', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#recording-time').textContent !== '00:00');
  await page.screenshot({ path: `${artifacts}/recording.png`, fullPage: true });
  await page.getByRole('button', { name: '停止录音', exact: true }).click();
  await page.getByLabel('录音回放').waitFor();
  await page.getByRole('button', { name: '转写并整理', exact: true }).click();
  await page.getByText('已保存到转写记录').waitFor();
  assert.match(await page.getByLabel('原始转写').inputValue(), /嗯，那个/);
  await page.getByRole('alert').filter({ hasText: '整理未完成' }).waitFor();
  failRewrite = false;
  await page.getByRole('button', { name: '重新整理', exact: true }).click();
  await page.getByText('已按当前风格重新整理。').waitFor();
  assert.match(await page.getByLabel('整理结果，可编辑后复制').inputValue(), /不要直接开始开发/);
  await page.getByRole('button', { name: '复制', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /不要直接开始开发/);
  await page.getByRole('button', { name: '转写记录' }).click();
  await page.getByLabel('搜索转写记录').fill('不存在的关键词');
  await page.getByRole('heading', { name: '还没有找到匹配的文字' }).waitFor();
  await page.getByLabel('搜索转写记录').fill('用户访谈');
  await page.locator('.history-open').click();
  await page.getByRole('button', { name: '重新整理', exact: true }).click();
  await page.getByText('已按当前风格重新整理。').waitFor();
  await page.screenshot({ path: `${artifacts}/transcribed.png`, fullPage: true });
  await page.getByRole('button', { name: 'AI 设置' }).click();
  await page.getByLabel('转写服务', { exact: true }).selectOption('doubao');
  await page.getByLabel('豆包语音 API Key', { exact: true }).fill('doubao-test-key');
  await page.getByLabel('豆包 API 地址', { exact: true }).fill(`http://127.0.0.1:${port}/doubao`);
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '转写并整理', exact: true }).click();
  await page.getByText('整理好了，你的想法已成为文字。').waitFor();
  assert.deepEqual(calls, { mimo: 1, doubao: 1, deepseek: 4 });
  assert.ok(!(await page.evaluate(() => localStorage.getItem('notle.providers.v1'))).includes('test-key'));
  await page.reload();
  await page.getByRole('button', { name: 'AI 设置' }).click();
  assert.equal(await page.getByLabel('豆包语音 API Key', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('DeepSeek API Key', { exact: true }).inputValue(), '');
  await page.getByLabel('转写服务', { exact: true }).selectOption('mimo');
  assert.equal(await page.getByLabel('MiMo API Key', { exact: true }).inputValue(), '');
  // Rewriting saved text requires only DeepSeek credentials.
  await page.getByLabel('DeepSeek API Key', { exact: true }).fill('deepseek-test-key');
  await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '转写记录' }).click();
  await page.locator('.history-open').first().click();
  await page.getByRole('button', { name: '重新整理', exact: true }).click();
  await page.getByText('已按当前风格重新整理。').waitFor();
  assert.deepEqual(calls, { mimo: 1, doubao: 1, deepseek: 5 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${artifacts}/mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: 'AI 设置' }).click();
  await page.locator('.provider-advanced').evaluate(element => { element.open = false; });
  await page.getByLabel('DeepSeek API Key', { exact: true }).fill('');
  await page.screenshot({ path: `${artifacts}/settings-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: '保存设置' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifacts}/settings-mobile-actions.png`, fullPage: true });
  await page.getByRole('button', { name: '关闭 AI 设置' }).click();
  await page.getByRole('button', { name: '热词词典', exact: true }).click();
  await page.screenshot({ path: `${artifacts}/hotwords-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const denied = await context.newPage();
  await denied.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test denied', 'NotAllowedError'); }; });
  await denied.goto(applicationURL);
  await denied.getByRole('button', { name: '开始录音', exact: true }).click();
  await denied.getByText('麦克风访问被拒绝，请在浏览器地址栏的权限设置中允许录音。').waitFor();
  assert.equal(await denied.getByRole('button', { name: '开始录音', exact: true }).isEnabled(), true);
  await denied.close();
  assert.deepEqual(errors, []);
  console.log('PASS: MediaRecorder → 16k mono PCM WAV → Rust → MiMo / Doubao → DeepSeek, isolated keys, failed rewrite recovery, DeepSeek-only retry after reload, copy/history/hotwords, microphone denial, desktop/mobile settings.');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true });
    console.error('Browser status:', await page.locator('#toast').textContent());
  }
  throw error;
} finally {
  await browser?.close(); app.kill('SIGTERM');
  await new Promise(resolve => provider.close(resolve));
  await rm(dataDirectory, { recursive: true, force: true });
}
