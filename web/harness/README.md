# Visual harness

Renders the **real** editor `Workspace` against a mock runtime, so the UI can be
viewed and screenshotted without a Tauri or cloud backend. This is a development
tool — it is not part of any shipped bundle and is excluded from `web:check` /
`web:build`.

It exists because the app normally only runs inside Tauri (desktop) or behind
cloud auth, so there is no other way to render the editor shell in a plain
browser or headless screenshot.

## View it interactively

```bash
pnpm harness            # http://127.0.0.1:1433
```

State is driven by URL query params:

| param      | effect                                        |
| ---------- | --------------------------------------------- |
| `?left=1`  | start with the library rail collapsed         |
| `?right=1` | start with the inspector rail collapsed       |
| `?mode=pro`| start in Pro mode (default: Easy)             |
| `?empty=1` | start with an empty graph (default: 2-node)   |
| `?example=1` | show reusable values, workflow inputs and outputs, and a recorded result |
| `?live=1` | run a simulated timeline with progress and image outputs |
| `?live=failed` | run a simulated timeline where the video node fails |
| `?landing=1` | show the hosted landing page |

## Capture screenshots

```bash
pnpm harness:shoot                # verifies and captures desktop + mobile states
pnpm harness:shoot hero=mode=pro  # custom "name=query" shots
```

- Output goes to `web/harness/shots/` (gitignored). Override with `HARNESS_OUT`.
- The command checks inline prompt editing, undo, reference preservation,
  previous-run labeling, and library navigation. Live-run checks cover reported
  progress, early outputs, failure retention, pinning, comparison, and cancellation. It also checks desktop, tablet,
  and mobile layouts. Browser errors and horizontal overflow fail the check.
- Uses installed Google Chrome on macOS when available, otherwise Playwright's
  managed Chromium. Override with `HARNESS_BROWSER=/path/to/chrome`.

## Extending

- The `mock-runtime.ts` file provides the catalog, project, and runtime stubs.
  To review another runtime state, add a sample response to that file.
- The `node-fixture.ts` file provides connected nodes and a recorded output
  for the node design examples.

The `live-runtime.ts` fixture emits simulated events and SVG outputs. It does not
start inference or contact Relay. Pinned comparisons last for the editor session.
