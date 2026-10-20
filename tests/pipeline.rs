use axum::{Json, Router, extract::State, http::HeaderMap, routing::post};
use notle::{AppState, model::Record, provider::Provider, router, store::Store};
use reqwest::{
    Client,
    multipart::{Form, Part},
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone)]
struct Mock {
    fail: Arc<AtomicBool>,
}
async fn transcribe(headers: HeaderMap, Json(body): Json<Value>) -> Json<Value> {
    assert_eq!(headers["api-key"], "DO-NOT-LEAK-mimo-key");
    assert!(headers.get("authorization").is_none());
    assert_eq!(body["model"], "mimo-v2.5-asr");
    assert_eq!(body["asr_options"]["language"], "zh");
    assert_eq!(
        body["messages"][0]["content"][0]["input_audio"]["data"],
        "AQID"
    );
    assert_eq!(
        body["messages"][0]["content"][0]["input_audio"]["format"],
        "wav"
    );
    Json(
        json!({"choices":[{"message":{"content":"嗯，诺特尔今天不开会，下周二再确认 3 个方案。"},"finish_reason":"stop"}]}),
    )
}
async fn rewrite(
    State(mock): State<Mock>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (axum::http::StatusCode, Json<Value>) {
    assert_eq!(headers["authorization"], "Bearer DO-NOT-LEAK-deepseek-key");
    assert!(headers.get("api-key").is_none());
    assert_eq!(body["model"], "deepseek-flash");
    assert_eq!(body["thinking"]["type"], "disabled");
    assert!(
        body["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("否定")
    );
    assert!(
        body["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("今天不开会")
    );
    if mock.fail.load(Ordering::Relaxed) {
        (
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error":"DO-NOT-LEAK-secret-key"})),
        )
    } else {
        (
            axum::http::StatusCode::OK,
            Json(
                json!({"choices":[{"message":{"content":"诺特尔今天不开会，下周二再确认 3 个方案。"},"finish_reason":"stop"}]}),
            ),
        )
    }
}
async fn serve(app: Router) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (url, task)
}

#[tokio::test]
async fn raw_transcript_survives_failed_rewrite_and_can_be_retried() {
    let mock = Mock {
        fail: Arc::new(AtomicBool::new(true)),
    };
    let (upstream, mock_task) = serve(
        Router::new()
            .route("/mimo/chat/completions", post(transcribe))
            .route("/deepseek/chat/completions", post(rewrite))
            .with_state(mock.clone()),
    )
    .await;
    let directory = std::env::temp_dir().join(format!(
        "notle-test-{}-{}",
        std::process::id(),
        notle::model::now_ms()
    ));
    let path = directory.join("state.json");
    let store = Arc::new(Store::open(path.clone()).await.unwrap());
    let state = AppState {
        store: store.clone(),
        provider: Provider::new().unwrap(),
    };
    let (base, task) = serve(router(
        state,
        PathBuf::from("missing-test-assets"),
        vec!["http://localhost:5173".into()],
    ))
    .await;
    let client = Client::new();
    let word: Value = client
        .post(format!("{base}/api/hotwords"))
        .json(&json!({"term":"Notle", "aliases":["诺特", "诺特尔"], "enabled":true}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(word["term"], "Notle");
    let collision = client
        .post(format!("{base}/api/hotwords"))
        .json(&json!({"term":"Other", "aliases":["notle"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(collision.status(), 400);
    let config = json!({
        "transcription":{"provider":"mimo","baseUrl":format!("{upstream}/mimo"),"apiKey":"DO-NOT-LEAK-mimo-key","model":"mimo-v2.5-asr","language":"zh"},
        "rewrite":{"baseUrl":format!("{upstream}/deepseek"),"apiKey":"DO-NOT-LEAK-deepseek-key","model":"deepseek-flash"}
    });
    let form = Form::new()
        .part(
            "audio",
            Part::bytes(vec![1, 2, 3])
                .file_name("voice.wav")
                .mime_str("audio/wav")
                .unwrap(),
        )
        .text("config", config.to_string())
        .text("durationMs", "4000")
        .text("style", "natural");
    let response = client
        .post(format!("{base}/api/transcriptions"))
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let record: Record = response.json().await.unwrap();
    assert!(record.polished.is_none());
    assert!(record.original.contains("今天不开会"));
    assert!(record.warning.as_ref().unwrap().contains("限流"));
    let saved = tokio::fs::read_to_string(&path).await.unwrap();
    assert!(!saved.contains("DO-NOT-LEAK"));
    let reloaded = Store::open(path.clone()).await.unwrap().snapshot().await;
    assert_eq!(reloaded.records[0].original, record.original);
    mock.fail.store(false, Ordering::Relaxed);
    let retry = client
        .post(format!("{base}/api/records/{}/rewrite", record.id))
        .json(&json!({"config":config["rewrite"],"style":"paragraphs"}))
        .send()
        .await
        .unwrap();
    assert!(retry.status().is_success());
    let rewritten: Record = retry.json().await.unwrap();
    assert!(rewritten.polished.unwrap().contains("Notle今天不开会"));
    assert!(rewritten.original.contains("诺特尔"));
    assert!(rewritten.warning.is_none());
    assert_eq!(store.snapshot().await.records.len(), 1);
    let foreign = client
        .get(format!("{base}/api/state"))
        .header("Origin", "https://untrusted.example")
        .send()
        .await
        .unwrap();
    assert_eq!(foreign.status(), 403);
    let foreign_host = client
        .get(format!("{base}/api/state"))
        .header("Host", "untrusted.example")
        .send()
        .await
        .unwrap();
    assert_eq!(foreign_host.status(), 403);
    let state = client
        .get(format!("{base}/api/state"))
        .send()
        .await
        .unwrap();
    assert_eq!(state.headers()["cache-control"], "no-store");
    let invalid = client
        .post(format!("{base}/api/transcriptions"))
        .multipart(Form::new().text("config", "{}"))
        .send()
        .await
        .unwrap();
    assert_eq!(invalid.status(), 400);
    let deleted = client
        .delete(format!("{base}/api/records/{}", record.id))
        .send()
        .await
        .unwrap();
    assert_eq!(deleted.status(), 204);
    assert!(store.snapshot().await.records.is_empty());
    let disabled = client
        .put(format!(
            "{base}/api/hotwords/{}",
            word["id"].as_str().unwrap()
        ))
        .json(&json!({"term":"Notle","aliases":["诺特尔"],"enabled":false}))
        .send()
        .await
        .unwrap();
    assert!(disabled.status().is_success());
    let reloaded = Store::open(path.clone()).await.unwrap().snapshot().await;
    assert!(!reloaded.hotwords[0].enabled);
    let deleted_word = client
        .delete(format!(
            "{base}/api/hotwords/{}",
            word["id"].as_str().unwrap()
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(deleted_word.status(), 204);
    assert!(store.snapshot().await.hotwords.is_empty());
    task.abort();
    mock_task.abort();
    tokio::fs::remove_dir_all(directory).await.unwrap();
}

#[tokio::test]
async fn corrupt_storage_is_not_silently_reset() {
    let directory = std::env::temp_dir().join(format!(
        "notle-corrupt-{}-{}",
        std::process::id(),
        notle::model::now_ms()
    ));
    tokio::fs::create_dir_all(&directory).await.unwrap();
    let path = directory.join("state.json");
    tokio::fs::write(&path, b"not-json").await.unwrap();
    assert!(Store::open(path.clone()).await.is_err());
    assert_eq!(tokio::fs::read(&path).await.unwrap(), b"not-json");
    tokio::fs::remove_dir_all(directory).await.unwrap();
}

#[test]
fn pre_hotword_data_files_remain_readable() {
    let old: notle::model::Database = serde_json::from_str(r#"{"records":[]}"#).unwrap();
    assert!(old.hotwords.is_empty());
}
