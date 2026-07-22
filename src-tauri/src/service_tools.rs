impl StudioService {
    pub fn check(&self, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "check request")?;
        let mode = required_string(object, "mode", None)?;
        if mode != "validate" && mode != "preflight" {
            return Err(error("check mode must be validate or preflight"));
        }
        let (graph, inputs) = self.write_request(object)?;
        let mut args = vec![
            "graph".to_owned(),
            mode.to_owned(),
            graph.display().to_string(),
            "--inputs-json".to_owned(),
            inputs.display().to_string(),
        ];
        if mode == "preflight" {
            args.extend([
                "--executor".to_owned(),
                required_string(object, "executor", Some("local"))?.to_owned(),
            ]);
        }
        args.push("--json".to_owned());
        let command = self.mere_run_command()?;
        Ok(self.run_command(&command, args)?.document())
    }

    pub fn compare_preflight(&self, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "preflight comparison")?;
        let (graph, inputs) = self.write_request(object)?;
        let executors = object
            .get("executors")
            .and_then(Value::as_array)
            .ok_or_else(|| error("executors must contain between 1 and 16 executor references"))?;
        if executors.is_empty() || executors.len() > MAX_PREFLIGHT_EXECUTORS {
            return Err(error(
                "executors must contain between 1 and 16 executor references",
            ));
        }
        let command = self.mere_run_command()?;
        let mut comparisons = Vec::with_capacity(executors.len());
        for executor in executors {
            let executor = executor
                .as_str()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| error("executor references must be non-empty strings"))?;
            let document = self
                .run_command(
                    &command,
                    vec![
                        "graph".to_owned(),
                        "preflight".to_owned(),
                        graph.display().to_string(),
                        "--inputs-json".to_owned(),
                        inputs.display().to_string(),
                        "--executor".to_owned(),
                        executor.to_owned(),
                        "--json".to_owned(),
                    ],
                )?
                .document();
            comparisons.push(json!({ "executor": executor, "document": document }));
        }
        Ok(json!({ "comparisons": comparisons }))
    }

    pub fn compile_program(&self, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "compile request")?;
        let program = required_object_value(object.get("program"), "workflow program")?;
        let request_directory = self.request_directory()?;
        let source = request_directory.join("workflow.program.json");
        let graph = request_directory.join("compiled.workflow.json");
        let report = request_directory.join("compile-report.json");
        write_json_atomic(&source, &program)?;
        let result = self.run_workflow_tools(vec![
            "graph".to_owned(),
            "compile".to_owned(),
            source.display().to_string(),
            "--output".to_owned(),
            graph.display().to_string(),
            "--report-output".to_owned(),
            report.display().to_string(),
            "--json".to_owned(),
        ])?;
        if result.exit_code != 0 || !graph.is_file() || !report.is_file() {
            return Err(error(if result.stderr.is_empty() {
                "workflow program compilation failed".to_owned()
            } else {
                result.stderr
            }));
        }
        Ok(json!({
            "graph": read_required_json(&graph, "compiled workflow graph")?,
            "report": read_required_json(&report, "workflow compile report")?,
            "document": result.document(),
        }))
    }

    pub fn templates(&self) -> StudioResult<Value> {
        let local_templates = self.local_templates()?;
        let tools = self
            .config
            .read()
            .expect("desktop config lock poisoned")
            .workflow_tools_command
            .clone();
        let Some(command) = tools else {
            return Ok(json!({
                "available": !local_templates.is_empty(),
                "document": synthetic_document(json!({
                    "contract_version": "mere.run/graph-template-catalog.v1",
                    "templates": local_templates,
                })),
            }));
        };
        let result = self.run_command(
            &command,
            vec![
                "graph".to_owned(),
                "templates".to_owned(),
                "list".to_owned(),
                "--json".to_owned(),
            ],
        )?;
        let mut document = result.document();
        if let Some(templates) = document
            .get_mut("result")
            .and_then(Value::as_object_mut)
            .and_then(|result| result.get_mut("templates"))
            .and_then(Value::as_array_mut)
        {
            let known: HashSet<String> = local_templates
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_owned))
                .collect();
            let mut combined = local_templates.clone();
            combined.extend(
                templates
                    .iter()
                    .filter(|item| {
                        item.get("id")
                            .and_then(Value::as_str)
                            .is_none_or(|id| !known.contains(id))
                    })
                    .cloned(),
            );
            *templates = combined;
        }
        Ok(json!({
            "available": result.exit_code == 0 || !local_templates.is_empty(),
            "document": document,
        }))
    }

    pub fn load_template(&self, template_id: &str) -> StudioResult<Value> {
        if let Some(local) = self
            .local_templates()?
            .into_iter()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(template_id))
        {
            let graph_name = local
                .get("graph")
                .and_then(Value::as_str)
                .ok_or_else(|| error("local template graph is invalid"))?;
            let inputs_name = local
                .get("inputs")
                .and_then(Value::as_str)
                .ok_or_else(|| error("local template inputs are invalid"))?;
            let root = self.template_root();
            return Ok(json!({
                "graph": read_required_json(&root.join(graph_name), "local workflow template")?,
                "inputs": read_required_json(&root.join(inputs_name), "local workflow inputs")?,
                "sidecar": default_sidecar(),
                "document": synthetic_document(json!({
                    "status": "loaded",
                    "template_id": template_id,
                    "source": "local",
                })),
            }));
        }
        let request_directory = self.request_directory()?;
        let output = request_directory.join("template.workflow.json");
        let result = self.run_workflow_tools(vec![
            "graph".to_owned(),
            "templates".to_owned(),
            "export".to_owned(),
            template_id.to_owned(),
            "--output".to_owned(),
            output.display().to_string(),
            "--json".to_owned(),
        ])?;
        if result.exit_code != 0 || !output.is_file() {
            return Err(error(if result.stderr.is_empty() {
                format!("template export failed: {template_id}")
            } else {
                result.stderr
            }));
        }
        let graph = read_required_json(&output, "workflow template")?;
        Ok(json!({
            "inputs": default_inputs_for_graph(&graph)?,
            "graph": graph,
            "sidecar": default_sidecar(),
            "document": result.document(),
        }))
    }

    pub fn publish_template(&self, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "template")?;
        let request_directory = self.request_directory()?;
        let graph = request_directory.join("template.workflow.json");
        let inputs = request_directory.join("template.inputs.json");
        write_json_atomic(
            &graph,
            &required_object_value(object.get("graph"), "graph")?,
        )?;
        write_json_atomic(
            &inputs,
            &object_value_or(object.get("inputs"), json!({}), "inputs")?,
        )?;
        let template_id = required_string(object, "template_id", None)?;
        let mut args = vec![
            "graph".to_owned(),
            "templates".to_owned(),
            "publish".to_owned(),
            "--graph".to_owned(),
            graph.display().to_string(),
            "--inputs-json".to_owned(),
            inputs.display().to_string(),
            "--output-dir".to_owned(),
            self.template_root().display().to_string(),
            "--template-id".to_owned(),
            template_id.to_owned(),
            "--title".to_owned(),
            required_string(object, "title", None)?.to_owned(),
            "--description".to_owned(),
            required_string(object, "description", None)?.to_owned(),
        ];
        let tags = object
            .get("tags")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for tag in tags {
            let tag = tag
                .as_str()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| error("template tags must be non-empty strings"))?;
            args.extend(["--tag".to_owned(), tag.to_owned()]);
        }
        args.push("--json".to_owned());
        let result = self.run_workflow_tools(args)?;
        let descriptor = self
            .template_root()
            .join(format!("{template_id}.template.json"));
        if result.exit_code != 0 || !descriptor.is_file() {
            return Err(error(if result.stderr.is_empty() {
                "template publishing failed".to_owned()
            } else {
                result.stderr
            }));
        }
        Ok(json!({
            "template": read_required_json(&descriptor, "published template")?,
            "document": result.document(),
        }))
    }

    pub fn inspect_comfy(&self, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "Comfy inspection request")?;
        let request_directory = self.request_directory()?;
        let workflow = request_directory.join("comfy-workflow.json");
        let value = object
            .get("workflow")
            .cloned()
            .ok_or_else(|| error("workflow is required"))?;
        write_json_atomic(&workflow, &value)?;
        Ok(self
            .run_workflow_tools(vec![
                "graph".to_owned(),
                "comfy".to_owned(),
                "inspect".to_owned(),
                workflow.display().to_string(),
                "--json".to_owned(),
            ])?
            .document())
    }

    pub fn import_comfy(&self, body: Value) -> StudioResult<Value> {
        let object = required_map(&body, "Comfy import request")?;
        let model = required_string(object, "model", None)?;
        let request_directory = self.request_directory()?;
        let workflow = request_directory.join("comfy-workflow.json");
        let graph = request_directory.join("imported.workflow.json");
        let inputs = request_directory.join("imported.inputs.json");
        write_json_atomic(
            &workflow,
            object
                .get("workflow")
                .ok_or_else(|| error("workflow is required"))?,
        )?;
        let mut args = vec![
            "graph".to_owned(),
            "comfy".to_owned(),
            "import".to_owned(),
            workflow.display().to_string(),
            "--model".to_owned(),
            model.to_owned(),
            "--output".to_owned(),
            graph.display().to_string(),
            "--inputs-output".to_owned(),
            inputs.display().to_string(),
        ];
        if let Some(asset_root) = object
            .get("asset_root")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            args.extend([
                "--asset-root".to_owned(),
                self.workspace_path(asset_root)?.display().to_string(),
            ]);
        }
        args.push("--json".to_owned());
        let result = self.run_workflow_tools(args)?;
        if result.exit_code != 0 || !graph.is_file() || !inputs.is_file() {
            return Err(error(if result.stderr.is_empty() {
                "Comfy workflow import failed".to_owned()
            } else {
                result.stderr
            }));
        }
        Ok(json!({
            "graph": read_required_json(&graph, "imported workflow graph")?,
            "inputs": read_required_json(&inputs, "imported workflow inputs")?,
            "sidecar": default_sidecar(),
            "document": result.document(),
        }))
    }

    fn mere_run_command(&self) -> StudioResult<PathBuf> {
        self.config
            .read()
            .expect("desktop config lock poisoned")
            .mere_run_command
            .clone()
            .ok_or_else(|| error("mere.run is not configured; open Desktop Settings to locate it"))
    }

    fn request_directory(&self) -> StudioResult<PathBuf> {
        let path = self
            .workspace()
            .join(".mere-graph-studio/requests")
            .join(Uuid::new_v4().simple().to_string());
        fs::create_dir_all(&path)?;
        Ok(path)
    }

    fn write_request(&self, body: &Map<String, Value>) -> StudioResult<(PathBuf, PathBuf)> {
        let directory = self.request_directory()?;
        let graph = directory.join("workflow.json");
        let inputs = directory.join("inputs.json");
        write_json_atomic(&graph, &required_object_value(body.get("graph"), "graph")?)?;
        write_json_atomic(
            &inputs,
            &object_value_or(body.get("inputs"), json!({}), "inputs")?,
        )?;
        Ok((graph, inputs))
    }

    fn template_root(&self) -> PathBuf {
        self.workspace().join(".mere-graph-studio/templates")
    }

    fn local_templates(&self) -> StudioResult<Vec<Value>> {
        let root = self.template_root();
        let mut templates = Vec::new();
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            let path = entry.path();
            if !path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().ends_with(".template.json"))
            {
                continue;
            }
            let Some(value) = read_optional_json(&path)? else {
                continue;
            };
            if value.get("contract_version").and_then(Value::as_str)
                != Some("mere.run/graph-template-package.v1")
            {
                continue;
            }
            let Some(graph) = value.get("graph").and_then(Value::as_str) else {
                continue;
            };
            let Some(inputs) = value.get("inputs").and_then(Value::as_str) else {
                continue;
            };
            if Path::new(graph).file_name().and_then(|name| name.to_str()) != Some(graph)
                || Path::new(inputs).file_name().and_then(|name| name.to_str()) != Some(inputs)
                || !root.join(graph).is_file()
                || !root.join(inputs).is_file()
            {
                continue;
            }
            templates.push(value);
        }
        templates.sort_by(|left, right| {
            left.get("id")
                .and_then(Value::as_str)
                .cmp(&right.get("id").and_then(Value::as_str))
        });
        Ok(templates)
    }
}

fn default_inputs_for_graph(graph: &Value) -> StudioResult<Value> {
    let inputs = graph
        .get("inputs")
        .and_then(Value::as_object)
        .ok_or_else(|| error("graph inputs must be an object"))?;
    let mut values = Map::new();
    for (name, definition) in inputs {
        if let Some(default) = definition.get("default") {
            values.insert(name.clone(), default.clone());
        }
    }
    Ok(Value::Object(values))
}
