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

On macOS, run the [packaged local execution check](local-desktop.md#verify-a-packaged-app) against the `.app` executable before treating an installer as locally verified. The check denies network access, runs a model-free graph through the Rust host and public CLI, and verifies its artifact bytes.

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

The GitHub release workflow builds ad-hoc macOS packages for draft CI assets.
It does not have the Sparkle signing key or publish the update feed.

The public Apple Silicon download is built from the pushed tag by the private
`mere-run-release-tools` repository. That path verifies the exact source,
Developer ID signature, notarization, staple, Gatekeeper acceptance, and public
R2 bytes. GitHub's macOS draft assets are separate from the signed public
download.

## Apple Silicon updates

The macOS app embeds pinned Sparkle 2.9.5. On launch it checks the signed
[Graph Studio appcast](https://mere.run/releases/graph-studio/appcast.xml) for
updates. **Help > Check for Updates…** starts an immediate check. Sparkle
validates the feed and DMG with a Graph Studio-specific EdDSA key; only its
public key is packaged in the app. It updates the complete app bundle, leaving
workflow documents and local workspace data in place.

The release tool publishes the signed feed only after the matching immutable
DMG is hosted and verified. The current feed serves Apple Silicon; Intel builds
and Windows/Linux packages continue to use their existing distribution paths.
The pinned Sparkle framework is downloaded from its official release with a
checked SHA-256 before macOS builds, then included and signed in the app bundle.

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
