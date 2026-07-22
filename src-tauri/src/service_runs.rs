impl StudioService {
    pub fn start_run(self: &Arc<Self>, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "run request")?;
        let executor = required_string(object, "executor", Some("local"))?.to_owned();
        let graph = required_object_value(object.get("graph"), "graph")?;
        let inputs = object_value_or(object.get("inputs"), json!({}), "inputs")?;
        let id = Uuid::new_v4().simple().to_string()[..12].to_owned();
        let request_directory = self
            .workspace()
            .join(".mere-graph-studio/requests")
            .join(&id);
        fs::create_dir_all(&request_directory)?;
        let graph_path = request_directory.join("workflow.json");
        let inputs_path = request_directory.join("inputs.json");
        write_json_atomic(&graph_path, &graph)?;
        write_json_atomic(&inputs_path, &inputs)?;
        let graph_name = graph
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("workflow");
        let slug = slug(graph_name);
        let run_directory = self.workspace().join("runs").join(format!("{slug}-{id}"));
        fs::create_dir_all(&run_directory)?;
        let timestamp = now();
        let studio_run = StudioRun {
            id: id.clone(),
            executor,
            run_directory,
            graph_path,
            inputs_path,
            state: "starting".to_owned(),
            created_at: timestamp.clone(),
            updated_at: timestamp,
            exit_code: None,
            result: Value::Null,
            stderr: String::new(),
            remote_reference: None,
            history: vec![lifecycle_record(
                "created",
                "Run created in Studio",
                json!({ "executor": required_string(object, "executor", Some("local"))? }),
            )],
        };
        self.persist_run(&studio_run)?;
        self.runs
            .lock()
            .expect("runs lock poisoned")
            .insert(id.clone(), studio_run.clone());
        let service = Arc::clone(self);
        thread::Builder::new()
            .name(format!("studio-run-{id}"))
            .spawn(move || service.execute_run(&id, false))?;
        run_public(&studio_run, false)
    }

    pub fn list_runs(&self) -> StudioResult<Value> {
        let mut rows = self
            .runs
            .lock()
            .expect("runs lock poisoned")
            .values()
            .cloned()
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(json!({
            "runs": rows
                .iter()
                .map(|run| run_public(run, false))
                .collect::<StudioResult<Vec<_>>>()?,
        }))
    }

    pub fn inspect_run(&self, id: &str) -> StudioResult<Value> {
        let remote = {
            let runs = self.runs.lock().expect("runs lock poisoned");
            let run = runs
                .get(id)
                .ok_or_else(|| error(format!("unknown Studio run: {id}")))?;
            if run.remote_reference.is_some()
                && matches!(
                    run.state.as_str(),
                    "queued" | "assigned" | "running" | "submitting"
                )
            {
                run.remote_reference.clone()
            } else {
                None
            }
        };
        if let Some(reference) = remote {
            let result = self.run_mere(&["run", "inspect", &reference, "--json"])?;
            if result.exit_code == 0 {
                let document = result.document();
                let parsed = document.get("result").cloned().unwrap_or(Value::Null);
                let mut runs = self.runs.lock().expect("runs lock poisoned");
                let run = runs.get_mut(id).expect("run vanished while inspecting");
                if let Some(state) = find_run_state(&parsed) {
                    run.state = state.to_owned();
                }
                run.result = parsed;
                run.stderr = tail(&result.stderr, MAX_DIAGNOSTIC_BYTES);
                run.updated_at = now();
                self.persist_run(run)?;
            }
        }
        let run = self
            .runs
            .lock()
            .expect("runs lock poisoned")
            .get(id)
            .cloned()
            .ok_or_else(|| error(format!("unknown Studio run: {id}")))?;
        run_public(&run, true)
    }

    pub fn cancel_run(&self, id: &str) -> StudioResult<Value> {
        if let Some(process) = self
            .processes
            .lock()
            .expect("process lock poisoned")
            .get(id)
            .cloned()
        {
            let run_directory = self.required_run(id)?.run_directory;
            fs::write(run_directory.join("cancel.request"), now())?;
            process
                .lock()
                .expect("child process lock poisoned")
                .kill()?;
        }
        let remote = self.required_run(id)?.remote_reference;
        if let Some(reference) = remote {
            let _ = self.run_mere(&["run", "cancel", &reference, "--json"]);
        }
        let run = self.update_run(id, |run| {
            run.state = "cancelled".to_owned();
            run.history.push(lifecycle_record(
                "cancelled",
                "Cancellation requested",
                json!({}),
            ));
        })?;
        run_public(&run, false)
    }

    pub fn fetch_run(&self, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "fetch request")?;
        let id = required_string(object, "id", None)?;
        let run = self.required_run(id)?;
        let reference = run
            .remote_reference
            .clone()
            .ok_or_else(|| error("local runs do not need to be fetched"))?;
        let all_artifacts = object
            .get("all_artifacts")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let names = object
            .get("artifact_names")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if all_artifacts && !names.is_empty() {
            return Err(error(
                "artifact_names and all_artifacts are mutually exclusive",
            ));
        }
        let mut args = vec![
            "run".to_owned(),
            "fetch".to_owned(),
            reference,
            "--into".to_owned(),
            run.run_directory.display().to_string(),
        ];
        if all_artifacts {
            args.push("--all-artifacts".to_owned());
        }
        let mut string_names = Vec::new();
        for name in names {
            let name = name
                .as_str()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| error("artifact names must be non-empty strings"))?;
            string_names.push(name.to_owned());
            args.extend(["--artifact".to_owned(), name.to_owned()]);
        }
        args.push("--json".to_owned());
        self.update_run(id, |run| {
            run.history.push(lifecycle_record(
                "fetch_started",
                "Artifact fetch started",
                json!({ "all_artifacts": all_artifacts, "artifact_names": string_names }),
            ));
        })?;
        let command = self.mere_run_command()?;
        let result = self.run_command(&command, args)?;
        if result.exit_code != 0 {
            let message = if result.stderr.is_empty() {
                "Run fetch failed".to_owned()
            } else {
                result.stderr
            };
            self.update_run(id, |run| {
                run.history.push(lifecycle_record(
                    "fetch_failed",
                    &message,
                    json!({ "artifact_names": string_names }),
                ));
            })?;
            return Err(error(message));
        }
        let parsed = result
            .document()
            .get("result")
            .cloned()
            .unwrap_or(Value::Null);
        let run = self.update_run(id, |run| {
            run.result = parsed;
            run.history.push(lifecycle_record(
                "fetch_finished",
                "Artifact fetch verified",
                json!({ "all_artifacts": all_artifacts, "artifact_names": string_names }),
            ));
        })?;
        run_public(&run, true)
    }

    pub fn retry_run(&self, id: &str) -> StudioResult<Value> {
        let run = self.required_run(id)?;
        let reference = run
            .remote_reference
            .ok_or_else(|| error("local retries use graph run --resume"))?;
        let result = self.run_mere(&["run", "retry", &reference, "--json"])?;
        if result.exit_code != 0 {
            return Err(error(if result.stderr.is_empty() {
                "run retry failed".to_owned()
            } else {
                result.stderr
            }));
        }
        let parsed = result
            .document()
            .get("result")
            .cloned()
            .unwrap_or(Value::Null);
        let remote_reference = find_remote_reference(&parsed).map(str::to_owned);
        let run = self.update_run(id, |run| {
            run.result = parsed;
            if remote_reference.is_some() {
                run.remote_reference = remote_reference;
            }
            run.state = "queued".to_owned();
            run.history.push(lifecycle_record(
                "retried",
                "Remote retry requested",
                json!({}),
            ));
        })?;
        run_public(&run, true)
    }

    pub fn resume_run(self: &Arc<Self>, id: &str) -> StudioResult<Value> {
        let run = self.required_run(id)?;
        if run.remote_reference.is_some() {
            return Err(error("remote runs use retry instead of local resume"));
        }
        if self
            .processes
            .lock()
            .expect("process lock poisoned")
            .contains_key(id)
        {
            return Err(error("run is already active"));
        }
        let run = self.update_run(id, |run| {
            run.state = "starting".to_owned();
            run.history.push(lifecycle_record(
                "resumed",
                "Local resume requested",
                json!({}),
            ));
        })?;
        let service = Arc::clone(self);
        let id = id.to_owned();
        thread::Builder::new()
            .name(format!("studio-resume-{id}"))
            .spawn(move || service.execute_run(&id, true))?;
        run_public(&run, true)
    }

    pub fn artifact_bytes(&self, id: &str, raw_path: &str) -> StudioResult<Vec<u8>> {
        let run = self.required_run(id)?;
        validate_artifact_path(raw_path)?;
        let manifest = read_optional_json(&run.run_directory.join("run.json"))?;
        let declared: HashSet<String> = collect_run_artifacts(manifest.as_ref())
            .into_iter()
            .filter_map(|item| item.get("path").and_then(Value::as_str).map(str::to_owned))
            .collect();
        if !declared.contains(raw_path) {
            return Err(error("artifact is not declared by this run"));
        }
        let path = run.run_directory.join(Path::new(raw_path));
        let canonical_run = run.run_directory.canonicalize()?;
        let canonical_path = path.canonicalize()?;
        if !canonical_path.starts_with(&canonical_run) || !canonical_path.is_file() {
            return Err(error("artifact is unavailable"));
        }
        Ok(fs::read(canonical_path)?)
    }

    fn execute_run(self: Arc<Self>, id: &str, resume: bool) {
        if let Err(reason) = self.execute_run_inner(id, resume) {
            let message = reason.to_string();
            let _ = self.update_run(id, |run| {
                if run.state != "cancelled" {
                    run.state = "failed".to_owned();
                }
                run.stderr = message;
                run.history.push(lifecycle_record(
                    "execution_failed",
                    "Run process could not complete",
                    json!({}),
                ));
            });
        }
    }

    fn execute_run_inner(&self, id: &str, resume: bool) -> StudioResult<()> {
        let run = self.required_run(id)?;
        let command = self.mere_run_command()?;
        let mut args = vec!["graph".to_owned()];
        if run.executor == "local" {
            args.extend(["run".to_owned(), run.graph_path.display().to_string()]);
        } else {
            args.extend([
                "submit".to_owned(),
                run.graph_path.display().to_string(),
                "--executor".to_owned(),
                run.executor.clone(),
            ]);
        }
        args.extend([
            "--inputs-json".to_owned(),
            run.inputs_path.display().to_string(),
            "--run-dir".to_owned(),
            run.run_directory.display().to_string(),
        ]);
        if resume && run.executor == "local" {
            args.push("--resume".to_owned());
        }
        args.push("--json".to_owned());
        self.update_run(id, |run| {
            run.state = if run.executor == "local" {
                "running"
            } else {
                "submitting"
            }
            .to_owned();
            run.history.push(lifecycle_record(
                "execution_started",
                "Run process started",
                json!({ "resume": resume }),
            ));
        })?;

        let mut child = Command::new(command)
            .args(args)
            .current_dir(self.workspace())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| error("run stdout pipe is unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| error("run stderr pipe is unavailable"))?;
        let stdout_reader = thread::spawn(move || read_pipe(stdout));
        let stderr_reader = thread::spawn(move || read_pipe(stderr));
        let child = Arc::new(Mutex::new(child));
        self.processes
            .lock()
            .expect("process lock poisoned")
            .insert(id.to_owned(), Arc::clone(&child));
        let status = loop {
            match child
                .lock()
                .expect("child process lock poisoned")
                .try_wait()?
            {
                Some(status) => break status,
                None => thread::sleep(Duration::from_millis(100)),
            }
        };
        self.processes
            .lock()
            .expect("process lock poisoned")
            .remove(id);
        let stdout = stdout_reader
            .join()
            .map_err(|_| error("run stdout reader failed"))??;
        let stderr = stderr_reader
            .join()
            .map_err(|_| error("run stderr reader failed"))??;
        let stdout = String::from_utf8_lossy(&stdout).into_owned();
        let stderr = String::from_utf8_lossy(&stderr).into_owned();
        let parsed = if stdout.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&stdout)
                .unwrap_or_else(|_| json!({ "stdout": tail(&stdout, MAX_DIAGNOSTIC_BYTES) }))
        };
        let remote_reference = find_remote_reference(&parsed).map(str::to_owned);
        let exit_code = status.code().unwrap_or(-1);
        self.update_run(id, |run| {
            run.exit_code = Some(exit_code);
            run.stderr = tail(&stderr, MAX_DIAGNOSTIC_BYTES);
            run.result = parsed;
            run.remote_reference = remote_reference;
            if run.state != "cancelled" {
                run.state = if status.success() {
                    if run.remote_reference.is_some() {
                        "queued"
                    } else {
                        "finished"
                    }
                } else {
                    "failed"
                }
                .to_owned();
            }
            run.history.push(lifecycle_record(
                "execution_finished",
                &format!("Run process ended in state {}", run.state),
                json!({ "exit_code": exit_code }),
            ));
        })?;
        Ok(())
    }

    fn required_run(&self, id: &str) -> StudioResult<StudioRun> {
        self.runs
            .lock()
            .expect("runs lock poisoned")
            .get(id)
            .cloned()
            .ok_or_else(|| error(format!("unknown Studio run: {id}")))
    }

    fn update_run(&self, id: &str, update: impl FnOnce(&mut StudioRun)) -> StudioResult<StudioRun> {
        let mut runs = self.runs.lock().expect("runs lock poisoned");
        let run = runs
            .get_mut(id)
            .ok_or_else(|| error(format!("unknown Studio run: {id}")))?;
        update(run);
        run.updated_at = now();
        self.persist_run(run)?;
        Ok(run.clone())
    }

    fn persist_run(&self, run: &StudioRun) -> StudioResult<()> {
        fs::create_dir_all(&run.run_directory)?;
        write_json_atomic(&run.run_directory.join("studio-run.json"), &stored_run(run))
    }

    fn restore_runs(&self) -> StudioResult<()> {
        let run_root = self.workspace().join("runs");
        if !run_root.is_dir() {
            return Ok(());
        }
        let mut restored = HashMap::new();
        for entry in fs::read_dir(run_root)? {
            let entry = entry?;
            let run_directory = entry.path();
            let path = run_directory.join("studio-run.json");
            if !path.is_file() {
                continue;
            }
            let Ok(value) = read_required_json(&path, "Studio run") else {
                continue;
            };
            if let Ok(run) = restore_run(value, run_directory) {
                restored.insert(run.id.clone(), run);
            }
        }
        *self.runs.lock().expect("runs lock poisoned") = restored;
        Ok(())
    }
}
