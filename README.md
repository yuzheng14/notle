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

打开 **http://localhost:3000**，点击右上角「AI 设置」填写 API 地址、Key、转写模型和整理模型。默认配置为 OpenAI 的 `https://api.openai.com/v1`、`whisper-1`、`gpt-4o-mini`。也可改为提供相同接口的服务，两个模型均需该服务支持，不能只接入聊天接口。

1. 开始录音，允许浏览器访问麦克风，再点击停止。页面内也可用 `⌘/Ctrl + Shift + Space` 切换录音。
2. 回放或下载原始录音，选择自然表达、清晰分段或要点列表，点击「转写并整理」。
3. 对照原文检查整理结果，可编辑后复制或导出 TXT。编辑不会自动保存。
4. 从「转写记录」回看、搜索、重新整理或删除文字。最多保存 200 条。

录音每段最长 10 分钟、最大 25 MB；达到录音限制会自动停止。也可导入 25 MB 以内的 WebM、MP4、M4A、MP3、WAV、OGG。导入文件不限制时长，云端服务可能另有限制。浏览器录音需 localhost 或 HTTPS，主流新版 Chrome、Edge、Safari 可用，实际支持的录音容器由浏览器协商决定。

原始转写先保存，AI 整理失败后可单独重试。如果转写请求失败，音频仍保留在当前页面，可下载或重新提交。**未提交的录音不会跨页面刷新保存**；刷新或关闭页面前请下载原始录音。

## 热词词典

从侧栏进入「热词词典」，添加标准写法（例如 `Notle`）和常见误识别（例如 `诺特、诺特尔`）。可搜索、编辑、删除或停用词条；最多 100 个词，每词最多 10 个别名，每项最多 80 字。标准写法和别名不能与其他词条冲突，停用词条也保留其写法，避免启用后产生歧义。

启用词条会在转写时作为术语提示发给模型，整理时纠正别名并统一大小写。转写提示最多 1000 字，超出部分不加入识别提示，但仍用于文字整理。英文按单词边界匹配，重叠别名优先匹配最长写法，单次替换不级联。原始转写不被覆盖。热词提示不能保证模型一定识别正确；只有真实出现的内容才应整理为热词。

热词与历史共存于同一数据文件，旧版只有 records 字段的数据文件可直接读取。请仅将常见的误识别写法设为别名，过于宽泛的别名可能改变其他语句中的文字。

## 开发与验证

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

测试在系统分配的空闲端口启动独立服务与临时数据目录，使用浏览器模拟麦克风及本地 AI 替身，覆盖录音、回放、真实 Rust 上传链路、重试、复制、历史搜索、Key 不落盘、热词增改和启停、麦克风拒绝恢复及移动端布局。截图输出到 `.notle/qa-artifacts/`。它验证协议与交互，**不验证真实云端识别准确率**。测试不会操作日常使用的历史记录。

## 数据与配置

- `NOTLE_PORT`：端口，默认 `3000`，仅监听 `127.0.0.1`
- `NOTLE_DATA_DIR`：数据目录，默认 `.notle`；文字历史保存在 `state.json`
- `NOTLE_WEB_DIR`：静态资源目录，默认 `dist`
- `NOTLE_DEV_ORIGIN`：额外允许的开发页面来源，必须精确匹配协议、主机和端口

API Key 只存在于当前页面内存和处理请求的服务内存中，不进入磁盘、localStorage 或日志，刷新后需重新填写。API 地址和模型等非敏感偏好保存在 localStorage。音频不落盘，不保留到历史中。文字历史存于运行 Rust 服务的电脑，以单进程串行更新和原子替换写入 JSON；不支持多个服务进程共用同一数据文件。

提交转写时，录音和文字会发送给配置的 AI 服务。需使用 HTTPS API，本机模型服务可用 HTTP；不自动跟随重定向。重要信息仍需核对原文，AI 可能整理错误。第一版为本机个人工具，没有账号、多租户或公网部署支持。

## 目录

- `src/hotwords.rs`：热词校验、识别提示和别名纠正
- `web/hotwords.ts`：热词管理页面
- `src/provider.rs`：转写、文字整理和云端错误处理
- `src/lib.rs`：API、上传限制及来源校验
- `src/store.rs`：本地记录持久化
- `web/recorder.ts`：麦克风生命周期、音频容器协商和电平
- `web/main.ts`：工作台、结果、设置与历史交互
- `tests/pipeline.rs`：Rust HTTP 集成测试

API：`GET /api/state`、`POST /api/transcriptions`（multipart：audio、config、style、durationMs）、`POST /api/records/{id}/rewrite`、`DELETE /api/records/{id}`。config 为 baseUrl、apiKey、transcriptionModel、rewriteModel、language；style 为 natural、paragraphs、bullets。

热词 API：`POST /api/hotwords`、`PUT /api/hotwords/{id}`、`DELETE /api/hotwords/{id}`；输入为 term、aliases、enabled。`GET /api/state` 同时返回 records 和 hotwords。

接口依据：[文件转写](https://developers.openai.com/api/docs/guides/speech-to-text)、[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。
