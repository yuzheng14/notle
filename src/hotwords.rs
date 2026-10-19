use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub(crate) fn new_id() -> String {
    format!(
        "h-{}-{}",
        crate::model::now_ms(),
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

fn enabled() -> bool {
    true
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hotword {
    pub id: String,
    pub term: String,
    pub aliases: Vec<String>,
    pub enabled: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HotwordInput {
    pub term: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default = "enabled")]
    pub enabled: bool,
}
impl HotwordInput {
    pub fn validate(mut self, existing: &[Hotword], id: Option<&str>) -> Result<Self, AppError> {
        self.term = self.term.trim().to_owned();
        let valid = |text: &str| {
            !text.is_empty() && text.chars().count() <= 80 && !text.chars().any(char::is_control)
        };
        if !valid(&self.term) {
            return Err(AppError::bad("热词须为 1–80 字，且不能包含控制字符。"));
        }
        if self.aliases.len() > 10 {
            return Err(AppError::bad("每个热词最多 10 个误识别写法。"));
        }
        let mut seen = HashSet::from([self.term.to_lowercase()]);
        let mut aliases = Vec::new();
        for alias in self.aliases {
            let alias = alias.trim().to_owned();
            if !valid(&alias) {
                return Err(AppError::bad(
                    "每个误识别写法须为 1–80 字，且不能包含控制字符。",
                ));
            }
            if seen.insert(alias.to_lowercase()) {
                aliases.push(alias);
            }
        }
        for word in existing.iter().filter(|word| Some(word.id.as_str()) != id) {
            if std::iter::once(&word.term)
                .chain(word.aliases.iter())
                .any(|value| seen.contains(&value.to_lowercase()))
            {
                return Err(AppError::bad(
                    "该热词或误识别写法已被其他条目使用，请避免冲突。",
                ));
            }
        }
        self.aliases = aliases;
        Ok(self)
    }
}

// Longest match, single pass. Inserted words are never processed a second time.
// ASCII word boundaries keep a short alias like `AI` from changing `MAIL`.
pub fn apply(text: &str, words: &[Hotword]) -> String {
    let mut patterns: Vec<(&str, &str)> = words
        .iter()
        .filter(|word| word.enabled)
        .flat_map(|word| {
            std::iter::once((word.term.as_str(), word.term.as_str())).chain(
                word.aliases
                    .iter()
                    .map(move |alias| (alias.as_str(), word.term.as_str())),
            )
        })
        .collect();
    patterns.sort_by_key(|(alias, _)| std::cmp::Reverse(alias.len()));
    let ascii_word = |character: char| character.is_ascii_alphanumeric() || character == '_';
    let mut result = String::with_capacity(text.len());
    let mut position = 0;
    while position < text.len() {
        let matched = patterns.iter().find(|(alias, _)| {
            let end = position + alias.len();
            if !text
                .get(position..end)
                .is_some_and(|value| value.eq_ignore_ascii_case(alias))
            {
                return false;
            }
            let starts_word = alias.chars().next().is_some_and(ascii_word);
            let ends_word = alias.chars().last().is_some_and(ascii_word);
            let before = text[..position].chars().next_back();
            let after = text[end..].chars().next();
            !(starts_word && before.is_some_and(ascii_word)
                || ends_word && after.is_some_and(ascii_word))
        });
        if let Some((alias, term)) = matched {
            result.push_str(term);
            position += alias.len();
        } else {
            let character = text[position..].chars().next().unwrap();
            result.push(character);
            position += character.len_utf8();
        }
    }
    result
}

pub fn transcription_prompt(words: &[Hotword]) -> String {
    let mut prompt =
        String::from("以下是可能出现的专有名词，请结合实际语音识别，不要添加未说出的内容：");
    let mut added = false;
    for word in words.iter().filter(|word| word.enabled) {
        if prompt.chars().count() + word.term.chars().count() + 1 > 1000 {
            break;
        }
        prompt.push_str(&word.term);
        prompt.push('、');
        added = true;
    }
    if added {
        prompt.trim_end_matches('、').to_owned()
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn word(term: &str, aliases: &[&str]) -> Hotword {
        Hotword {
            id: term.into(),
            term: term.into(),
            aliases: aliases.iter().map(|value| (*value).into()).collect(),
            enabled: true,
        }
    }
    #[test]
    fn corrects_longest_alias_without_cascading_or_damaging_words() {
        let words = vec![
            word("Notle", &["诺特", "诺特尔"]),
            word("Rust", &["拉斯特"]),
            word("人工智能", &["AI"]),
        ];
        assert_eq!(
            apply("诺特尔用拉斯特写的，notle 支持 AI。MAIL 不变。", &words),
            "Notle用Rust写的，Notle 支持 人工智能。MAIL 不变。"
        );
        assert_eq!(apply("你好🦀，嗯没有热词", &words), "你好🦀，嗯没有热词");
        let cascade = vec![word("B", &["A"]), word("C", &["B"])];
        assert_eq!(apply("A", &cascade), "B");
    }
    #[test]
    fn disabled_terms_are_not_applied_or_prompted() {
        let mut disabled = word("Notle", &["诺特"]);
        disabled.enabled = false;
        assert_eq!(apply("诺特", &[disabled.clone()]), "诺特");
        assert_eq!(transcription_prompt(&[disabled]), "");
    }
    #[test]
    fn rejects_ambiguous_aliases_and_normalizes_duplicates() {
        let words = vec![word("Notle", &["诺特"])];
        assert!(
            HotwordInput {
                term: "其他".into(),
                aliases: vec!["NOTLE".into()],
                enabled: true
            }
            .validate(&words, None)
            .is_err()
        );
        let updated = HotwordInput {
            term: " Notle ".into(),
            aliases: vec!["notle".into(), "诺特".into(), " 诺特 ".into()],
            enabled: true,
        }
        .validate(&words, Some("Notle"))
        .unwrap();
        assert_eq!(updated.aliases, vec!["诺特"]);
    }
}
