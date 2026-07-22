$ErrorActionPreference = "Stop"

if (-not $env:WINDOWS_CERTIFICATE -or -not $env:WINDOWS_CERTIFICATE_PASSWORD) {
    throw "Windows signing secrets are incomplete"
}

$certificatePath = Join-Path $env:RUNNER_TEMP "mere-graph-studio-signing.pfx"
[IO.File]::WriteAllBytes($certificatePath, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE))
$password = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
$certificate = Import-PfxCertificate -FilePath $certificatePath -CertStoreLocation Cert:\CurrentUser\My -Password $password

$configuration = @{
    bundle = @{
        windows = @{
            certificateThumbprint = $certificate.Thumbprint
            digestAlgorithm = "sha256"
            timestampUrl = "http://timestamp.digicert.com"
        }
    }
}
$configuration | ConvertTo-Json -Depth 4 | Set-Content src-tauri/tauri.windows-signing.conf.json -Encoding UTF8
"args=--config src-tauri/tauri.windows-signing.conf.json" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
