use notle::{AppState, config::Config, provider::Provider, router, store::Store};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::load(Path::new("notle.config.json"))?;
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
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    let port = listener.local_addr()?.port();
    let mut origins = vec![
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
    ];
    origins.extend(config.allowed_origins);
    for name in ["NOTLE_ALLOWED_ORIGINS", "NOTLE_DEV_ORIGIN"] {
        if let Ok(value) = std::env::var(name) {
            for origin in value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                let origin = notle::access::normalize_origin(origin).map_err(|message| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        format!("{name}: {message}"),
                    )
                })?;
                if !origins.contains(&origin) {
                    origins.push(origin);
                }
            }
        }
    }
    println!("Notle is ready at http://localhost:{port}");
    axum::serve(listener, router(state, web_root, origins))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
