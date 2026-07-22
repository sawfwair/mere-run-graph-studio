# Hosted Worker module

`worker.ts` is the routing and security-header entry point. `auth.ts` owns Mere
World OAuth/PKCE and HttpOnly cookies. `account.ts` stores the four project
documents in an account-scoped Durable Object. `decode.ts` validates token JSON.

Only allow-listed Relay routes may be proxied. Mutations require the configured
same origin. Project documents may contain named secret references but never
credential values. The Worker does not execute graphs, persist provider secrets,
or change graph semantics. Add persistence tests to `account.test.ts` and route
security tests to `worker.test.ts`.
