use notle::{AppState, provider::Provider, router, store::Store};
use reqwest::Client;
use serde_json::json;
use std::sync::Arc;

#[tokio::test]
async fn configured_tunnel_serves_pages_and_allows_only_matching_api_origins() {
    let directory = std::env::temp_dir().join(format!(
        "notle-access-{}-{}",
        std::process::id(),
        notle::model::now_ms()
    ));
    tokio::fs::create_dir_all(&directory).await.unwrap();
    tokio::fs::write(directory.join("index.html"), "Notle access test")
        .await
        .unwrap();
    let store = Arc::new(Store::open(directory.join("state.json")).await.unwrap());
    let state = AppState {
        store: store.clone(),
        provider: Provider::new().unwrap(),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let config_path = directory.join("notle.config.json");
    tokio::fs::write(
        &config_path,
        r#"{"allowedOrigins":["https://dev3000.communist.win"]}"#,
    )
    .await
    .unwrap();
    let config = notle::config::Config::load(&config_path).unwrap();
    let app = router(state, directory.clone(), config.allowed_origins);
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = Client::new();

    let page = client
        .get(&base)
        .header("Host", "dev3000.communist.win")
        .send()
        .await
        .unwrap();
    assert_eq!(page.status(), 200);
    assert_eq!(page.text().await.unwrap(), "Notle access test");

    let saved = client
        .post(format!("{base}/api/hotwords"))
        .header("Host", "dev3000.communist.win")
        .header("Origin", "https://dev3000.communist.win")
        .json(&json!({"term":"TunnelTest"}))
        .send()
        .await
        .unwrap();
    assert_eq!(saved.status(), 200);

    for origin in [
        "https://untrusted.example",
        "http://dev3000.communist.win",
        "https://dev3000.communist.win.evil.example",
    ] {
        let denied = client
            .post(format!("{base}/api/hotwords"))
            .header("Host", "dev3000.communist.win")
            .header("Origin", origin)
            .json(&json!({"term":"ShouldNotBeSaved"}))
            .send()
            .await
            .unwrap();
        assert_eq!(denied.status(), 403);
    }
    assert_eq!(store.snapshot().await.hotwords.len(), 1);

    let forged = client
        .get(format!("{base}/api/state"))
        .header("Host", "untrusted.example")
        .header("X-Forwarded-Host", "dev3000.communist.win")
        .send()
        .await
        .unwrap();
    assert_eq!(forged.status(), 403);

    let loopback = client
        .get(format!("{base}/api/state"))
        .send()
        .await
        .unwrap();
    assert_eq!(loopback.status(), 200);
    task.abort();
    tokio::fs::remove_dir_all(directory).await.unwrap();
}
