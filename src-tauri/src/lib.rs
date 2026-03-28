mod commands;
mod domain;
mod git;
mod legacy;
mod marketplace;
mod registry;
mod repo_sources;
mod store;
mod updater;

use commands::{
    apply_environment_restore, apply_install_refresh, apply_project_profile, apply_source_update,
    backup_source_connect, backup_source_pull, backup_source_push, backup_source_status,
    capture_project_changes, check_install_updates, check_source_updates, marketplace_load_feed,
    preview_capture_project_changes, preview_environment_restore, preview_project_apply,
    preview_source_update, project_binding_list, project_create, project_delete, project_list,
    project_profile_list, project_remove_cli_folders, project_update, repo_connect, repo_preflight,
    repo_pull, repo_push, repo_source_delete, repo_source_list_skills, repo_source_sync,
    repo_status, repo_sync, resource_list, scan_external_skills, scan_global_environment,
    scan_project_state, settings_get, settings_set, show_in_finder, skill_check_symlink_status,
    skill_create, skill_delete, skill_export_to_zip, skill_get, skill_import_from_folder,
    skill_import_from_market, skill_import_from_zip, skill_install_global,
    skill_install_to_project, skill_list, skill_list_directory, skill_migrate_to_symlinks,
    skill_read_file, skill_repair_broken_symlinks, skill_search, skill_uninstall_from_project,
    skill_uninstall_global, skill_update, registry_search, registry_fetch_content, registry_install,
};
use updater::{check_app_update, download_and_install_update, get_current_version};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

            match store::get_settings(&handle) {
                Ok(settings) => {
                    store::apply_theme_preference(&handle, settings.theme.as_str());
                }
                Err(error) => {
                    println!("[SkillSwitch] Failed to load theme preference: {}", error);
                }
            }

            // Run migration on startup
            std::thread::spawn(move || {
                match store::migrate_copied_skills_to_symlinks(&handle) {
                    Ok(result) => {
                        if result.migrated_count > 0 || !result.errors.is_empty() {
                            println!(
                                "[SkillSwitch] Migration complete: {} migrated, {} skipped, {} errors",
                                result.migrated_count,
                                result.skipped_count,
                                result.errors.len()
                            );
                        }
                    }
                    Err(e) => {
                        println!("[SkillSwitch] Migration failed: {}", e);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            repo_preflight,
            repo_connect,
            repo_status,
            repo_pull,
            repo_push,
            repo_sync,
            backup_source_status,
            backup_source_connect,
            backup_source_pull,
            backup_source_push,
            resource_list,
            project_profile_list,
            project_binding_list,
            scan_project_state,
            preview_project_apply,
            apply_project_profile,
            preview_capture_project_changes,
            capture_project_changes,
            apply_install_refresh,
            scan_global_environment,
            preview_environment_restore,
            apply_environment_restore,
            check_source_updates,
            check_install_updates,
            preview_source_update,
            apply_source_update,
            skill_list,
            skill_get,
            skill_create,
            skill_update,
            skill_delete,
            skill_search,
            skill_install_to_project,
            skill_uninstall_from_project,
            skill_install_global,
            skill_uninstall_global,
            skill_check_symlink_status,
            skill_repair_broken_symlinks,
            skill_migrate_to_symlinks,
            skill_import_from_folder,
            skill_import_from_zip,
            skill_export_to_zip,
            skill_list_directory,
            skill_read_file,
            project_remove_cli_folders,
            project_list,
            project_create,
            project_update,
            project_delete,
            show_in_finder,
            scan_external_skills,
            settings_get,
            settings_set,
            repo_source_sync,
            repo_source_delete,
            repo_source_list_skills,
            marketplace_load_feed,
            skill_import_from_market,
            registry_search,
            registry_fetch_content,
            registry_install,
            check_app_update,
            download_and_install_update,
            get_current_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
