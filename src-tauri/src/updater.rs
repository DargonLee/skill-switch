use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

/// Information about an available update
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub date: Option<String>,
    pub body: Option<String>,
}

/// Progress information during download
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// Result of downloading and installing an update
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub success: bool,
    pub message: String,
    pub requires_restart: bool,
}

/// Get the current app version string
fn get_version_string(app: &AppHandle) -> String {
    app.config()
        .version
        .clone()
        .unwrap_or_else(|| "unknown".to_string())
}

/// Check if an app update is available
#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            let current_version = get_version_string(&app);
            Ok(Some(UpdateInfo {
                version: update.version.clone(),
                current_version,
                date: update.date.map(|d| d.to_string()),
                body: update.body.clone(),
            }))
        }
        Ok(None) => Ok(None),
        Err(e) => Err(format!("检查更新失败: {}", e)),
    }
}

/// Download and install the update
#[tauri::command]
pub async fn download_and_install_update(app: AppHandle) -> Result<UpdateResult, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败: {}", e))?
        .ok_or_else(|| "没有可用更新".to_string())?;

    let mut downloaded = 0u64;

    // Download and install with progress tracking
    update
        .download_and_install(
            |chunk_length, content_length| {
                downloaded += chunk_length as u64;
                let _ = app.emit(
                    "update-progress",
                    UpdateProgress {
                        downloaded,
                        total: content_length,
                    },
                );
            },
            || {
                let _ = app.emit("update-complete", ());
            },
        )
        .await
        .map_err(|e| format!("安装更新失败: {}", e))?;

    Ok(UpdateResult {
        success: true,
        message: "更新安装成功".to_string(),
        requires_restart: true,
    })
}

/// Get the current app version
#[tauri::command]
pub fn get_current_version(app: AppHandle) -> Result<String, String> {
    Ok(get_version_string(&app))
}
