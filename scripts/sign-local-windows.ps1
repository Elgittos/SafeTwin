param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path
)

$ErrorActionPreference = 'Stop'

$subject = 'CN=Luis Chaname SafeTwin Local Code Signing'
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
  Where-Object { $_.Subject -eq $subject } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $cert) {
  $cert = New-SelfSignedCertificate `
    -Subject $subject `
    -Type CodeSigningCert `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(5)
}

$tempCert = Join-Path $env:TEMP 'safetwin-local-code-signing.cer'
Export-Certificate -Cert $cert -FilePath $tempCert | Out-Null
Import-Certificate -FilePath $tempCert -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Import-Certificate -FilePath $tempCert -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null
Remove-Item -LiteralPath $tempCert -Force -ErrorAction SilentlyContinue

foreach ($filePath in $Path) {
  $resolvedPath = Resolve-Path -LiteralPath $filePath
  $signature = Set-AuthenticodeSignature `
    -FilePath $resolvedPath `
    -Certificate $cert `
    -HashAlgorithm SHA256

  if ($signature.Status -ne 'Valid') {
    throw "Signing failed for $resolvedPath. Status: $($signature.Status). $($signature.StatusMessage)"
  }

  Write-Host "Signed $resolvedPath"
}
