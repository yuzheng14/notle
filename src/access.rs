use axum::http::uri::Authority;
use reqwest::Url;

pub fn normalize_origin(value: &str) -> Result<String, &'static str> {
    let url = Url::parse(value.trim()).map_err(|_| "访问来源须为完整的 HTTP/HTTPS 地址。")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && local))
        || url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("访问来源须为 HTTPS（本机可用 HTTP），不能包含路径、账号、查询参数或片段。");
    }
    Ok(url.origin().ascii_serialization())
}

pub fn allows_host(value: &str, origins: &[String]) -> bool {
    if value.chars().any(|character| {
        character.is_whitespace() || matches!(character, '@' | '/' | '\\' | '?' | '#')
    }) {
        return false;
    }
    let Ok(authority) = value.parse::<Authority>() else {
        return false;
    };
    let host = authority.host();
    // Authority also accepts nonnumeric ports; those must not become an
    // apparent missing port and accidentally match an allowed HTTPS host.
    if authority.as_str() != host && authority.port_u16().is_none() {
        return false;
    }
    if host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" {
        return true;
    }
    origins
        .iter()
        .filter_map(|origin| Url::parse(origin).ok())
        .any(|origin| {
            origin
                .host_str()
                .is_some_and(|allowed| host.eq_ignore_ascii_case(allowed))
                && authority
                    .port_u16()
                    .is_none_or(|port| Some(port) == origin.port_or_known_default())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tunnel_hosts_are_explicit_and_keep_loopback_access() {
        let origins = vec!["https://dev3000.communist.win".into()];
        for host in [
            "localhost:3000",
            "127.0.0.1:3000",
            "dev3000.communist.win",
            "DEV3000.COMMUNIST.WIN:443",
        ] {
            assert!(allows_host(host, &origins), "{host}");
        }
        for host in [
            "other.communist.win",
            "dev3000.communist.win.evil.example",
            "dev3000.communist.win:8443",
            "dev3000.communist.win:abc",
            "dev3000.communist.win:65536",
            "user@dev3000.communist.win",
            "dev3000.communist.win/",
            "dev3000.communist.win#ignored",
        ] {
            assert!(!allows_host(host, &origins), "{host}");
        }
        assert!(!allows_host("dev3000.communist.win", &[]));
    }

    #[test]
    fn origins_are_normalized_and_invalid_settings_are_rejected() {
        assert_eq!(
            normalize_origin(" https://dev3000.communist.win:443/ "),
            Ok("https://dev3000.communist.win".into())
        );
        assert_eq!(
            normalize_origin("http://127.0.0.1:5173"),
            Ok("http://127.0.0.1:5173".into())
        );
        for origin in [
            "dev3000.communist.win",
            "http://dev3000.communist.win",
            "https://example.com/path",
            "https://user:secret@example.com",
            "https://example.com?key=secret",
            "https://example.com#ignored",
        ] {
            assert!(normalize_origin(origin).is_err(), "{origin}");
        }
    }
}
