# Desktop distribution

Mere Graph Studio ships through Tauri's native bundlers. Release commits are
ordinary reviewed changes; pushing a `graph-studio-v*` tag builds four lanes and
creates a draft GitHub release:

| Lane | Build host | Output |
| --- | --- | --- |
| macOS Apple Silicon | macOS | `.app`, `.dmg` |
| macOS Intel | macOS | `.app`, `.dmg` |
| Windows x64 | Windows | `.msi`, NSIS setup executable |
| Linux x64 | Ubuntu | `.deb`, AppImage |

Each job uploads a target-specific `SHA256SUMS` file. Contract schemas and the
pinned compatibility matrix are embedded as application resources.

## Release gate

Before tagging:

```bash
./scripts/check.sh
pnpm desktop:build
```

The first command covers repository and JSON contracts, Rust formatting,
Clippy with warnings denied, Rust tests, TypeScript, frontend and Worker tests,
both production builds, the Worker dry run, and release-tool tests. Pull requests also
compile and test the native host on macOS and Windows, while the main gate runs
on Linux.

The tag version must equal the versions in `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and the compatibility
matrix. A repository test rejects version drift, reintroduced compatibility
hosts, or an authentication dependency in native Studio.

## macOS signing and notarization

Unsigned Apple Silicon CI packages receive an ad-hoc signature. Public release
packages should configure these encrypted repository secrets:

- `APPLE_CERTIFICATE`: base64 Developer ID Application `.p12`;
- `APPLE_CERTIFICATE_PASSWORD`;
- `KEYCHAIN_PASSWORD`: ephemeral CI keychain password;
- `APPLE_SIGNING_IDENTITY`: exact Developer ID Application identity;
- `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` for notarization.

The workflow imports the certificate into an ephemeral keychain. Tauri signs,
submits for notarization, and staples the result when all notarization values are
present.

## Windows signing

Configure:

- `WINDOWS_CERTIFICATE`: base64 Authenticode `.pfx`;
- `WINDOWS_CERTIFICATE_PASSWORD`.

The workflow imports the certificate into the current-user certificate store,
generates a temporary Tauri signing override with the imported thumbprint, and
uses SHA-256 plus DigiCert's timestamp service.

## Release proof

A release is complete only after all four jobs pass, the draft assets and
checksums are inspected, the macOS artifact passes Gatekeeper assessment and
notarization checks, the Windows installer reports a valid signature, and each
installed app completes first-run setup against a compatible `mere.run` client.
Publishing the draft remains a deliberate human release action.
