use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Style {
    #[default]
    Natural,
    Paragraphs,
    Bullets,
}

impl Style {
    pub fn instruction(self) -> &'static str {
        match self {
            Self::Natural => "保持自然语气，输出简洁、流畅的正文。",
            Self::Paragraphs => "根据话题分成清晰段落，必要时添加简短标题。",
            Self::Bullets => "按逻辑整理为要点列表，保留细节和因果关系。",
        }
    }
}

// Deliberately no Debug or Serialize: credentials must not enter logs or storage.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiConfig {
    pub transcription: TranscriptionConfig,
    pub rewrite: RewriteConfig,
}

#[derive(Clone, Deserialize)]
#[serde(
    tag = "provider",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TranscriptionConfig {
    Mimo {
        base_url: String,
        api_key: String,
        model: String,
        language: String,
    },
    Doubao {
        base_url: String,
        #[serde(default)]
        api_key: String,
        #[serde(default)]
        app_id: String,
        #[serde(default)]
        access_token: String,
        resource_id: String,
        language: String,
    },
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RewriteConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub created_at: u64,
    pub duration_ms: u64,
    pub original: String,
    pub polished: Option<String>,
    pub style: Style,
    pub warning: Option<String>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    pub records: Vec<Record>,
    #[serde(default)]
    pub hotwords: Vec<crate::hotwords::Hotword>,
}
