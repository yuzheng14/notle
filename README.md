# Notle

Not Only Type LEss. 浏览器录音 → 云端转写 → 去口水词和整理。Rust 负责业务、AI 请求与存储，TypeScript 负责浏览器录音和界面。

## Rust 服务

需要 Rust 1.85+。执行 `cargo run`，默认监听 `127.0.0.1:3000`。服务将托管 `dist/` 下的构建产物，浏览器工作台在下一层 PR 中提供。

- `NOTLE_PORT`：端口，默认 `3000`
- `NOTLE_DATA_DIR`：数据目录，默认 `.notle`，文字历史以 JSON 保存，最多 200 条
- `NOTLE_WEB_DIR`：静态资源目录，默认 `dist`
- `NOTLE_DEV_ORIGIN`：额外允许的本机开发页面来源

API：`GET /api/state`、`POST /api/transcriptions`（multipart：audio、config、style、durationMs）、`POST /api/records/{id}/rewrite`、`DELETE /api/records/{id}`。config 包含 baseUrl、apiKey、transcriptionModel、rewriteModel、language。style 可为 natural、paragraphs、bullets。

云端采用 OpenAI 兼容的 `/audio/transcriptions` 和 `/chat/completions` 接口；两种模型必须由配置的服务支持。上传最大 25 MB。HTTPS 可用，本机模型服务允许 HTTP。不自动跟随重定向。原始转写先落盘，整理失败后可单独重试。

API Key 不落盘、不写日志；录音仅在处理请求时保留于内存中。音频、转写和热词会发送给用户配置的云端服务。文字历史存于运行 Rust 服务的电脑。第一版为本机个人工具，没有账号、多租户或公网部署支持。

验证：`cargo fmt --check`、`cargo test`、`cargo clippy --all-targets -- -D warnings`。
