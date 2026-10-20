use super::*;
use serde_json::json;

impl Provider {
    pub(super) async fn mimo(
        &self,
        base: &str,
        key: &str,
        model: &str,
        language: &str,
        bytes: &[u8],
        format: &str,
    ) -> Result<String, AppError> {
        let url = endpoint(base, "chat/completions")?;
        credential(key)?;
        model_name(model)?;
        if !matches!(language, "" | "zh" | "en") {
            return Err(AppError::bad("MiMo 目前支持中文、英文或自动识别。"));
        }
        // MiMo ASR accepts one audio part, not a multipart transcription or text prompt.
        let body = json!({
            "model": model, "stream": false,
            "messages": [{"role":"user", "content":[{"type":"input_audio", "input_audio":{"data":base64(bytes),"format":format}}]}],
            "asr_options":{"language":if language.is_empty() { "auto" } else { language }}
        });
        let result: Completion = decode(
            response(
                self.client
                    .post(url)
                    .header("api-key", key)
                    .json(&body)
                    .send()
                    .await,
            )
            .await?,
        )
        .await?;
        result.text()
    }
}
