use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

pub fn db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not resolve home directory")?;
    let dir = home.join(".devtree").join("db");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("devtree.db"))
}

pub fn init_db() -> Result<Connection, String> {
    let conn = Connection::open(db_path()?).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn get_value(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM kv_store WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let value: String = row.get(0).map_err(|e| e.to_string())?;
        return Ok(Some(value));
    }
    Ok(None)
}

fn set_value(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO kv_store (key, value, updated_at)
         VALUES (?1, ?2, strftime('%s', 'now'))
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_persisted_state(
    key: String,
    db: tauri::State<DbState>,
) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    get_value(&conn, &key)
}

#[tauri::command]
pub fn save_persisted_state(
    key: String,
    value: String,
    db: tauri::State<DbState>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    set_value(&conn, &key, &value)
}

#[tauri::command]
pub fn get_db_path() -> Result<String, String> {
    db_path().map(|p| p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_path_ends_with_devtree_db() {
        let path = db_path().expect("db path");
        assert!(path.to_string_lossy().ends_with("devtree.db"));
    }
}
