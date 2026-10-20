use crate::access::normalize_origin;
use serde::Deserialize;
use std::{fs, io, path::Path};

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub allowed_origins: Vec<String>,
}

impl Config {
    pub fn load(path: &Path) -> io::Result<Self> {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(error),
        };
        let config: Self = serde_json::from_slice(&bytes).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{}: {error}", path.display()),
            )
        })?;
        let mut allowed_origins = Vec::new();
        for origin in config.allowed_origins {
            let origin = normalize_origin(&origin).map_err(|message| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("{}: {message}", path.display()),
                )
            })?;
            if !allowed_origins.contains(&origin) {
                allowed_origins.push(origin);
            }
        }
        Ok(Self { allowed_origins })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_directory() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "notle-config-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn reads_normalizes_and_deduplicates_file_origins() {
        let directory = temporary_directory();
        let path = directory.join("notle.config.json");
        fs::write(&path, r#"{"allowedOrigins":["https://dev3000.communist.win:443/","https://dev3000.communist.win"]}"#).unwrap();
        let config = Config::load(&path).unwrap();
        assert_eq!(config.allowed_origins, ["https://dev3000.communist.win"]);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn missing_file_is_local_only_and_invalid_files_fail_loudly() {
        let directory = temporary_directory();
        let path = directory.join("notle.config.json");
        assert!(Config::load(&path).unwrap().allowed_origins.is_empty());
        for contents in [
            "not-json",
            r#"{"allowOrigins":[]}"#,
            r#"{"allowedOrigins":["http://untrusted.example"]}"#,
            r#"{"allowedOrigins":[123]}"#,
        ] {
            fs::write(&path, contents).unwrap();
            assert!(Config::load(&path).is_err(), "{contents}");
        }
        assert!(Config::load(&directory).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
