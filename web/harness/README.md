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

## Screenshot it

```bash
pnpm harness:shoot                # verifies and captures desktop + mobile states
pnpm harness:shoot hero=mode=pro  # custom "name=query" shots
```

- Output goes to `web/harness/shots/` (gitignored). Override with `HARNESS_OUT`.
- The command fails on browser console errors or horizontal overflow at either
  the 1600x1000 desktop viewport or the 390x844 mobile viewport.
- Uses installed Google Chrome on macOS when available, otherwise Playwright's
  managed Chromium. Override with `HARNESS_BROWSER=/path/to/chrome`.

## Extending

- The catalog, canned project, and runtime stubs live in `mock-runtime.ts`.
  If a surface you want to screenshot calls a runtime method that currently
  throws, give it a canned return there.
