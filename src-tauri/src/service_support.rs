/// Parsed fields from one `mere.run model pull` progress line, e.g.
/// `[image-zimage-nano] 45%  120 MB / 260 MB  30 MB/s  ETA 5s` or an
/// `Extracting…`/`Converting…` phase line.
#[derive(Default)]
struct PullProgress {
    percent: Option<f64>,
    received_bytes: Option<u64>,
    total_bytes: Option<u64>,
    installing: bool,
}

fn parse_pull_progress(line: &str) -> PullProgress {
    let lower = line.to_lowercase();
    let mut progress = PullProgress {
        installing: lower.contains("extract")
            || lower.contains("convert")
            || lower.contains("install"),
        ..PullProgress::default()
    };
    if let Some(captures) = pull_percent_regex().captures(line) {
        progress.percent = captures
            .get(1)
            .and_then(|value| value.as_str().parse::<f64>().ok())
            .map(|value| value.clamp(0.0, 100.0));
    }
    if let Some(captures) = pull_bytes_regex().captures(line) {
        progress.received_bytes = parse_byte_size(
            captures.get(1).map(|m| m.as_str()).unwrap_or(""),
            captures.get(2).map(|m| m.as_str()).unwrap_or(""),
        );
        progress.total_bytes = parse_byte_size(
            captures.get(3).map(|m| m.as_str()).unwrap_or(""),
            captures.get(4).map(|m| m.as_str()).unwrap_or(""),
        );
    }
    progress
}

fn parse_byte_size(amount: &str, unit: &str) -> Option<u64> {
    let amount: f64 = amount.parse().ok()?;
    let scale = match unit.to_uppercase().as_str() {
        "B" | "" => 1.0,
        "KB" | "KIB" => 1024.0,
        "MB" | "MIB" => 1024.0 * 1024.0,
        "GB" | "GIB" => 1024.0 * 1024.0 * 1024.0,
        "TB" | "TIB" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((amount * scale) as u64)
}

fn validate_model_id(target: &str) -> StudioResult<()> {
    let valid = !target.is_empty()
        && target.len() <= 128
        && target.chars().all(|ch| {
            ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '-' | '_' | '.')
        });
    if valid {
        Ok(())
    } else {
        Err(error(format!("invalid model id: {target}")))
    }
}

fn pull_percent_regex() -> &'static Regex {
    static REGEX: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(\d+(?:\.\d+)?)\s*%").expect("valid percent regex"))
}

fn pull_bytes_regex() -> &'static Regex {
    static REGEX: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"([\d.]+)\s*([KMGT]?i?B)\s*/\s*([\d.]+)\s*([KMGT]?i?B)")
            .expect("valid bytes regex")
    })
}

fn command_status(path: Option<&Path>, required: bool) -> CommandStatus {
    let Some(path) = path else {
        return CommandStatus {
            path: None,
            available: false,
            version: None,
            error: required.then(|| "Command has not been configured.".to_owned()),
        };
    };
    match Command::new(path).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            CommandStatus {
                path: Some(path.display().to_string()),
                available: true,
                version: Some(if stdout.is_empty() { stderr } else { stdout }),
                error: None,
            }
        }
        Ok(output) => CommandStatus {
            path: Some(path.display().to_string()),
            available: false,
            version: None,
            error: Some(tail(
                &String::from_utf8_lossy(&output.stderr),
                MAX_DIAGNOSTIC_BYTES,
            )),
        },
        Err(reason) => CommandStatus {
            path: Some(path.display().to_string()),
            available: false,
            version: None,
            error: Some(reason.to_string()),
        },
    }
}

fn discover_command(name: &str) -> Option<PathBuf> {
    if let Ok(path) = which::which(name) {
        return Some(path);
    }
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let executable = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    };
    let mut candidates = Vec::new();
    if let Some(home) = home {
        candidates.push(home.join(".local/bin").join(&executable));
        candidates.push(home.join("bin").join(&executable));
    }
    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/opt/homebrew/bin").join(&executable));
        candidates.push(PathBuf::from("/usr/local/bin").join(&executable));
    } else if cfg!(target_os = "linux") {
        candidates.push(PathBuf::from("/usr/local/bin").join(&executable));
        candidates.push(PathBuf::from("/usr/bin").join(&executable));
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn resolve_required_command(raw: &str, label: &str) -> StudioResult<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(error(format!("{label} path must not be empty")));
    }
    let requested = expand_user_path(trimmed)?;
    let resolved = if requested.components().count() == 1 {
        which::which(trimmed).unwrap_or(requested)
    } else {
        requested
    };
    if !resolved.is_file() {
        return Err(error(format!(
            "{label} executable does not exist: {}",
            resolved.display()
        )));
    }
    Ok(resolved.canonicalize().unwrap_or(resolved))
}

fn expand_user_path(raw: &str) -> StudioResult<PathBuf> {
    if raw == "~" || raw.starts_with("~/") || raw.starts_with("~\\") {
        let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let home = std::env::var_os(key).ok_or_else(|| error(format!("{key} is unavailable")))?;
        let suffix = raw.trim_start_matches('~').trim_start_matches(['/', '\\']);
        return Ok(PathBuf::from(home).join(suffix));
    }
    Ok(PathBuf::from(raw))
}

fn validate_relative_path(raw: &str, label: &str) -> StudioResult<()> {
    let pattern = Regex::new(r"^[A-Za-z0-9][A-Za-z0-9_./\\-]{0,255}$").expect("valid path regex");
    let path = Path::new(raw);
    if !pattern.is_match(raw)
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(error(format!("invalid {label} path: {raw}")));
    }
    Ok(())
}

fn required_map<'a>(value: &'a Value, label: &str) -> StudioResult<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| error(format!("{label} must be an object")))
}

fn required_string<'a>(
    body: &'a Map<String, Value>,
    key: &str,
    default: Option<&'a str>,
) -> StudioResult<&'a str> {
    body.get(key)
        .and_then(Value::as_str)
        .or(default)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| error(format!("{key} must be a non-empty string")))
}

fn required_object_value(value: Option<&Value>, label: &str) -> StudioResult<Value> {
    value
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| error(format!("{label} must be an object")))
}

fn object_value_or(value: Option<&Value>, default: Value, label: &str) -> StudioResult<Value> {
    match value {
        None => Ok(default),
        Some(value) if value.is_object() => Ok(value.clone()),
        Some(_) => Err(error(format!("{label} must be an object"))),
    }
}

fn default_sidecar() -> Value {
    json!({
        "schema_version": 1,
        "kind": SIDECAR_KIND,
        "viewport": { "x": 0, "y": 0, "zoom": 1 },
        "nodes": {},
        "inputs": {},
        "outputs": {},
        "groups": {},
        "notes": {},
        "selection_sets": {},
    })
}

fn unique_file_name(source_name: &str, used: &mut HashSet<String>) -> String {
    if used.insert(source_name.to_owned()) {
        return source_name.to_owned();
    }
    let path = Path::new(source_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("asset");
    let extension = path.extension().and_then(|value| value.to_str());
    let mut index = 2;
    loop {
        let candidate = match extension {
            Some(extension) => format!("{stem}-{index}.{extension}"),
            None => format!("{stem}-{index}"),
        };
        if used.insert(candidate.clone()) {
            return candidate;
        }
        index += 1;
    }
}

fn portable_file_name(source_name: &str) -> String {
    let value = source_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let value = value.trim_matches(['.', '-']);
    if value.is_empty() {
        "asset".to_owned()
    } else {
        value.chars().take(120).collect()
    }
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn validate_project_documents(graph: &Value, sidecar: &Value) -> StudioResult<()> {
    if graph.get("schema_version").and_then(Value::as_i64) != Some(1)
        || graph.get("kind").and_then(Value::as_str) != Some("mere.run/workflow-graph")
    {
        return Err(error(
            "workflow graph must use schema_version 1 and kind mere.run/workflow-graph",
        ));
    }
    if sidecar.get("schema_version").and_then(Value::as_i64) != Some(1)
        || sidecar.get("kind").and_then(Value::as_str) != Some(SIDECAR_KIND)
    {
        return Err(error(format!(
            "editor sidecar must use schema_version 1 and kind {SIDECAR_KIND}"
        )));
    }
    Ok(())
}

fn project_paths(base: &Path) -> (PathBuf, PathBuf, PathBuf) {
    let parent = base.parent().unwrap_or_else(|| Path::new(""));
    let name = base.file_name().unwrap_or_default().to_string_lossy();
    (
        parent.join(format!("{name}.workflow.json")),
        parent.join(format!("{name}.inputs.json")),
        parent.join(format!("{name}.studio.json")),
    )
}

fn project_program_path(base: &Path) -> PathBuf {
    let parent = base.parent().unwrap_or_else(|| Path::new(""));
    let name = base.file_name().unwrap_or_default().to_string_lossy();
    parent.join(format!("{name}.program.json"))
}

fn write_json_atomic(path: &Path, value: &Value) -> StudioResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| error("JSON destination has no parent directory"))?;
    fs::create_dir_all(parent)?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut temporary, value)?;
    temporary.write_all(b"\n")?;
    temporary.flush()?;
    temporary
        .persist(path)
        .map_err(|failure| error(failure.error.to_string()))?;
    Ok(())
}

fn read_required_json(path: &Path, label: &str) -> StudioResult<Value> {
    let content = fs::read(path)?;
    serde_json::from_slice(&content)
        .map_err(|reason| error(format!("invalid {label} JSON: {reason}")))
}

fn read_optional_json(path: &Path) -> StudioResult<Option<Value>> {
    if !path.is_file() {
        return Ok(None);
    }
    Ok(serde_json::from_slice(&fs::read(path)?).ok())
}
