use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

impl Provider {
    pub(super) async fn doubao(
        &self,
        config: &TranscriptionConfig,
        bytes: &[u8],
        format: &str,
        hotwords: &[Hotword],
    ) -> Result<String, AppError> {
        let TranscriptionConfig::Doubao {
            base_url,
            api_key,
            app_id,
            access_token,
            resource_id,
            language,
        } = config
        else {
            unreachable!()
        };
        let url = endpoint(base_url, "auc/bigmodel/recognize/flash")?;
        model_name(resource_id)?;
        let language = match language.as_str() {
            "" => "",
            "zh" => "zh-CN",
            "en" => "en-US",
            "ja" => "ja-JP",
            "ko" => "ko-KR",
            _ => return Err(AppError::bad("不支持的豆包识别语言。")),
        };
        let mut request = self.client.post(url);
        if !api_key.is_empty() {
            if !app_id.is_empty() || !access_token.is_empty() {
                return Err(AppError::bad(
                    "豆包 API Key 与旧版 APP ID / Access Token 请只填写一组。",
                ));
            }
            credential(api_key)?;
            request = request.header("X-Api-Key", api_key);
        } else {
            credential(app_id)?;
            credential(access_token)?;
            request = request
                .header("X-Api-App-Key", app_id)
                .header("X-Api-Access-Key", access_token);
        }
        // Unique UUID-shaped correlation ID, not a credential or security token.
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let id = (stamp << 32) | u128::from(REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed));
        let hex = format!("{id:032x}");
        let request_id = format!(
            "{}-{}-4{}-a{}-{}",
            &hex[..8],
            &hex[8..12],
            &hex[13..16],
            &hex[17..20],
            &hex[20..]
        );
        let words: Vec<_> = hotwords
            .iter()
            .filter(|word| word.enabled)
            .map(|word| json!({"word":word.term}))
            .collect();
        let mut body = json!({
            "user":{"uid":"notle"},
            "audio":{"data":base64(bytes),"format":format},
            "request":{"model_name":"bigmodel","enable_itn":true,"enable_punc":true,"enable_ddc":false}
        });
        if !language.is_empty() {
            body["audio"]["language"] = json!(language);
        }
        if !words.is_empty() {
            body["request"]["corpus"] = json!({"context":json!({"hotwords":words}).to_string()});
        }
        let result = response(
            request
                .header("X-Api-Resource-Id", resource_id)
                .header("X-Api-Request-Id", request_id)
                .header("X-Api-Sequence", "-1")
                .json(&body)
                .send()
                .await,
        )
        .await?;
        // Doubao can return HTTP 200 for failed recognition; inspect the business status.
        match result
            .headers()
            .get("X-Api-Status-Code")
            .and_then(|value| value.to_str().ok())
        {
            Some("20000000") => {}
            Some("20000003" | "45000002") => {
                return Err(AppError::upstream("豆包没有识别到语音，请检查录音后重试。"));
            }
            Some("45000151") => {
                return Err(AppError::upstream("豆包无法读取该音频格式，请重新录音。"));
            }
            Some("45000001") => {
                return Err(AppError::upstream("豆包请求参数无效，请检查语音服务配置。"));
            }
            Some("55000031") => return Err(AppError::upstream("豆包服务繁忙，请稍后重试。")),
            _ => {
                return Err(AppError::upstream(
                    "豆包识别失败，请检查语音服务密钥、资源权限或稍后重试。",
                ));
            }
        }
        #[derive(Deserialize)]
        struct Transcript {
            result: Text,
        }
        #[derive(Deserialize)]
        struct Text {
            text: String,
        }
        let result: Transcript = decode(result).await?;
        Ok(result.result.text)
    }
}
