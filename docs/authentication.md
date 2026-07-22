# Authentication

Authentication follows the execution boundary. It is never a prerequisite for
local Graph Studio.

| Surface | Identity required | Flow | Reason |
| --- | --- | --- | --- |
| Native Studio with local execution | No | None | Project files and `mere.run` execute on the same machine. |
| Native Studio with SSH execution | Only the configured SSH executor | Existing `mere.run` executor configuration | Studio delegates transport to the public CLI. |
| Native Studio with Relay execution | Yes, for Relay only | Existing `mere.run` Relay executor credentials | Relay jobs and artifacts are account scoped. |
| Hosted Studio | Yes | Mere World Authorization Code + PKCE | Cloud projects and Relay access are account scoped. |
| Mere Node joining Relay | Yes | OAuth device authorization grant | The Node has no browser callback and must remain signed in across restarts. |

## Offline desktop contract

The native app bundles the React editor and Rust orchestration host. Startup,
project creation, project persistence, catalog discovery, validation, local
preflight, and local runs do not call an authentication endpoint. Tauri IPC is
the only frontend-to-host transport. The repository gate rejects a browser
fallback, external network dependency, or authentication logic in the native
runtime.

Workflow tools remain optional. Their absence disables templates, program
compilation, and Comfy import but does not affect core local authoring or runs.

## Hosted Studio

`studio.mere.run` starts Mere World Authorization Code + PKCE and stores access
and refresh tokens only in HttpOnly, Secure, SameSite cookies. The browser calls
same-origin Worker routes. The Worker scopes project storage to the Mere account
and proxies only the allow-listed Relay graph API.

The hosted site is a Relay product, so it does not offer an unauthenticated
local-execution mode. Users who want offline or direct local execution use the
native app.

## Mere Node

Mere Node requests a device and user code from Relay, then displays or opens the
Mere World verification URL. The operator approves the code in any browser
while the Node polls Relay's token endpoint. The returned access and refresh
tokens are written atomically to the platform app-config directory with
owner-only permissions.

The Node refreshes expiring tokens and connects to the Relay agent WebSocket
with `Authorization: Bearer <access-token>`. It needs no local web server,
redirect URI, or open inbound port. Signing out clears the saved token set.

Node authentication is needed only to join Relay. It does not change how the
`mere.run` CLI performs direct local inference.
