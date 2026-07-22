# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include live
credentials, private project documents, or customer data in a report.

Use GitHub's private vulnerability-reporting form for this repository when it
is available under **Security → Report a vulnerability**. If that form is not
available, contact the maintainers privately through the Sawfwair GitHub
organization before sharing technical details.

Include the affected version or commit, platform, impact, reproduction steps,
and the smallest safe proof of concept. Redact tokens, filesystem paths, account
identifiers, and personal data. We will acknowledge a complete report as soon
as practical, investigate it privately, and coordinate disclosure after a fix
is available.

## Scope

Security-sensitive boundaries include:

- workspace and artifact path confinement in the native host;
- fixed-command invocation and parsing of external CLI output;
- imported graph, project, sidecar, and run documents;
- hosted OAuth, cookies, origin checks, account scoping, and Relay proxying;
- release signing, packaged assets, and dependency or workflow integrity.

The native desktop app deliberately has no account or network requirement.
Hosted execution, Relay, `mere.run`, provider implementations, and Mere World
have separate trust boundaries; a report may be redirected to the repository
that owns the affected behavior.

## Supported versions

Security fixes are applied to the latest release and `main`. Pre-1.0 releases
may be superseded rather than patched independently.
