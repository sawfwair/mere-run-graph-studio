fn read_pipe(mut pipe: impl Read) -> StudioResult<Vec<u8>> {
    let mut bytes = Vec::new();
    pipe.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn slug(value: &str) -> String {
    let pattern = Regex::new(r"[^a-z0-9]+").expect("valid slug regex");
    let slug = pattern
        .replace_all(&value.to_lowercase(), "-")
        .trim_matches('-')
        .chars()
        .take(40)
        .collect::<String>();
    if slug.is_empty() {
        "workflow".to_owned()
    } else {
        slug
    }
}

fn lifecycle_record(kind: &str, message: &str, details: Value) -> Value {
    json!({
        "created_at": now(),
        "kind": kind,
        "message": message,
        "details": details,
    })
}

fn stored_run(run: &StudioRun) -> Value {
    json!({
        "id": run.id,
        "executor": run.executor,
        "graph_path": run.graph_path,
        "inputs_path": run.inputs_path,
        "state": run.state,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "exit_code": run.exit_code,
        "result": run.result,
        "stderr": tail(&run.stderr, MAX_DIAGNOSTIC_BYTES),
        "remote_reference": run.remote_reference,
        "history": run.history,
    })
}

fn restore_run(value: Value, run_directory: PathBuf) -> StudioResult<StudioRun> {
    let object = required_map(&value, "Studio run")?;
    Ok(StudioRun {
        id: required_string(object, "id", None)?.to_owned(),
        executor: required_string(object, "executor", None)?.to_owned(),
        run_directory,
        graph_path: PathBuf::from(required_string(object, "graph_path", None)?),
        inputs_path: PathBuf::from(required_string(object, "inputs_path", None)?),
        state: required_string(object, "state", None)?.to_owned(),
        created_at: required_string(object, "created_at", None)?.to_owned(),
        updated_at: required_string(object, "updated_at", None)?.to_owned(),
        exit_code: object
            .get("exit_code")
            .and_then(Value::as_i64)
            .map(|value| value as i32),
        result: object.get("result").cloned().unwrap_or(Value::Null),
        stderr: object
            .get("stderr")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        remote_reference: object
            .get("remote_reference")
            .and_then(Value::as_str)
            .map(str::to_owned),
        history: object
            .get("history")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    })
}

fn run_public(run: &StudioRun, include_events: bool) -> StudioResult<Value> {
    let mut value = Map::from_iter([
        ("id".to_owned(), Value::String(run.id.clone())),
        ("executor".to_owned(), Value::String(run.executor.clone())),
        (
            "run_directory".to_owned(),
            Value::String(run.run_directory.display().to_string()),
        ),
        ("state".to_owned(), Value::String(run.state.clone())),
        (
            "created_at".to_owned(),
            Value::String(run.created_at.clone()),
        ),
        (
            "updated_at".to_owned(),
            Value::String(run.updated_at.clone()),
        ),
        (
            "exit_code".to_owned(),
            run.exit_code.map_or(Value::Null, |code| json!(code)),
        ),
        ("result".to_owned(), run.result.clone()),
        (
            "stderr".to_owned(),
            Value::String(tail(&run.stderr, MAX_DIAGNOSTIC_BYTES)),
        ),
        (
            "remote_reference".to_owned(),
            run.remote_reference
                .clone()
                .map_or(Value::Null, Value::String),
        ),
        ("history".to_owned(), Value::Array(run.history.clone())),
    ]);
    if include_events {
        let manifest = read_optional_json(&run.run_directory.join("run.json"))?;
        value.insert(
            "events".to_owned(),
            Value::Array(read_json_lines(
                &run.run_directory.join("events.jsonl"),
                250,
            )?),
        );
        value.insert(
            "manifest".to_owned(),
            manifest.clone().unwrap_or(Value::Null),
        );
        value.insert(
            "actions".to_owned(),
            read_optional_json(&run.run_directory.join("actions.json"))?
                .unwrap_or_else(|| json!([])),
        );
        value.insert(
            "artifacts".to_owned(),
            Value::Array(collect_run_artifacts(manifest.as_ref())),
        );
        value.insert(
            "node_details".to_owned(),
            Value::Array(collect_node_details(&run.run_directory, manifest.as_ref())?),
        );
    }
    Ok(Value::Object(value))
}

fn read_json_lines(path: &Path, limit: usize) -> StudioResult<Vec<Value>> {
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path)?;
    let lines = content.lines().rev().take(limit).collect::<Vec<_>>();
    Ok(lines
        .into_iter()
        .rev()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect())
}

fn collect_run_artifacts(manifest: Option<&Value>) -> Vec<Value> {
    let Some(manifest) = manifest.and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    if let Some(outputs) = manifest.get("outputs").and_then(Value::as_array) {
        candidates.extend(outputs.iter().cloned());
    }
    if let Some(nodes) = manifest.get("nodes").and_then(Value::as_array) {
        for node in nodes {
            for key in ["artifacts", "outputs"] {
                if let Some(artifacts) = node.get(key).and_then(Value::as_array) {
                    candidates.extend(artifacts.iter().cloned());
                }
            }
        }
    }
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| {
            let Some(name) = candidate.get("name").and_then(Value::as_str) else {
                return false;
            };
            let Some(path) = candidate.get("path").and_then(Value::as_str) else {
                return false;
            };
            seen.insert((name.to_owned(), path.to_owned()))
        })
        .collect()
}

fn collect_node_details(
    run_directory: &Path,
    manifest: Option<&Value>,
) -> StudioResult<Vec<Value>> {
    let Some(nodes) = manifest
        .and_then(|value| value.get("nodes"))
        .and_then(Value::as_array)
    else {
        return Ok(Vec::new());
    };
    let node_root = run_directory.join("nodes");
    let directories = if node_root.is_dir() {
        fs::read_dir(&node_root)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let mut details = Vec::new();
    for node in nodes {
        let Some(id) = node.get("id").and_then(Value::as_str) else {
            continue;
        };
        let directory = directories.iter().find(|path| {
            path.file_name()
                .is_some_and(|name| name.to_string_lossy().ends_with(&format!("-{id}")))
        });
        let mut detail = Map::from_iter([("id".to_owned(), Value::String(id.to_owned()))]);
        if let Some(directory) = directory {
            detail.insert(
                "directory".to_owned(),
                Value::String(
                    directory
                        .strip_prefix(run_directory)
                        .unwrap_or(directory)
                        .to_string_lossy()
                        .replace('\\', "/"),
                ),
            );
            detail.insert(
                "preflight".to_owned(),
                read_optional_json(&directory.join("preflight.json"))?.unwrap_or(Value::Null),
            );
            detail.insert(
                "stdout".to_owned(),
                Value::String(read_text_tail(&directory.join("stdout.txt"))?),
            );
            detail.insert(
                "stderr".to_owned(),
                Value::String(read_text_tail(&directory.join("stderr.txt"))?),
            );
        }
        details.push(Value::Object(detail));
    }
    Ok(details)
}

fn read_text_tail(path: &Path) -> StudioResult<String> {
    if !path.is_file() {
        return Ok(String::new());
    }
    let mut file = File::open(path)?;
    let length = file.metadata()?.len();
    file.seek(SeekFrom::Start(
        length.saturating_sub(MAX_DIAGNOSTIC_BYTES as u64),
    ))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn find_remote_reference(value: &Value) -> Option<&str> {
    match value {
        Value::String(value) if value.starts_with("ssh://") || value.starts_with("relay://") => {
            Some(value)
        }
        Value::Array(values) => values.iter().find_map(find_remote_reference),
        Value::Object(values) => values.values().find_map(find_remote_reference),
        _ => None,
    }
}

fn find_run_state(value: &Value) -> Option<&str> {
    const ALLOWED: &[&str] = &[
        "planned",
        "preflighting",
        "queued",
        "assigned",
        "running",
        "finished",
        "failed",
        "cancelled",
    ];
    match value {
        Value::Array(values) => values.iter().find_map(find_run_state),
        Value::Object(values) => {
            if let Some(state) = values
                .get("state")
                .and_then(Value::as_str)
                .filter(|state| ALLOWED.contains(state))
            {
                return Some(state);
            }
            values.values().find_map(find_run_state)
        }
        _ => None,
    }
}

fn validate_artifact_path(raw_path: &str) -> StudioResult<()> {
    let path = Path::new(raw_path);
    if raw_path.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(error("invalid artifact path"));
    }
    Ok(())
}
