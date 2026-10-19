use notle::{AppState, provider::Provider, router, store::Store};
use std::{path::PathBuf, sync::Arc};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port: u16 = std::env::var("NOTLE_PORT")
        .unwrap_or_else(|_| "3000".into())
        .parse()?;
    let data_dir =
        PathBuf::from(std::env::var("NOTLE_DATA_DIR").unwrap_or_else(|_| ".notle".into()));
    let web_root = PathBuf::from(std::env::var("NOTLE_WEB_DIR").unwrap_or_else(|_| "dist".into()));
    let state = AppState {
        store: Arc::new(Store::open(data_dir.join("state.json")).await?),
        provider: Provider::new()?,
    };
    let mut origins = vec![
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
    ];
    if let Ok(origin) = std::env::var("NOTLE_DEV_ORIGIN") {
        origins.push(origin);
    }
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    println!("Notle is ready at http://localhost:{port}");
    axum::serve(listener, router(state, web_root, origins))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
