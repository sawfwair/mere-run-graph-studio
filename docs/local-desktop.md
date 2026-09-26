# Run Graph Studio locally

This guide is for people who want to author and run workflows on their computer without Mere Relay.

Graph Studio's Tauri app invokes the public `mere.run` CLI through its Rust host. The CLI owns validation, preflight, execution, model loading, plugins, and artifacts. Studio stores workflow, input, and editor documents separately in your chosen workspace. Local runs do not require a Mere World account or Relay connection.

## Set up the runtime

1. Install the official `mere.run` package for your operating system from [Mere releases](https://mere.run/releases). In **Desktop settings**, select **Get mere.run** to open the same page.
2. In **Desktop settings**, select **Find tools**. Studio searches standard command locations and, on macOS, `MereRun.app/Contents/Helpers/mere.run`.
3. Choose a workspace and save the detected `mere.run` executable. Studio checks the version against its compatibility matrix and reads the public graph catalog. You can also choose a compatible executable or a `MereRun.app` bundle manually.
4. In **Desktop settings**, select **Verify local execution**. Studio preflights and runs three connected, model-free nodes through the configured CLI. It checks the declared output artifact and shows the run directory.

The optional workflow-tools executable adds templates, program compilation, and ComfyUI import. Studio can run ordinary graphs without it.

## Prepare models and plugins

For a model node, select its model and download action in Studio. Review the model preflight, storage requirements, and usage terms before starting a download. Studio uses the public `mere.run model pull` command and tracks the installation. A catalog entry alone does not establish that a model is installed or ready to run.

In **Desktop settings**, expand **Optional plugins**. Select **Review installation** to see the official `mere.run plugin install` plan. Select **Install plugin** to run that plan through the same CLI. Studio accepts plugin IDs only from the runtime's public catalog. Plugin installation requires internet access unless the runtime has an offline installation source already configured.

Node cards and the library show the provider's declared network requirement:

- **Internet required** means the provider declares network access.
- **Local processing** means the provider declares no network access. Install its models and dependencies before disconnecting.
- **Network unspecified** means the provider did not declare the requirement. Run preflight and consult the provider before relying on offline operation.

Preflight checks the actual selected executor and workflow. A local executor does not make a node offline if that node calls an external service.

## Verify a packaged app

After building a macOS package, use the CLI inside the `.app` and a compatible `mere.run` executable:

```bash
GRAPH_STUDIO_OFFLINE=1 node scripts/verify-local-package.mjs \
  'src-tauri/target/release/bundle/macos/Mere Graph Studio.app/Contents/MacOS/mere-graph-studio' \
  /usr/local/bin/mere.run
```

The script runs the packaged executable with macOS network access denied. It configures an isolated temporary workspace, executes the model-free graph, verifies the output contents and runtime SHA-256, and prints a JSON proof with paths and digests. It does not test image generation or installed model inference. Keep the proof's run directory when investigating a failure.

Studio stores run tracking records under `.mere-graph-studio/run-records`. It leaves each new `runs/` destination empty for `mere.run` to materialize the immutable job bundle.
