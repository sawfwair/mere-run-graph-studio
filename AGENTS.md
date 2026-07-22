# AGENTS.md

## Scope

Mere Graph Studio owns the optional authoring and operations experience for
portable `mere.run` workflow graphs. It does not own graph execution semantics,
provider implementations, model installation, hosted scheduling, or secrets.

## Boundaries

- Consume `mere.run` through its public JSON CLI and published schemas.
- Consume `mere-run-plugins` through public compiler, template, conformance,
  and Comfy bridge commands.
- Keep workflow, inputs, and editor sidecar documents separate.
- Never persist secret values. Graph documents may contain named secret
  references only.
- Keep stdout machine-readable for CLI commands and diagnostics on stderr.

## Validation

Run `./scripts/check.sh` before publishing changes. Browser and desktop work
must also be visually checked at desktop and mobile widths.

