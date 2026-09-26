fn parse_runtime_version(value: &str) -> Option<Vec<u32>> {
    let regex = Regex::new(r"(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:$|\s)").ok()?;
    let matched = regex.captures(value)?;
    (1..=3)
        .map(|index| matched.get(index)?.as_str().parse().ok())
        .collect()
}

fn compatible_runtime(path: &Path, version: &str) -> StudioResult<()> {
    let matrix: Value = serde_json::from_str(include_str!(
        "../../contracts/fixtures/graph-v1/graph-compatibility.v1.json"
    ))?;
    let minimum = matrix["components"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["id"] == "mere.run"))
        .and_then(|item| item["minimum_version"].as_str())
        .ok_or_else(|| error("missing runtime compatibility version"))?;
    if parse_runtime_version(version)
        .zip(parse_runtime_version(minimum))
        .is_none_or(|(actual, expected)| actual < expected)
    {
        return Err(error(format!(
            "Graph Studio requires mere.run {minimum} or newer"
        )));
    }
    let output = Command::new(path)
        .args(["graph", "catalog", "--json"])
        .output()?;
    let catalog: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| error("Runtime did not return a JSON graph catalog"))?;
    if !output.status.success()
        || catalog["graph_schema_version"] != 1
        || catalog["graph_kind"] != "mere.run/workflow-graph"
    {
        return Err(error("Runtime does not support the Studio graph contract"));
    }
    Ok(())
}

impl StudioService {
    pub fn open_runtime_downloads(&self) -> StudioResult<Value> {
        let url = "https://mere.run/releases";
        let mut command = if cfg!(target_os = "macos") {
            Command::new("open")
        } else if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args(["/c", "start", ""]);
            command
        } else {
            Command::new("xdg-open")
        };
        let status = command.arg(url).status()?;
        if !status.success() {
            return Err(error(format!(
                "Open {url} in your browser to install mere.run"
            )));
        }
        Ok(json!({ "opened": true }))
    }

    pub fn discover_tools(&self) -> StudioResult<Value> {
        let mut status = self.status();
        if !status.mere_run.available
            && let Some(path) = discover_command("mere.run")
        {
            status.mere_run = command_status(Some(&path), true);
        }
        if !status.workflow_tools.available {
            status.workflow_tools =
                command_status(discover_command("mere-dataset-tools").as_deref(), false);
        }
        Ok(serde_json::to_value(status)?)
    }

    pub fn plugins(&self) -> StudioResult<Value> {
        self.run_mere(&["plugin", "list", "--json"])
            .map(|result| result.document())
    }

    pub fn setup_plugin(&self, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "plugin setup")?;
        let id = required_string(object, "id", None)?;
        validate_model_id(id)?;
        let catalog = self.run_mere(&["plugin", "list", "--json"])?;
        let value: Value = serde_json::from_str(&catalog.stdout)?;
        if catalog.exit_code != 0
            || !value["plugins"]
                .as_array()
                .is_some_and(|plugins| plugins.iter().any(|plugin| plugin["id"] == id))
        {
            return Err(error("Select a plugin from the official runtime catalog"));
        }
        let mut args = vec!["plugin".to_owned(), "install".to_owned(), id.to_owned()];
        if object.get("confirmed").and_then(Value::as_bool) == Some(true) {
            args.push("--yes".to_owned());
        }
        let command = self.mere_run_command()?;
        self.run_command(&command, args)
            .map(|result| result.document())
    }

    pub fn verify_local(self: &Arc<Self>) -> StudioResult<Value> {
        let graph = local_verification_graph();
        let checked = self.check(
            json!({ "mode": "preflight", "executor": "local", "graph": graph, "inputs": {} }),
        )?;
        if checked["exit_code"] != 0 || checked["result"]["status"] != "ok" {
            return Err(error(format!(
                "Local verification preflight failed: {checked}"
            )));
        }
        let started =
            self.start_run(json!({ "executor": "local", "graph": graph, "inputs": {} }))?;
        let id = started["run"]["id"]
            .as_str()
            .or_else(|| started["id"].as_str())
            .ok_or_else(|| error("Verification run has no ID"))?;
        for _ in 0..120 {
            let run = self.required_run(id)?;
            if run.state == "finished" {
                let inspection = self.inspect_run(id)?;
                let manifest = &inspection["manifest"];
                let output = manifest["outputs"]
                    .as_array()
                    .and_then(|outputs| outputs.iter().find(|output| output["name"] == "message"))
                    .ok_or_else(|| {
                        error("Local verification did not declare its message output")
                    })?;
                let path = output["path"]
                    .as_str()
                    .ok_or_else(|| error("Local verification output has no path"))?;
                let bytes = fs::read(self.verified_artifact_path(id, path)?)?;
                let message: Value = serde_json::from_slice(&bytes)?;
                if message != "Graph Studio runs locally." {
                    return Err(error("Local verification output did not match"));
                }
                return Ok(
                    json!({ "verified": true, "message": "Graph Studio runs locally.", "run_id": id,
                    "run_directory": run.run_directory, "inspection": inspection }),
                );
            }
            if matches!(run.state.as_str(), "failed" | "cancelled") {
                return Err(error(format!("Local verification failed: {}", run.stderr)));
            }
            thread::sleep(Duration::from_millis(250));
        }
        Err(error(
            "Local verification is still running. Inspect its run in Studio.",
        ))
    }
}

fn local_verification_graph() -> Value {
    json!({ "schema_version": 1, "kind": "mere.run/workflow-graph", "name": "Local verification", "inputs": {},
        "nodes": [
            { "id": "subject", "kind": "text.value", "arguments": {"value": "Graph Studio"} },
            { "id": "action", "kind": "text.value", "arguments": {"value": "runs locally."} },
            { "id": "message", "kind": "text.join", "arguments": {"parts": [{"$ref": "nodes.subject.outputs.text"}, {"$ref": "nodes.action.outputs.text"}], "separator": " "} }
        ], "outputs": {"message": {"$ref": "nodes.message.outputs.text"}} })
}
