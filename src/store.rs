use crate::{
    error::AppError,
    model::{Database, Record},
};
use std::path::PathBuf;
use tokio::sync::Mutex;

pub struct Store {
    path: PathBuf,
    data: Mutex<Database>,
}
impl Store {
    pub async fn open(path: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let data = match tokio::fs::read(&path).await {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Database::default(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            path,
            data: Mutex::new(data),
        })
    }
    pub async fn snapshot(&self) -> Database {
        self.data.lock().await.clone()
    }
    async fn persist(&self, data: &Database) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|_| AppError::internal())?;
        }
        let bytes = serde_json::to_vec_pretty(data).map_err(|_| AppError::internal())?;
        let temporary = self.path.with_extension("json.tmp");
        tokio::fs::write(&temporary, bytes)
            .await
            .map_err(|_| AppError::internal())?;
        tokio::fs::rename(temporary, &self.path)
            .await
            .map_err(|_| AppError::internal())
    }
    pub async fn save_record(&self, record: Record) -> Result<(), AppError> {
        let mut guard = self.data.lock().await;
        let mut next = guard.clone();
        next.records.retain(|item| item.id != record.id);
        next.records.insert(0, record);
        next.records.truncate(200);
        self.persist(&next).await?;
        *guard = next;
        Ok(())
    }
    pub async fn put_hotword(
        &self,
        id: Option<&str>,
        input: crate::hotwords::HotwordInput,
    ) -> Result<crate::hotwords::Hotword, AppError> {
        let mut guard = self.data.lock().await;
        if let Some(id) = id {
            if !guard.hotwords.iter().any(|word| word.id == id) {
                return Err(AppError::missing());
            }
        } else if guard.hotwords.len() >= 100 {
            return Err(AppError::bad("最多保存 100 个热词。"));
        }
        let input = input.validate(&guard.hotwords, id)?;
        let word = crate::hotwords::Hotword {
            id: id
                .map(str::to_owned)
                .unwrap_or_else(crate::hotwords::new_id),
            term: input.term,
            aliases: input.aliases,
            enabled: input.enabled,
        };
        let mut next = guard.clone();
        next.hotwords.retain(|item| item.id != word.id);
        next.hotwords.push(word.clone());
        self.persist(&next).await?;
        *guard = next;
        Ok(word)
    }
    pub async fn delete_hotword(&self, id: &str) -> Result<(), AppError> {
        let mut guard = self.data.lock().await;
        let mut next = guard.clone();
        next.hotwords.retain(|item| item.id != id);
        if next.hotwords.len() == guard.hotwords.len() {
            return Err(AppError::missing());
        }
        self.persist(&next).await?;
        *guard = next;
        Ok(())
    }
    pub async fn delete_record(&self, id: &str) -> Result<(), AppError> {
        let mut guard = self.data.lock().await;
        let mut next = guard.clone();
        next.records.retain(|item| item.id != id);
        if next.records.len() == guard.records.len() {
            return Err(AppError::missing());
        }
        self.persist(&next).await?;
        *guard = next;
        Ok(())
    }
}
