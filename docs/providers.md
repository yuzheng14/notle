# 转写与整理接口

Rust 将语音转写和文字整理分别配置、鉴权。一次转写只调用所选的 MiMo 或豆包，随后将原始转写保存，再调用 DeepSeek。不会因失败自动改用另一家服务。密钥不参与存储或日志序列化。

## 转写请求

`POST /api/transcriptions` 使用 multipart：`audio` 为 WAV 或 MP3（最大 25 MB），`durationMs` 不超过 600000，`style` 为 `natural`、`paragraphs` 或 `bullets`，`config` 是以下 JSON 字符串。浏览器将录音或导入文件转为 16 kHz、单声道、16 位 PCM WAV。

MiMo：

```json
{
  "transcription": {
    "provider": "mimo",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "apiKey": "<MiMo API Key>",
    "model": "mimo-v2.5-asr",
    "language": "zh"
  },
  "rewrite": {
    "baseUrl": "https://api.deepseek.com",
    "apiKey": "<DeepSeek API Key>",
    "model": "deepseek-flash"
  }
}
```

豆包替换 `transcription`：

```json
{
  "provider": "doubao",
  "baseUrl": "https://openspeech.bytedance.com/api/v3",
  "apiKey": "<豆包语音 API Key>",
  "resourceId": "volc.bigasr.auc_turbo",
  "language": "zh"
}
```

旧版豆包控制台可省略或清空 `apiKey`，改传 `appId`、`accessToken`，两种鉴权不能同时使用。需要开通录音文件识别极速版资源权限。语音服务密钥与火山方舟聊天密钥不同。

MiMo 的 `language` 支持 `zh`、`en` 或空字符串（自动）；豆包另支持 `ja`、`ko`，自动模式为空时使用中英及方言识别。MiMo 只接收单个音频输入，不发送未公开支持的热词或文本提示；豆包把启用的标准词传入 `request.corpus.context`。两条路径的后续 DeepSeek 整理均使用标准词与别名。豆包关闭 `enable_ddc`，避免在原始结果阶段先去掉口水词。

## 单独重新整理

`POST /api/records/{id}/rewrite` 的 JSON 为 `{"config": {"baseUrl": "https://api.deepseek.com", "apiKey": "<DeepSeek API Key>", "model": "deepseek-flash"}, "style": "paragraphs"}`。只需 DeepSeek 配置，不需要重新提交音频或转写服务密钥。DeepSeek 使用非思考模式，保留原意、数字、否定与不确定性。

豆包 HTTP 200 响应仍需 `X-Api-Status-Code: 20000000` 才视为成功；空音频、静音、格式错误、服务繁忙与缺少业务状态均返回可理解的错误。MiMo / DeepSeek 被截断或未正常结束的结果不作为完整文字保存。云端响应体、地址和鉴权头不会通过错误消息回传。

此版本替换原先同一组 OpenAI 兼容配置的请求结构；旧的 `baseUrl/apiKey/transcriptionModel/rewriteModel/language` 扁平配置不再接受，需与新的前端一起发布。已有文字历史和热词数据无需迁移。

## 官方协议依据

- [MiMo ASR API](https://mimo.mi.com/docs/en-US/api/audio/Speech-Recognition)：单音频 Chat Completions、WAV/MP3、`mimo-v2.5-asr`。
- [豆包录音文件极速版 HTTP](https://docs.volcengine.com/docs/DoubaoVoice/LargemodelrecordingfileLiterecognitionAPI?lang=zh)：Base64 直传、新旧鉴权及业务状态。
- [豆包语境词典参数](https://docs.volcengine.com/docs/DoubaoVoice/recording-file-recognition-lite-http?lang=zh)：热词、语言与语义顺滑选项。
- [DeepSeek API 快速开始](https://api-docs.deepseek.com/quick_start/pricing-details-usd)与[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)：`deepseek-flash`、独立 Bearer Key 与 `thinking.type: disabled`。默认模型依据 2026-10-20 官方文档，可在设置中调整。
