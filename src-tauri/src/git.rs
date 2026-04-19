use std::path::{Path, PathBuf};
use std::process::Command;

fn run_git(path: Option<&Path>, args: &[&str]) -> Option<std::process::Output> {
    let mut command = Command::new("git");
    if let Some(path) = path {
        command.arg("-C").arg(path);
    }
    command.args(args).output().ok()
}

pub fn git_available() -> bool {
    run_git(None, &["--version"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn is_git_repo(path: &Path) -> bool {
    git_root(path).is_some()
}

pub fn git_root(path: &Path) -> Option<PathBuf> {
    let output = run_git(Some(path), &["rev-parse", "--show-toplevel"])?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        None
    } else {
        Some(PathBuf::from(stdout))
    }
}

pub fn branch(path: &Path) -> Option<String> {
    let output = run_git(Some(path), &["rev-parse", "--abbrev-ref", "HEAD"])?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!stdout.is_empty()).then_some(stdout)
}

pub fn dirty(path: &Path) -> bool {
    let output = run_git(Some(path), &["status", "--porcelain"]);

    match output {
        Some(output) if output.status.success() => {
            !String::from_utf8_lossy(&output.stdout).trim().is_empty()
        }
        _ => false,
    }
}

pub fn status_porcelain(path: &Path) -> Result<String, String> {
    let output = run_git(Some(path), &["status", "--porcelain"])
        .ok_or_else(|| "git status failed".to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn add_all(path: &Path) -> Result<(), String> {
    let output = run_git(Some(path), &["add", "-A"]).ok_or_else(|| "git add failed".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn commit(path: &Path, message: &str) -> Result<bool, String> {
    let status = status_porcelain(path)?;
    if status.trim().is_empty() {
        return Ok(false);
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["commit", "-m", message])
        .env("GIT_AUTHOR_NAME", "SkillSwitch")
        .env("GIT_AUTHOR_EMAIL", "skill-switch@localhost")
        .env("GIT_COMMITTER_NAME", "SkillSwitch")
        .env("GIT_COMMITTER_EMAIL", "skill-switch@localhost")
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(true)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn init_repository(path: &Path) -> Result<(), String> {
    let output = run_git(Some(path), &["init"]).ok_or_else(|| "git init failed".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn remote_url(path: &Path, remote: &str) -> Result<Option<String>, String> {
    let output = run_git(Some(path), &["remote", "get-url", remote])
        .ok_or_else(|| "git remote get-url failed".to_string())?;
    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!stdout.is_empty()).then_some(stdout))
}

pub fn add_remote(path: &Path, remote: &str, url: &str) -> Result<(), String> {
    let output = run_git(Some(path), &["remote", "add", remote, url])
        .ok_or_else(|| "git remote add failed".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn set_remote_url(path: &Path, remote: &str, url: &str) -> Result<(), String> {
    let output = run_git(Some(path), &["remote", "set-url", remote, url])
        .ok_or_else(|| "git remote set-url failed".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn configure_identity(path: &Path) -> Result<(), String> {
    let name = run_git(Some(path), &["config", "user.name", "SkillSwitch"])
        .ok_or_else(|| "git config user.name failed".to_string())?;
    if !name.status.success() {
        return Err(String::from_utf8_lossy(&name.stderr).trim().to_string());
    }

    let email = run_git(
        Some(path),
        &["config", "user.email", "skill-switch@localhost"],
    )
    .ok_or_else(|| "git config user.email failed".to_string())?;
    if !email.status.success() {
        return Err(String::from_utf8_lossy(&email.stderr).trim().to_string());
    }

    Ok(())
}

pub fn checkout_branch(path: &Path, branch: &str) -> Result<(), String> {
    let output = run_git(Some(path), &["checkout", "-B", branch])
        .ok_or_else(|| "git checkout failed".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn push_branch(path: &Path, remote: &str, branch: &str) -> Result<(), String> {
    let output = run_git(Some(path), &["push", "--set-upstream", remote, branch])
        .ok_or_else(|| "git push failed".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn remote_branch_exists(remote_url: &str, branch: &str) -> Result<bool, String> {
    let output = Command::new("git")
        .args(["ls-remote", "--heads", remote_url, branch])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

pub fn tracked(project_path: &Path, absolute_path: &Path) -> bool {
    let Some(root) = git_root(project_path) else {
        return false;
    };

    let Ok(relative) = absolute_path.strip_prefix(&root) else {
        return false;
    };

    let output = Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["ls-files", "--error-unmatch", "--"])
        .arg(relative)
        .output();

    matches!(output, Ok(output) if output.status.success())
}

pub fn head(path: &Path) -> Option<String> {
    let output = run_git(Some(path), &["rev-parse", "HEAD"])?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!stdout.is_empty()).then_some(stdout)
}

pub fn ahead_behind(path: &Path) -> (usize, usize) {
    let output = run_git(
        Some(path),
        &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
    );

    let Some(output) = output else {
        return (0, 0);
    };

    if !output.status.success() {
        return (0, 0);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let behind = parts
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let ahead = parts
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    (ahead, behind)
}

pub fn clone_repository(
    remote_url: &str,
    destination: &Path,
    branch: Option<&str>,
) -> Result<(), String> {
    let mut command = Command::new("git");
    command.arg("clone");
    if let Some(branch) = branch {
        command.arg("--branch").arg(branch);
    }
    command.arg(remote_url).arg(destination);

    let output = command.output().map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }

    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

pub fn pull(path: &Path) -> Result<(), String> {
    let output = run_git(Some(path), &["pull"]).ok_or_else(|| "git pull failed".to_string())?;
    if output.status.success() {
        return Ok(());
    }

    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

pub fn push(path: &Path) -> Result<(), String> {
    let output = run_git(Some(path), &["push"]).ok_or_else(|| "git push failed".to_string())?;
    if output.status.success() {
        return Ok(());
    }

    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

pub fn ls_remote_head(remote_url: &str, reference: Option<&str>) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("ls-remote").arg(remote_url);
    if let Some(reference) = reference {
        command.arg(reference);
    }

    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let head = stdout
        .lines()
        .find_map(|line| line.split_whitespace().next())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "remote head not found".to_string())?;
    Ok(head.to_string())
}

pub fn read_file_at_revision(
    repo_path: &Path,
    revision: &str,
    source_path: &str,
) -> Result<String, String> {
    let spec = format!("{revision}:{source_path}");
    let output =
        run_git(Some(repo_path), &["show", &spec]).ok_or_else(|| "git show failed".to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn merge_file(base: &Path, local: &Path, remote: &Path) -> Result<(String, bool), String> {
    let output = Command::new("git")
        .args(["merge-file", "--stdout"])
        .arg(local)
        .arg(base)
        .arg(remote)
        .output()
        .map_err(|error| error.to_string())?;

    let merged = String::from_utf8_lossy(&output.stdout).into_owned();
    if output.status.success() {
        return Ok((merged, true));
    }

    if output.status.code() == Some(1) {
        return Ok((merged, false));
    }

    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}
