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
