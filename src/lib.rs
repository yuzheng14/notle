pub mod access;
pub mod config;
pub mod error;
pub mod hotwords;
pub mod model;
pub mod provider;
pub mod store;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use error::AppError;
use model::{ApiConfig, Record, Style, now_ms};
use provider::Provider;
use serde::Deserialize;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use store::Store;
use tower_http::services::ServeDir;

pub const MAX_AUDIO_BYTES: usize = 25_000_000;
static RECORD_SEQUENCE: AtomicU64 = AtomicU64::new(0);
#[derive(Clone)]
pub struct AppState {
    pub store: Arc<Store>,
    pub provider: Provider,
}

pub fn router(state: AppState, web_root: PathBuf, allowed_origins: Vec<String>) -> Router {
    let host_origins = allowed_origins.clone();
    let api = Router::new()
        .route("/state", get(snapshot))
        .route("/hotwords", post(create_hotword))
        .route(
            "/hotwords/{id}",
            axum::routing::put(update_hotword).delete(delete_hotword),
        )
        .route("/transcriptions", post(transcribe))
        .route("/records/{id}", axum::routing::delete(delete_record))
        .route("/records/{id}/rewrite", post(rewrite_record))
        .layer(DefaultBodyLimit::max(MAX_AUDIO_BYTES + 65_536))
        .layer(middleware::from_fn(move |request: Request, next: Next| {
            let allowed = allowed_origins.clone();
            async move {
                if let Some(origin) = request.headers().get(header::ORIGIN) {
                    if !origin
                        .to_str()
                        .is_ok_and(|value| allowed.iter().any(|entry| entry == value))
                    {
                        return (
                            StatusCode::FORBIDDEN,
                            Json(serde_json::json!({"error":"不允许的请求来源。"})),
                        )
                            .into_response();
                    }
                }
                let mut response = next.run(request).await;
                response
                    .headers_mut()
                    .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                response
            }
        }));
    Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new(web_root))
        .with_state(state)
        .layer(middleware::from_fn(move |request: Request, next: Next| {
            security_headers(request, next, host_origins.clone())
        }))
}
async fn security_headers(request: Request, next: Next, allowed_origins: Vec<String>) -> Response {
    // A tunnel must pass both the configured Host and browser Origin checks.
    // Forwarded headers do not grant access to an otherwise untrusted host.
    let allowed_host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| access::allows_host(host, &allowed_origins));
    if !allowed_host {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error":"该域名不在允许的访问范围内。"})),
        )
            .into_response();
    }
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    response
        .headers_mut()
        .insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    response.headers_mut().insert("content-security-policy", HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"));
    response
}
async fn snapshot(State(state): State<AppState>) -> Json<model::Database> {
    Json(state.store.snapshot().await)
}
async fn delete_record(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.store.delete_record(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn transcribe(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<Record>, AppError> {
    let mut audio = None;
    let mut config = None;
    let mut style = Style::Natural;
    let mut duration_ms = 0;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| AppError::bad("音频上传失败或超过 25 MB。"))?
    {
        match field.name().unwrap_or_default() {
            "audio" => {
                if audio.is_some() {
                    return Err(AppError::bad("只能上传一个音频文件。"));
                }
                let mime = field
                    .content_type()
                    .unwrap_or_default()
                    .split(';')
                    .next()
                    .unwrap_or_default()
                    .to_owned();
                let extension = match mime.as_str() {
                    "audio/webm" | "video/webm" => "webm",
                    "audio/mp4" | "video/mp4" | "audio/x-m4a" => "mp4",
                    "audio/mpeg" => "mp3",
                    "audio/wav" | "audio/x-wav" => "wav",
                    "audio/ogg" => "ogg",
                    _ => return Err(AppError::bad("支持 WebM、MP4、MP3、WAV 或 OGG 音频。")),
                };
                let filename = format!("recording.{extension}");
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| AppError::bad("音频读取失败或超过 25 MB。"))?;
                if bytes.is_empty() || bytes.len() > MAX_AUDIO_BYTES {
                    return Err(AppError::bad("音频不能为空且不能超过 25 MB。"));
                }
                audio = Some((bytes.to_vec(), mime, filename));
            }
            "config" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| AppError::bad("配置读取失败。"))?;
                config = Some(
                    serde_json::from_str::<ApiConfig>(&value)
                        .map_err(|_| AppError::bad("AI 配置格式不正确。"))?,
                );
            }
            "style" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| AppError::bad("整理风格读取失败。"))?;
                style = serde_json::from_value(serde_json::Value::String(value))
                    .map_err(|_| AppError::bad("不支持的整理风格。"))?;
            }
            "durationMs" => {
                duration_ms = field
                    .text()
                    .await
                    .map_err(|_| AppError::bad("时长读取失败。"))?
                    .parse::<u64>()
                    .map_err(|_| AppError::bad("录音时长不正确。"))?;
            }
            _ => return Err(AppError::bad("上传包含未知字段。")),
        }
    }
    let config = config.ok_or_else(|| AppError::bad("缺少 AI 配置。"))?;
    let (bytes, mime, filename) = audio.ok_or_else(|| AppError::bad("请先录音或上传音频。"))?;
    let hotwords = state.store.snapshot().await.hotwords;
    let original = state
        .provider
        .transcribe(&config, bytes, &mime, &filename, &hotwords)
        .await?;
    let mut record = Record {
        id: format!(
            "{}-{}",
            now_ms(),
            RECORD_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ),
        created_at: now_ms(),
        duration_ms,
        original,
        polished: None,
        style,
        warning: None,
    };
    // Save the raw transcript before the second cloud request; rewrite failure is recoverable.
    state.store.save_record(record.clone()).await?;
    match state
        .provider
        .rewrite(&config, &record.original, style, &hotwords)
        .await
    {
        Ok(text) => record.polished = Some(text),
        Err(error) => record.warning = Some(format!("转写已保存，整理未完成：{}", error.1)),
    }
    if state.store.save_record(record.clone()).await.is_err() {
        record.warning = Some("结果已生成，但本地保存失败。请立即复制结果。".into());
    }
    Ok(Json(record))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RewriteRequest {
    config: ApiConfig,
    style: Style,
}
async fn rewrite_record(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<RewriteRequest>,
) -> Result<Json<Record>, AppError> {
    let mut record = state
        .store
        .snapshot()
        .await
        .records
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(AppError::missing)?;
    let hotwords = state.store.snapshot().await.hotwords;
    record.polished = Some(
        state
            .provider
            .rewrite(&input.config, &record.original, input.style, &hotwords)
            .await?,
    );
    record.style = input.style;
    record.warning = None;
    state.store.save_record(record.clone()).await?;
    Ok(Json(record))
}

async fn create_hotword(
    State(state): State<AppState>,
    Json(input): Json<hotwords::HotwordInput>,
) -> Result<Json<hotwords::Hotword>, AppError> {
    Ok(Json(state.store.put_hotword(None, input).await?))
}
async fn update_hotword(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<hotwords::HotwordInput>,
) -> Result<Json<hotwords::Hotword>, AppError> {
    Ok(Json(state.store.put_hotword(Some(&id), input).await?))
}
async fn delete_hotword(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.store.delete_hotword(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}
