use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
};
use notle::{
    hotwords::Hotword,
    model::{RewriteConfig, Style, TranscriptionConfig},
    provider::Provider,
};
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

#[derive(Clone)]
struct Mock {
    status: Arc<AtomicU64>,
}

async fn doubao(
    State(mock): State<Mock>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (HeaderMap, Json<Value>) {
    assert!(headers.get("authorization").is_none());
    if let Some(key) = headers.get("X-Api-Key") {
        assert_eq!(key, "doubao-key");
        assert!(headers.get("X-Api-App-Key").is_none());
    } else {
        assert_eq!(headers["X-Api-App-Key"], "app-id");
        assert_eq!(headers["X-Api-Access-Key"], "access-token");
    }
    assert_eq!(headers["X-Api-Resource-Id"], "volc.bigasr.auc_turbo");
    assert_eq!(headers["X-Api-Sequence"], "-1");
    assert_eq!(headers["X-Api-Request-Id"].to_str().unwrap().len(), 36);
    assert_eq!(body["audio"]["data"], "AP/+/Q==");
    assert_eq!(body["audio"]["format"], "wav");
    assert_eq!(body["audio"]["language"], "zh-CN");
    assert!(body["audio"].get("url").is_none());
    assert_eq!(body["request"]["model_name"], "bigmodel");
    assert_eq!(body["request"]["enable_ddc"], false);
    let context: Value =
        serde_json::from_str(body["request"]["corpus"]["context"].as_str().unwrap()).unwrap();
    assert_eq!(context, json!({"hotwords":[{"word":"Notle"}]}));
    let mut output = HeaderMap::new();
    let code = mock.status.load(Ordering::Relaxed);
    if code != 0 {
        output.insert("X-Api-Status-Code", code.to_string().parse().unwrap());
    }
    (
        output,
        Json(json!({"result":{"text":"嗯，今天不开会。"},"secret":"DO-NOT-LEAK"})),
    )
}

async fn incomplete() -> Json<Value> {
    Json(json!({"choices":[{"message":{"content":"不能当作完整结果"},"finish_reason":"length"}]}))
}

#[tokio::test]
async fn doubao_auth_hotwords_and_http200_business_errors() {
    let mock = Mock {
        status: Arc::new(AtomicU64::new(20_000_000)),
    };
    let app = Router::new()
        .route("/auc/bigmodel/recognize/flash", post(doubao))
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let provider = Provider::new().unwrap();
    let words = vec![
        Hotword {
            id: "1".into(),
            term: "Notle".into(),
            aliases: vec!["诺特".into()],
            enabled: true,
        },
        Hotword {
            id: "2".into(),
            term: "Disabled".into(),
            aliases: vec![],
            enabled: false,
        },
    ];
    let mut config = json!({"provider":"doubao","baseUrl":base,"apiKey":"doubao-key","resourceId":"volc.bigasr.auc_turbo","language":"zh"});
    for legacy in [false, true] {
        if legacy {
            config["apiKey"] = json!("");
            config["appId"] = json!("app-id");
            config["accessToken"] = json!("access-token");
        }
        let config: TranscriptionConfig = serde_json::from_value(config.clone()).unwrap();
        assert_eq!(
            provider
                .transcribe(&config, &[0, 255, 254, 253], "audio/wav", &words)
                .await
                .unwrap(),
            "嗯，今天不开会。"
        );
        for code in [0, 20_000_003, 45_000_151, 55_000_031, 45_000_001] {
            mock.status.store(code, Ordering::Relaxed);
            let error = provider
                .transcribe(&config, &[0, 255, 254, 253], "audio/wav", &words)
                .await
                .unwrap_err();
            assert_eq!(error.0, StatusCode::BAD_GATEWAY);
            assert!(!error.1.contains("DO-NOT-LEAK"));
        }
        mock.status.store(20_000_000, Ordering::Relaxed);
    }
    task.abort();
}

#[tokio::test]
async fn truncated_mimo_and_deepseek_results_are_rejected() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/chat/completions", post(incomplete)),
        )
        .await
        .unwrap();
    });
    let provider = Provider::new().unwrap();
    let asr: TranscriptionConfig = serde_json::from_value(json!({"provider":"mimo","baseUrl":base,"apiKey":"mimo-key","model":"mimo-v2.5-asr","language":""})).unwrap();
    let rewrite = RewriteConfig {
        base_url: base.clone(),
        api_key: "deepseek-key".into(),
        model: "deepseek-flash".into(),
    };
    assert!(
        provider
            .transcribe(&asr, &[1, 2, 3], "audio/mpeg", &[])
            .await
            .unwrap_err()
            .1
            .contains("截断")
    );
    assert!(
        provider
            .rewrite(&rewrite, "今天不开会。", Style::Natural, &[])
            .await
            .unwrap_err()
            .1
            .contains("截断")
    );
    task.abort();
}
