impl StudioService {
    pub fn new(app_data: PathBuf) -> StudioResult<Self> {
        fs::create_dir_all(&app_data)?;
        let config_path = app_data.join("config.json");
        let config = if config_path.is_file() {
            let value: AppConfig = serde_json::from_slice(&fs::read(&config_path)?)?;
            if value.schema_version != CONFIG_SCHEMA_VERSION {
                return Err(error(format!(
                    "unsupported desktop configuration schema: {}",
                    value.schema_version
                )));
            }
            value
        } else {
            AppConfig {
                schema_version: CONFIG_SCHEMA_VERSION,
                onboarding_complete: false,
                workspace: app_data.join("workspace"),
                mere_run_command: discover_command("mere.run"),
                workflow_tools_command: discover_command("mere-dataset-tools"),
            }
        };
        fs::create_dir_all(&config.workspace)?;
        let service = Self {
            config_path,
            config: RwLock::new(config),
            runs: Mutex::new(HashMap::new()),
            processes: Mutex::new(HashMap::new()),
            model_pulls: Mutex::new(HashMap::new()),
        };
        service.ensure_workspace_layout()?;
        service.restore_runs()?;
        Ok(service)
    }

    pub fn status(&self) -> DesktopStatus {
        let config = self
            .config
            .read()
            .expect("desktop config lock poisoned")
            .clone();
        DesktopStatus {
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            platform: std::env::consts::OS.to_owned(),
            architecture: std::env::consts::ARCH.to_owned(),
            config_path: self.config_path.display().to_string(),
            workspace: config.workspace.display().to_string(),
            onboarding_complete: config.onboarding_complete,
            mere_run: command_status(config.mere_run_command.as_deref(), true),
            workflow_tools: command_status(config.workflow_tools_command.as_deref(), false),
        }
    }

    pub fn configure(&self, request: ConfigureRequest) -> StudioResult<DesktopStatus> {
        if !self
            .processes
            .lock()
            .expect("process lock poisoned")
            .is_empty()
        {
            return Err(error(
                "finish or cancel active runs before changing desktop settings",
            ));
        }
        let workspace = expand_user_path(&request.workspace)?;
        fs::create_dir_all(&workspace)?;
        let workspace = workspace.canonicalize()?;
        let mere_run_command = resolve_required_command(&request.mere_run_command, "mere.run")?;
        let workflow_tools_command = if request.workflow_tools_command.trim().is_empty() {
            None
        } else {
            Some(resolve_required_command(
                &request.workflow_tools_command,
                "workflow tools",
            )?)
        };
        let config = AppConfig {
            schema_version: CONFIG_SCHEMA_VERSION,
            onboarding_complete: request.onboarding_complete,
            workspace,
            mere_run_command: Some(mere_run_command),
            workflow_tools_command,
        };
        write_json_atomic(&self.config_path, &serde_json::to_value(&config)?)?;
        *self.config.write().expect("desktop config lock poisoned") = config;
        self.ensure_workspace_layout()?;
        self.runs.lock().expect("runs lock poisoned").clear();
        self.restore_runs()?;
        Ok(self.status())
    }

    pub fn catalog(&self) -> StudioResult<Value> {
        self.run_mere(&["graph", "catalog", "--json"])
            .map(|result| result.document())
    }

    pub fn executors(&self) -> StudioResult<Value> {
        self.run_mere(&["executor", "list", "--json"])
            .map(|result| result.document())
    }

    pub fn projects(&self) -> StudioResult<Value> {
        let workspace = self.workspace();
        let state_root = workspace.join(".mere-graph-studio");
        let mut projects = Vec::new();
        for entry in WalkDir::new(&workspace).follow_links(false).into_iter() {
            let entry = entry?;
            if !entry.file_type().is_file()
                || !entry
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".workflow.json")
            {
                continue;
            }
            let path = entry.path();
            if path.starts_with(&state_root) {
                continue;
            }
            let relative = path
                .strip_prefix(&workspace)
                .map_err(|_| error("workflow project escaped its workspace"))?;
            let relative_text = relative.to_string_lossy().replace('\\', "/");
            let project_path = relative_text
                .strip_suffix(".workflow.json")
                .unwrap_or(&relative_text)
                .to_owned();
            let modified = entry
                .metadata()?
                .modified()
                .ok()
                .map(DateTime::<Utc>::from)
                .unwrap_or_else(Utc::now)
                .to_rfc3339();
            let name = entry
                .file_name()
                .to_string_lossy()
                .strip_suffix(".workflow.json")
                .unwrap_or(&entry.file_name().to_string_lossy())
                .to_owned();
            projects.push(json!({ "path": project_path, "name": name, "modified_at": modified }));
            if projects.len() >= MAX_PROJECTS {
                break;
            }
        }
        projects.sort_by(|left, right| {
            left.get("path")
                .and_then(Value::as_str)
                .cmp(&right.get("path").and_then(Value::as_str))
        });
        Ok(json!({ "projects": projects }))
    }

    pub fn load_project(&self, raw_path: &str) -> StudioResult<Value> {
        let base = self.project_base(raw_path)?;
        let (graph_path, inputs_path, sidecar_path) = project_paths(&base);
        if !graph_path.is_file() {
            return Err(error(format!(
                "workflow project does not exist: {raw_path}"
            )));
        }
        let mut project = Map::from_iter([
            ("path".to_owned(), Value::String(raw_path.to_owned())),
            (
                "graph".to_owned(),
                read_required_json(&graph_path, "workflow graph")?,
            ),
            (
                "inputs".to_owned(),
                read_optional_json(&inputs_path)?.unwrap_or_else(|| json!({})),
            ),
            (
                "sidecar".to_owned(),
                read_optional_json(&sidecar_path)?.unwrap_or_else(default_sidecar),
            ),
        ]);
        if let Some(program) = read_optional_json(&project_program_path(&base))?
            && program.is_object()
        {
            project.insert("program".to_owned(), program);
        }
        Ok(Value::Object(project))
    }

    pub fn save_project(&self, body: Value) -> StudioResult<Value> {
        let body = required_map(&body, "project")?;
        let raw_path = required_string(body, "path", None)?;
        let base = self.project_base(raw_path)?;
        let graph = required_object_value(body.get("graph"), "graph")?;
        let inputs = object_value_or(body.get("inputs"), json!({}), "inputs")?;
        let sidecar = object_value_or(body.get("sidecar"), default_sidecar(), "sidecar")?;
        validate_project_documents(&graph, &sidecar)?;
        if let Some(parent) = base.parent() {
            fs::create_dir_all(parent)?;
        }
        let (graph_path, inputs_path, sidecar_path) = project_paths(&base);
        write_json_atomic(&graph_path, &graph)?;
        write_json_atomic(&inputs_path, &inputs)?;
        write_json_atomic(&sidecar_path, &sidecar)?;
        let program_path = project_program_path(&base);
        if let Some(program) = body.get("program").filter(|value| value.is_object()) {
            write_json_atomic(&program_path, program)?;
        } else if program_path.is_file() {
            fs::remove_file(program_path)?;
        }
        Ok(json!({ "status": "saved", "path": raw_path }))
    }

    pub fn export_project(&self, body: Value) -> StudioResult<Value> {
        let body = required_map(&body, "project")?;
        let graph = required_object_value(body.get("graph"), "graph")?;
        let inputs = object_value_or(body.get("inputs"), json!({}), "inputs")?;
        let sidecar = object_value_or(body.get("sidecar"), default_sidecar(), "sidecar")?;
        validate_project_documents(&graph, &sidecar)?;
        let mut package = Map::from_iter([
            (
                "contract_version".to_owned(),
                Value::String(PROJECT_PACKAGE_CONTRACT.to_owned()),
            ),
            ("graph".to_owned(), graph),
            ("inputs".to_owned(), inputs),
            ("sidecar".to_owned(), sidecar),
        ]);
        if let Some(program) = body.get("program").filter(|value| value.is_object()) {
            package.insert("program".to_owned(), program.clone());
        }
        Ok(Value::Object(package))
    }

    pub fn import_project(&self, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "project package")?;
        if object.get("contract_version").and_then(Value::as_str) != Some(PROJECT_PACKAGE_CONTRACT)
        {
            return Err(error(format!(
                "project package must use {PROJECT_PACKAGE_CONTRACT}"
            )));
        }
        let mut package = self.export_project(body)?;
        package
            .as_object_mut()
            .expect("exported project is an object")
            .remove("contract_version");
        Ok(package)
    }

    fn workspace(&self) -> PathBuf {
        self.config
            .read()
            .expect("desktop config lock poisoned")
            .workspace
            .clone()
    }

    fn ensure_workspace_layout(&self) -> StudioResult<()> {
        let workspace = self.workspace();
        fs::create_dir_all(workspace.join(".mere-graph-studio/requests"))?;
        fs::create_dir_all(workspace.join(".mere-graph-studio/templates"))?;
        fs::create_dir_all(workspace.join("assets"))?;
        fs::create_dir_all(workspace.join("runs"))?;
        Ok(())
    }

    pub fn import_assets(&self, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "asset import request")?;
        let paths = object
            .get("paths")
            .and_then(Value::as_array)
            .ok_or_else(|| error("asset import paths must be an array"))?;
        if paths.is_empty() {
            return Err(error("select at least one file to import"));
        }
        if paths.len() > MAX_IMPORTED_ASSETS {
            return Err(error(format!(
                "a single drop can import at most {MAX_IMPORTED_ASSETS} files"
            )));
        }
        let sources = paths
            .iter()
            .map(|raw_path| {
                let raw_path = raw_path
                    .as_str()
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| error("asset import paths must be non-empty strings"))?;
                let source = PathBuf::from(raw_path).canonicalize()?;
                if !source.is_file() {
                    return Err(error(format!("asset is not a file: {raw_path}")));
                }
                let source_name = source
                    .file_name()
                    .and_then(|value| value.to_str())
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| error(format!("asset name is invalid: {raw_path}")))?
                    .to_owned();
                Ok((source, source_name))
            })
            .collect::<StudioResult<Vec<_>>>()?;
        let batch = Uuid::new_v4().simple().to_string();
        let destination_root = self.workspace().join("assets").join(&batch);
        fs::create_dir_all(&destination_root)?;
        let mut imported = Vec::with_capacity(sources.len());
        let mut used_names = HashSet::new();
        for (source, source_name) in sources {
            let stored_name = unique_file_name(&portable_file_name(&source_name), &mut used_names);
            let destination = destination_root.join(&stored_name);
            let size_bytes = fs::copy(&source, &destination)?;
            let relative = format!("assets/{batch}/{stored_name}");
            imported.push(json!({
                "name": source_name,
                "path": relative,
                "content_type": content_type_for_path(&destination),
                "size_bytes": size_bytes,
            }));
        }
        Ok(json!({ "assets": imported }))
    }

    pub fn input_asset_bytes(&self, raw_path: &str) -> StudioResult<Vec<u8>> {
        validate_relative_path(raw_path, "input asset")?;
        let workspace = self.workspace().canonicalize()?;
        let path = workspace.join(Path::new(raw_path)).canonicalize()?;
        if !path.starts_with(&workspace) || !path.is_file() {
            return Err(error("input asset is unavailable"));
        }
        Ok(fs::read(path)?)
    }

    fn project_base(&self, raw_path: &str) -> StudioResult<PathBuf> {
        validate_relative_path(raw_path, "project")?;
        Ok(self.workspace().join(Path::new(raw_path)))
    }

    fn workspace_path(&self, raw_path: &str) -> StudioResult<PathBuf> {
        validate_relative_path(raw_path, "workspace")?;
        Ok(self.workspace().join(Path::new(raw_path)))
    }

    fn run_mere(&self, args: &[&str]) -> StudioResult<CommandResult> {
        let command = self
            .config
            .read()
            .expect("desktop config lock poisoned")
            .mere_run_command
            .clone()
            .ok_or_else(|| {
                error("mere.run is not configured; open Desktop Settings to locate it")
            })?;
        self.run_command(
            &command,
            args.iter().map(|value| value.to_string()).collect(),
        )
    }

    fn run_workflow_tools(&self, args: Vec<String>) -> StudioResult<CommandResult> {
        let command = self
            .config
            .read()
            .expect("desktop config lock poisoned")
            .workflow_tools_command
            .clone()
            .ok_or_else(|| error("workflow tools are unavailable"))?;
        self.run_command(&command, args)
    }

    fn run_command(&self, command: &Path, args: Vec<String>) -> StudioResult<CommandResult> {
        let output = Command::new(command)
            .args(args)
            .current_dir(self.workspace())
            .output()?;
        Ok(CommandResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }

    /// Structured dry-run for installing a model. Mirrors `check`/`executors`:
    /// `mere.run model pull <target> --preflight --json` returns support,
    /// download size, disk headroom, usage-terms, and declarative actions.
    pub fn model_preflight(&self, request: Value) -> StudioResult<Value> {
        let object = required_map(&request, "model preflight request")?;
        let target = required_string(object, "target", None)?.to_owned();
        validate_model_id(&target)?;
        self.run_mere(&["model", "pull", &target, "--preflight", "--json"])
            .map(|result| result.document())
    }

    /// Begin a local model install on a background thread and return the initial
    /// tracking record. `mere.run model pull` has no `--json` for a live pull, so
    /// the reader thread distils its stderr progress lines into a `ModelPull`
    /// that the frontend polls through `inspect_model_pull`.
    pub fn start_model_pull(self: &Arc<Self>, request: Value) -> StudioResult<Value> {
        let object = required_map(&request, "model pull request")?;
        let target = required_string(object, "target", None)?.to_owned();
        validate_model_id(&target)?;
        let accept_license = object
            .get("accept_license")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let allow_unsupported = object
            .get("allow_unsupported")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let force = object
            .get("force")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        // Locating the binary now surfaces a configuration error to the caller
        // rather than silently failing on the worker thread.
        let command = self.mere_run_command()?;

        {
            let mut pulls = self.model_pulls.lock().expect("model pull lock poisoned");
            if pulls.get(&target).is_some_and(ModelPull::is_active) {
                return serde_json::to_value(&pulls[&target]).map_err(Into::into);
            }
            pulls.insert(target.clone(), ModelPull::preparing(&target, now()));
        }

        let mut args = vec!["model".to_owned(), "pull".to_owned(), target.clone()];
        if accept_license {
            args.push("--accept-model-license".to_owned());
        }
        if allow_unsupported {
            args.push("--allow-unsupported".to_owned());
        }
        if force {
            args.push("--force".to_owned());
        }

        let service = Arc::clone(self);
        let workspace = self.workspace();
        let pull_target = target.clone();
        thread::Builder::new()
            .name(format!("studio-model-pull-{pull_target}"))
            .spawn(move || service.execute_model_pull(&pull_target, &command, args, &workspace))?;
        let record = self
            .model_pulls
            .lock()
            .expect("model pull lock poisoned")
            .get(&target)
            .cloned();
        record
            .map(|value| serde_json::to_value(&value).map_err(Into::into))
            .unwrap_or_else(|| Ok(Value::Null))
    }

    pub fn inspect_model_pull(&self, target: &str) -> StudioResult<Value> {
        let record = self
            .model_pulls
            .lock()
            .expect("model pull lock poisoned")
            .get(target)
            .cloned()
            .ok_or_else(|| error(format!("no model install is tracked for {target}")))?;
        serde_json::to_value(&record).map_err(Into::into)
    }

    fn execute_model_pull(
        &self,
        target: &str,
        command: &Path,
        args: Vec<String>,
        workspace: &Path,
    ) {
        let child = Command::new(command)
            .args(&args)
            .current_dir(workspace)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match child {
            Ok(child) => child,
            Err(reason) => {
                self.fail_model_pull(target, &format!("could not start model pull: {reason}"));
                return;
            }
        };
        let stderr = child.stderr.take();
        let stdout = child.stdout.take();
        let stdout_reader = thread::spawn(move || {
            let mut buffer = Vec::new();
            if let Some(mut pipe) = stdout {
                let _ = pipe.read_to_end(&mut buffer);
            }
            buffer
        });
        if let Some(stderr) = stderr {
            self.stream_model_pull_stderr(target, stderr);
        }
        let status = child.wait();
        let install_path = stdout_reader
            .join()
            .ok()
            .map(|bytes| String::from_utf8_lossy(&bytes).trim().to_owned())
            .filter(|value| !value.is_empty());
        match status {
            Ok(status) if status.success() => self.finish_model_pull(target, install_path),
            Ok(status) => self.fail_model_pull(
                target,
                &format!(
                    "model pull exited with status {}",
                    status.code().unwrap_or(-1)
                ),
            ),
            Err(reason) => self.fail_model_pull(target, &format!("model pull failed: {reason}")),
        }
    }

    /// Read the child's stderr in real time. `mere.run` rewrites its progress in
    /// place with carriage returns, so we split on both `\r` and `\n` rather than
    /// buffering to EOF, and fold each segment into the tracked record.
    fn stream_model_pull_stderr(&self, target: &str, pipe: impl Read) {
        let mut reader = std::io::BufReader::new(pipe);
        let mut segment: Vec<u8> = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            match reader.read(&mut byte) {
                Ok(0) => break,
                Ok(_) => {
                    if byte[0] == b'\r' || byte[0] == b'\n' {
                        self.flush_pull_segment(target, &mut segment);
                    } else {
                        segment.push(byte[0]);
                    }
                }
                Err(_) => break,
            }
        }
        self.flush_pull_segment(target, &mut segment);
    }

    fn flush_pull_segment(&self, target: &str, segment: &mut Vec<u8>) {
        if segment.is_empty() {
            return;
        }
        let line = String::from_utf8_lossy(segment).trim().to_owned();
        segment.clear();
        if !line.is_empty() {
            self.apply_pull_progress(target, &line);
        }
    }

    fn apply_pull_progress(&self, target: &str, line: &str) {
        let progress = parse_pull_progress(line);
        let mut pulls = self.model_pulls.lock().expect("model pull lock poisoned");
        let Some(record) = pulls.get_mut(target) else {
            return;
        };
        if !record.is_active() {
            return;
        }
        let mut buffer = format!("{}\n{line}", record.stderr);
        buffer = tail(buffer.trim_start_matches('\n'), MAX_DIAGNOSTIC_BYTES);
        record.stderr = buffer;
        record.detail = Some(line.to_owned());
        if let Some(percent) = progress.percent {
            record.percent = Some(percent);
        }
        if let Some(received) = progress.received_bytes {
            record.received_bytes = Some(received);
        }
        if let Some(total) = progress.total_bytes {
            record.total_bytes = Some(total);
        }
        record.state = if progress.installing {
            "installing".to_owned()
        } else if progress.percent.is_some() || progress.received_bytes.is_some() {
            "downloading".to_owned()
        } else {
            record.state.clone()
        };
        record.updated_at = now();
    }

    fn finish_model_pull(&self, target: &str, install_path: Option<String>) {
        let mut pulls = self.model_pulls.lock().expect("model pull lock poisoned");
        if let Some(record) = pulls.get_mut(target) {
            record.state = "installed".to_owned();
            record.percent = Some(100.0);
            if record.total_bytes.is_some() {
                record.received_bytes = record.total_bytes;
            }
            record.install_path = install_path;
            record.detail = Some("Installed".to_owned());
            record.updated_at = now();
        }
    }

    fn fail_model_pull(&self, target: &str, message: &str) {
        let mut pulls = self.model_pulls.lock().expect("model pull lock poisoned");
        if let Some(record) = pulls.get_mut(target) {
            record.state = "failed".to_owned();
            let detail = record
                .stderr
                .lines()
                .rev()
                .find(|line| !line.trim().is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| message.to_owned());
            record.detail = Some(detail);
            record.updated_at = now();
        }
    }
}
