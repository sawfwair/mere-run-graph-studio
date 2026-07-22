# Product

## Purpose

Mere Graph Studio makes portable workflows understandable and operable without
turning the visual editor into a runtime. A user should be able to compose once,
preflight against any executor, run on available hardware, and inspect the same
artifacts and diagnostics everywhere.

## Product lanes

1. **Author**: typed nodes and ports, first-class creative material cards,
   promote/inline gestures, canvas-native graph inputs and outputs, native
   multi-file drop, groups, notes, reusable modules, maps, and compile-time
   branches.
2. **Prepare**: schema validation, capability preflight, model actions, resource
   requirements, secret names, and deterministic materialization preview.
3. **Run**: local, SSH, and Relay submission with event timelines,
   source-correlated on-canvas generation galleries, cancellation, retry,
   resume, and cache evidence. A graph can also run as an **app** — its exposed
   inputs become a form and its outputs a results gallery — and fan into
   **variation** sweeps that compare many results at once on local compute.
4. **Inspect**: artifacts, hashes, provenance, node fingerprints, diagnostics,
   attempts, and portable run reports.
5. **Bridge**: native templates and conservative Comfy workflow import without
   making Comfy the execution engine.
6. **Transfer**: one-file project import and export while preserving graph,
   inputs, program source, and editor state as separate typed documents.
7. **Cloud**: Mere World sign-in, private project persistence, live fleet
   catalog, placement preflight, and Relay run operations from any modern
   browser without moving model execution into the website.

## Interaction model

Studio has two presentation modes over one project model:

- **Easy** keeps the typed canvas, templates, essential arguments, executor
  target, validation, runs, and inspection immediately available. Optional
  fields remain reachable in the inspector without turning every node into a
  wall of optional ports. The App surface turns the same graph into a
  form-and-gallery anyone can run without touching the node graph.
- **Pro** adds reusable programs, executable JSON, multi-executor preparation,
  full schema editing, graph organization, and detailed run operations.

Changing modes must not mutate executable or editor documents, silently change
the executor, or discard selection and recovery state. Expert surfaces hidden
by Easy mode return unchanged when Pro mode is restored.

The desktop layout keeps the catalog, workspace, and inspector visible together.
As space narrows, controls collapse to familiar icons with tooltips; on phones,
the catalog and inspector become peer workspace tabs. The executor target and
Run command remain visible at every supported width.

The command palette exposes actions, nodes, and templates without creating a
second command system. Keyboard shortcuts invoke the same application actions,
and dialogs, tabs, modes, buttons, and diagnostics retain semantic labels for
keyboard and assistive-technology use.

On desktop, dropping files on the canvas is an explicit authoring action. Each
file is copied into the configured workspace and becomes a separate typed graph
input card; the executable workflow continues to reference the input by name.
Hosted Studio does not pretend browser-local files are portable and reports
that asset upload requires a supported cloud materialization path.

## Product test

Studio succeeds when a graph can be authored once, preflighted against multiple
executors, submitted unchanged, and understood later from the same graph,
events, diagnostics, hashes, and artifacts. Canvas convenience must never make
the JSON contract less portable or less inspectable.

The interface also succeeds when an Easy-mode user and a Pro-mode user can open
the same recovered project, see the same executor, and produce byte-equivalent
workflow and input documents.

## Non-goals

- arbitrary shell nodes;
- provider billing or infrastructure ownership;
- a second graph format;
- visual state embedded in executable graph documents;
- hidden model pulls or implicit license acceptance.
