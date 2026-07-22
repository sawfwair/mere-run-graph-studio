# Compatibility

Graph Studio consumes the same versioned contracts as `mere.run`, workflow
providers, Relay, and the node agent. It does not translate graphs into a
Studio-specific execution format.

| Component | Minimum compatible version | Responsibility |
| --- | --- | --- |
| `mere.run` | `0.24.0` | Graph validation, creative material intrinsics, immutable-bundle execution, SSH, and Relay clients |
| `mere-workflow-tools` | `0.3.0` | Provider SDK, compiler, creative templates, and ComfyUI import |
| Mere Graph Studio | `0.3.0` | Offline Tauri desktop and hosted creative-material authoring UI |
| `mere.run-node` | `0.1.9` | Relay graph worker and fleet model plans |

The shared execution contracts are workflow graph schema 1,
`mere.run/job-bundle.v1`, and `mere.run/graph-run.v1`. Plugin providers use the
`mere.run/plugin-graph-*.v1` family. Programs, modules, and editor sidecars use
schema version 1 and compile to an immutable workflow graph before execution.

`contracts/fixtures/graph-v1/graph-compatibility.v1.json` is the machine-readable
matrix. Its canonical graph, inputs, and empty asset manifest must produce the
same fingerprints in Swift, TypeScript, and Rust. Repository gates fail
when any implementation drifts from those fingerprints.

Every Studio release embeds that matrix with the native application resources.
The release metadata repeats the minimum `mere.run`, workflow-tools, and node
versions so launchers and a future desktop updater can reject incompatible
combinations without scraping documentation.
