# Notle

Not Only Type LEss. 把说出口的想法变成清晰文字。支持浏览器录音、云端转写、去口水词、三种整理风格、个人热词词典及本机文字历史。

Rust 负责 AI 调用、校验、业务和存储；原生 TypeScript 负责浏览器录音和界面，不依赖前端 UI 框架。

## 启动

需要 Rust 1.85+、Node.js 20.19+ 或 22.12+（推荐现有的 Node 24）。

```sh
npm ci
npm run build
cargo run --locked
```

打开 **http://localhost:3000**，点击右上角「AI 设置」：

- 转写选择小米 **MiMo**（默认 `mimo-v2.5-asr`）或**豆包语音**（录音文件识别极速版，资源 `volc.bigasr.auc_turbo`）。每次只调用所选的一家。
- 文字整理固定使用 **DeepSeek**，默认模型为 `deepseek-flash`，关闭思考模式。分别填写转写服务与 DeepSeek 的密钥。
- 豆包支持新版语音 API Key，或旧版 APP ID + Access Token。需开通极速版资源；使用豆包语音服务凭证。
- 默认使用各家官方地址；如需代理，在「高级设置」分别修改地址。服务、模型和语言偏好可保存，密钥刷新后需重新填写。

已有文字可只填写 DeepSeek 密钥后重新整理，无需转写密钥。官方协议和 API 请求示例见 [providers.md](docs/providers.md)。

1. 开始录音，允许浏览器访问麦克风，再点击停止。页面内也可用 `⌘/Ctrl + Shift + Space` 切换录音。
2. 回放或下载原始录音，选择自然表达、清晰分段或要点列表，点击「转写并整理」。
3. 对照原文检查整理结果，可编辑后复制或导出 TXT。编辑不会自动保存。
4. 从「转写记录」回看、搜索、重新整理或删除文字。最多保存 200 条。

录音每段最长 10 分钟、最大 25 MB；达到录音限制会自动停止。也可导入 25 MB 以内的 WebM、MP4、M4A、MP3、WAV、OGG。导入与录音均限制 10 分钟。提交前在浏览器内转换为 16 kHz、单声道、16 位 PCM WAV（10 分钟约 19.2 MB），兼容两家转写服务；回放和下载保留原始音频。导入格式还需当前浏览器能够解码。浏览器录音需 localhost 或 HTTPS，主流新版 Chrome、Edge、Safari 可用，实际支持的录音容器由浏览器协商决定。

原始转写先保存，AI 整理失败后可单独重试。如果转写请求失败，音频仍保留在当前页面，可下载或重新提交。**未提交的录音不会跨页面刷新保存**；刷新或关闭页面前请下载原始录音。

## 热词词典

从侧栏进入「热词词典」，添加标准写法（例如 `Notle`）和常见误识别（例如 `诺特、诺特尔`）。可搜索、编辑、删除或停用词条；最多 100 个词，每词最多 10 个别名，每项最多 80 字。标准写法和别名不能与其他词条冲突，停用词条也保留其写法，避免启用后产生歧义。

豆包会将启用的标准词作为热词传入识别；MiMo ASR 当前不支持热词提示。两种转写路径都会在 DeepSeek 整理时纠正别名并统一大小写。服务端可能按自身上下文限制截断识别提示。英文按单词边界匹配，重叠别名优先匹配最长写法，单次替换不级联。原始转写不被覆盖。热词提示不能保证模型一定识别正确；只有真实出现的内容才应整理为热词。

热词与历史共存于同一数据文件，旧版只有 records 字段的数据文件可直接读取。请仅将常见的误识别写法设为别名，过于宽泛的别名可能改变其他语句中的文字。

## 开发与验证

### Cloudflare Tunnel 访问

服务仍监听本机 `127.0.0.1:3000`，Tunnel 的上游指向 `http://127.0.0.1:3000`。在项目根目录创建 `notle.config.json`，精确配置外部访问来源：

```json
{
  "allowedOrigins": ["https://dev3000.communist.win"]
}
```

然后在项目根目录运行 `cargo run --locked`，启动时会自动读取该文件，无需传入环境变量。修改配置后需重启服务；若直接运行已有二进制，先执行 `cargo build --locked`，再运行 `./target/debug/notle`。

多个来源写成数组项。此配置同时允许该来源的 Host 与浏览器 Origin，不需要开放任意域名、跨域 CORS 或修改监听地址。本机 localhost/127.0.0.1 访问保持可用。配置文件不存在时仅允许本机访问；JSON、字段或来源无效时启动会报错，不会静默忽略。实际配置文件已被 Git 忽略，可参考 `notle.config.example.json` 创建本机配置，避免把本机访问范围作为其他安装的默认值。

来源列表不提供登录鉴权；这个单用户工具通过 Tunnel 访问时，可在 Cloudflare Access 限定访问人员。

### 本机开发

前端开发需要两个终端：

```sh
NOTLE_DEV_ORIGIN=http://127.0.0.1:5173 cargo run --locked
```

```sh
npm run dev
```

使用 Vite 输出的 `http://127.0.0.1:5173`；API 请求代理到 Rust 的 3000 端口。

```sh
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
npm run typecheck
npm run build
```

`scripts/browser-smoke.mjs` 可复用已安装的 Playwright 和匹配的 Chromium，无需把它们添加到本项目。运行前 `cargo build --locked`、`npm run build`，再指定现有模块位置：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright node scripts/browser-smoke.mjs
```

测试在系统分配的空闲端口启动独立服务与临时数据目录，使用浏览器合成音轨和本地 AI 服务替身（真实 MediaRecorder 编码，不依赖本机麦克风），覆盖录音、回放、WAV 编码参数、MiMo/豆包两条真实 Rust HTTP 链路、DeepSeek 整理失败恢复、刷新后仅凭 DeepSeek 重试、密钥隔离与不落盘、复制、历史搜索、热词增改和启停、麦克风拒绝恢复及移动端设置布局。截图输出到 `.notle/qa-artifacts/`。它验证协议与交互，**不验证真实云端识别准确率**。测试不会操作日常使用的历史记录。

## 数据与配置

启动时读取当前工作目录中的 `notle.config.json`，`allowedOrigins` 配置额外允许的 HTTPS 来源。下面两个来源环境变量仍可选用，与文件配置合并去重；日常启动无需设置它们。

- `NOTLE_PORT`：端口，默认 `3000`，仅监听 `127.0.0.1`
- `NOTLE_DATA_DIR`：数据目录，默认 `.notle`；文字历史保存在 `state.json`
- `NOTLE_WEB_DIR`：静态资源目录，默认 `dist`
- `NOTLE_ALLOWED_ORIGINS`：额外允许的 HTTPS 访问来源，逗号分隔，同时用于 Host 与 Origin 校验
- `NOTLE_DEV_ORIGIN`：额外允许的开发页面来源，必须精确匹配协议、主机和端口

API Key 只存在于当前页面内存和处理请求的服务内存中，不进入磁盘、localStorage 或日志，刷新后需重新填写。API 地址和模型等非敏感偏好保存在 localStorage。音频不落盘，不保留到历史中。文字历史存于运行 Rust 服务的电脑，以单进程串行更新和原子替换写入 JSON；不支持多个服务进程共用同一数据文件。

提交时，音频只发给所选的 MiMo 或豆包，文字和启用的热词发给 DeepSeek；豆包识别还会接收启用的标准热词。需使用 HTTPS API，本机模型服务可用 HTTP；不自动跟随重定向。重要信息仍需核对原文，AI 可能整理错误。第一版为单用户个人工具，没有应用内账号或多租户鉴权；通过 Tunnel 访问的配置见上文。

## 目录

- `src/hotwords.rs`：热词校验、识别提示和别名纠正
- `web/hotwords.ts`：热词管理页面
- `src/provider.rs`、`src/provider/`：共用 HTTP 处理及 MiMo、豆包、DeepSeek 协议适配
- `src/lib.rs`：API、上传限制及来源校验
- `src/store.rs`：本地记录持久化
- `web/recorder.ts`：麦克风生命周期、音频容器协商和电平
- `web/audio.ts`：浏览器解码、重采样与 PCM WAV 封装
- `web/settings.ts`：转写服务选择、独立凭证与非敏感偏好
- `web/main.ts`：工作台、结果与历史交互
- `tests/pipeline.rs`：Rust HTTP 集成测试

API：`GET /api/state`、`POST /api/transcriptions`（multipart：audio、config、style、durationMs）、`POST /api/records/{id}/rewrite`、`DELETE /api/records/{id}`。转写 config 包含 transcription 与 rewrite，重试 config 只包含 DeepSeek 配置，见 [协议说明](docs/providers.md)；style 为 natural、paragraphs、bullets。

热词 API：`POST /api/hotwords`、`PUT /api/hotwords/{id}`、`DELETE /api/hotwords/{id}`；输入为 term、aliases、enabled。`GET /api/state` 同时返回 records 和 hotwords。

接口依据及兼容范围见 [官方协议链接](docs/providers.md#官方协议依据)。
