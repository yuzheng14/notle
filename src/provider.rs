mod deepseek;
mod doubao;
mod mimo;

use crate::{
    error::AppError,
    hotwords::Hotword,
    model::{RewriteConfig, Style, TranscriptionConfig},
};
use reqwest::{Client, Response, Url};
use serde::Deserialize;
use std::time::Duration;

#[derive(Clone)]
pub struct Provider {
    client: Client,
}

impl Provider {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(180))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
        })
    }

    pub async fn transcribe(
        &self,
        config: &TranscriptionConfig,
        bytes: &[u8],
        mime: &str,
        hotwords: &[Hotword],
    ) -> Result<String, AppError> {
        let format = match mime {
            "audio/wav" | "audio/x-wav" => "wav",
            "audio/mpeg" => "mp3",
            _ => return Err(AppError::bad("MiMo 和豆包转写需要 WAV 或 MP3 音频。")),
        };
        let text = match config {
            TranscriptionConfig::Mimo {
                base_url,
                api_key,
                model,
                language,
            } => {
                self.mimo(base_url, api_key, model, language, bytes, format)
                    .await?
            }
            TranscriptionConfig::Doubao { .. } => {
                self.doubao(config, bytes, format, hotwords).await?
            }
        };
        checked_text(&text, "没有识别到语音，请确认麦克风输入后重试。")
    }

    pub async fn rewrite(
        &self,
        config: &RewriteConfig,
        original: &str,
        style: Style,
        hotwords: &[Hotword],
    ) -> Result<String, AppError> {
        self.deepseek(config, original, style, hotwords).await
    }
}

fn endpoint(base: &str, path: &str) -> Result<String, AppError> {
    let url = Url::parse(base).map_err(|_| AppError::bad("API 地址格式不正确。"))?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && local))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::bad(
            "API 地址必须为 HTTPS（本机服务可用 HTTP），且不含账号、查询参数或片段。",
        ));
    }
    Ok(format!("{}/{}", base.trim_end_matches('/'), path))
}

fn credential(value: &str) -> Result<(), AppError> {
    if value.trim().is_empty()
        || value.len() > 4096
        || !value.bytes().all(|byte| (33..=126).contains(&byte))
    {
        return Err(AppError::bad(
            "请在 AI 设置中填写有效的服务密钥；密钥不能包含空白或非英文字符。",
        ));
    }
    Ok(())
}

fn model_name(value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() || value.len() > 120 || value.chars().any(char::is_control) {
        return Err(AppError::bad("请填写有效的模型名称或资源 ID。"));
    }
    Ok(())
}

async fn response(result: Result<Response, reqwest::Error>) -> Result<Response, AppError> {
    let response = result.map_err(|error| {
        AppError::upstream(if error.is_timeout() {
            "AI 服务响应超时，请稍后重试。"
        } else {
            "无法连接 AI 服务，请检查地址与网络。"
        })
    })?;
    if !response.status().is_success() {
        return Err(AppError::upstream(match response.status().as_u16() {
            401 | 403 => "服务密钥无效或没有模型访问权限。",
            404 => "找不到 AI 接口或模型，请检查 API 地址和模型名称。",
            413 => "AI 服务拒绝了音频大小，请缩短录音。",
            429 => "AI 服务限流或额度不足，请稍后重试或检查账户。",
            _ => "AI 服务返回异常，请稍后重试。",
        }));
    }
    Ok(response)
}

async fn decode<T: serde::de::DeserializeOwned>(mut response: Response) -> Result<T, AppError> {
    // Never forward upstream bodies, URLs, or headers: they may contain secrets.
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::upstream("读取 AI 响应失败。"))?
    {
        if bytes.len() + chunk.len() > 512 * 1024 {
            return Err(AppError::upstream("AI 响应过长。"));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::upstream("AI 返回了无法解析的响应，请检查接口兼容性。"))
}

fn checked_text(text: &str, empty_message: &'static str) -> Result<String, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::upstream(empty_message));
    }
    if text.chars().count() > 50_000 {
        return Err(AppError::upstream("AI 返回文字过长，请分段处理。"));
    }
    Ok(text.to_owned())
}

#[derive(Deserialize)]
struct Completion {
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
struct Choice {
    message: Message,
    finish_reason: String,
}
#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}
impl Completion {
    fn text(self) -> Result<String, AppError> {
        let choice = self
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| AppError::upstream("AI 没有返回文字内容。"))?;
        match choice.finish_reason.as_str() {
            "stop" => Ok(choice.message.content.unwrap_or_default()),
            "length" => Err(AppError::upstream(
                "AI 文字结果被截断，请缩短音频或换用支持更长输出的模型。",
            )),
            _ => Err(AppError::upstream("AI 未能完整生成文字，请稍后重试。")),
        }
    }
}

// RFC 4648 standard Base64, encoding only. Avoids adding a new SDK/codec dependency.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0];
        let b = chunk.get(1).copied().unwrap_or(0);
        let c = chunk.get(2).copied().unwrap_or(0);
        output.push(ALPHABET[(a >> 2) as usize] as char);
        output.push(ALPHABET[(((a & 3) << 4) | (b >> 4)) as usize] as char);
        output.push(if chunk.len() > 1 {
            ALPHABET[(((b & 15) << 2) | (c >> 6)) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            ALPHABET[(c & 63) as usize] as char
        } else {
            '='
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base64_rfc4648_vectors_and_binary() {
        for (input, expected) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(input.as_bytes()), expected);
        }
        assert_eq!(base64(&[0, 255, 254, 253]), "AP/+/Q==");
    }
    #[test]
    fn validates_transport_and_header_credentials() {
        assert!(endpoint("https://api.example.com/v1", "chat/completions").is_ok());
        assert!(endpoint("http://127.0.0.1:8000/v1", "chat/completions").is_ok());
        for base in [
            "http://example.com/v1",
            "file:///tmp/secret",
            "https://key:secret@example.com",
            "https://example.com?key=secret",
        ] {
            assert!(endpoint(base, "chat/completions").is_err());
        }
        for key in ["", "bad\nkey", "密钥", "key with space"] {
            assert!(credential(key).is_err());
        }
    }
}
