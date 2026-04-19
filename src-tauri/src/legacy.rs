use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::domain::{
    LocalProjectBinding, MigrationReport, ProjectProfile, RepoLibrary, Resource, ResourceKind,
    ResourceOrigin, ResourceScope, SourceStatus,
};
use crate::store::{compute_revision, now_ms, slugify};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyProject {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacySkill {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    pub tags: Vec<String>,
    pub project_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegacySkillStore {
    pub version: String,
    pub skills: Vec<LegacySkill>,
    pub projects: Vec<LegacyProject>,
}

pub fn read_legacy_store(path: &Path) -> Result<Option<LegacySkillStore>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    let store =
        serde_json::from_str::<LegacySkillStore>(&raw).map_err(|error| error.to_string())?;
    Ok(Some(store))
}

pub fn migrate_legacy_store(
    store: LegacySkillStore,
    repo_library: &mut RepoLibrary,
    bindings: &mut Vec<LocalProjectBinding>,
) -> MigrationReport {
    if !repo_library.resources.is_empty() || !repo_library.project_profiles.is_empty() {
        return MigrationReport {
            migrated: false,
            resources_migrated: 0,
            project_profiles_migrated: 0,
            bindings_migrated: 0,
        };
    }

    let migrated_at = now_ms();
    let mut project_profiles = Vec::new();
    let mut migrated_bindings = 0usize;

    for project in store.projects {
        if let Some(path) = project.path.clone() {
            if !bindings
                .iter()
                .any(|binding| binding.project_id == project.id)
            {
                bindings.push(LocalProjectBinding {
                    project_id: project.id.clone(),
                    path,
                    detected_repo_root: None,
                    updated_at: migrated_at,
                });
                migrated_bindings += 1;
            }
        }

        project_profiles.push(ProjectProfile {
            id: project.id,
            slug: slugify(&project.name),
            name: project.name,
            description: None,
            color: project.color,
            agents_resource_id: None,
            attached_resource_ids: Vec::new(),
            created_at: project.created_at,
            updated_at: project.updated_at,
        });
    }

    let mut resources = Vec::new();
    for skill in store.skills {
        let resource = Resource {
            id: skill.id.clone(),
            slug: slugify(&skill.name),
            title: skill.name,
            description: skill.description,
            kind: ResourceKind::Skill,
            scope: ResourceScope::Global,
            origin: ResourceOrigin::Private,
            source_status: SourceStatus::LocalOnly,
            project_id: None,
            tags: skill.tags,
            revision: compute_revision(&skill.content),
            content: skill.content,
            source_url: None,
            source_ref: None,
            source_path: None,
            upstream_revision: None,
            forked_from: None,
            created_at: skill.created_at,
            updated_at: skill.updated_at,
            provenance: Default::default(),
        };

        for project_id in &skill.project_ids {
            if let Some(profile) = project_profiles
                .iter_mut()
                .find(|profile| profile.id == *project_id)
            {
                if !profile.attached_resource_ids.contains(&skill.id) {
                    profile.attached_resource_ids.push(skill.id.clone());
                }
            }
        }

        resources.push(resource);
    }

    repo_library.resources = resources;
    repo_library.project_profiles = project_profiles;
    repo_library.version = "2".into();

    MigrationReport {
        migrated: true,
        resources_migrated: repo_library.resources.len(),
        project_profiles_migrated: repo_library.project_profiles.len(),
        bindings_migrated: migrated_bindings,
    }
}
