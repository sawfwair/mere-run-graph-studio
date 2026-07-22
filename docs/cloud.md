# Hosted Graph Studio

The hosted Graph Studio is the browser authoring surface at
`https://studio.mere.run`. It does not turn the website into an inference
runtime. One durable broker claims each job, one compatible Node owns its
execution lease, and stale workers cannot settle another attempt.

## Ownership

| Surface | Authority |
| --- | --- |
| Mere World | account identity, PKCE client registration, launcher entry |
| Studio Worker | public site, HttpOnly session, account-scoped project documents |
| Relay | graph admission, placement preflight, queue, claims, leases, retries, run state, artifacts |
| paired Node | live catalog and provider inventory, local model process, graph worker execution |

## Project storage

Each account maps to one `StudioAccount` Durable Object. A project is confined
to a normalized relative path and stored as separate workflow, input, editor
sidecar, optional program, and summary values. Requests over 5 MiB are rejected.
OAuth tokens, executor profiles, and secret values are not project fields.

Project packages remain `mere.run/graph-studio-project.v1`; export wraps the
documents and import separates them again. The executable workflow graph never
contains editor state.

## Execution

The Node advertises its exact Graph v2 catalog and provider hashes during Relay
connection. Hosted Studio builds the same `mere.run/job-bundle.v1` manifest as
other clients, materializes omitted seeds, computes canonical SHA-256 graph and
input fingerprints, asks Relay for a non-persisting placement preflight, and
uses Relay's two-phase create/asset/commit API.

The current browser asset picker is intentionally not implicit: an asset-bound
argument is blocked before submission until the user selects an upload. The
desktop lane remains available for filesystem-bound workflows. Plain image and
video generation, provider-free typed graphs, project persistence, preflight,
submission, events, cancellation, retry, manifests, and artifacts use the
hosted path.

## Deployment order

1. Register `mererun-studio` and its exact callbacks in Mere World.
2. Deploy Relay/Node support so connected Nodes report live catalogs and Relay
   accepts non-persisting graph preflight.
3. Build and deploy this Worker and its static assets to `studio.mere.run`.
4. Verify login, project round-trip, a real paired-Node graph, artifact fetch,
   and launcher entry independently.

Production deployment requires `CLOUDFLARE_ACCOUNT_ID` in the deployer's
environment. The organization-specific account identifier is intentionally not
committed to the public repository.

`./scripts/check.sh` includes both static-site builds and a Wrangler dry run so
the desktop/browser release cannot merge while the hosted Worker fails to
bundle.
