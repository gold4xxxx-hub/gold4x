param(
  [string]$FtpHost = "145.79.213.128",
  [string]$FallbackHost = "gold4x.in",
  [string]$Username = "u165332974",
  [Parameter(Mandatory = $true)]
  [string]$Password,
  [string]$RemotePath = "/public_html",
  [switch]$SkipBuild,
  [switch]$SkipCleanup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-FtpUri {
  param(
    [string]$Server,
    [string]$Path
  )

  $normalized = $Path.Replace("\\", "/")
  if (-not $normalized.StartsWith("/")) {
    $normalized = "/$normalized"
  }

  return "ftp://$Server$normalized"
}

function Get-FtpAuth {
  param([System.Net.NetworkCredential]$Credential)
  return "$($Credential.UserName):$($Credential.Password)"
}

function Get-FtpItems {
  param(
    [string]$Server,
    [string]$Path,
    [System.Net.NetworkCredential]$Credential
  )

  $auth = Get-FtpAuth $Credential
  $url = New-FtpUri -Server $Server -Path $Path
  $raw = & curl.exe --silent --show-error $url --user $auth 2>&1
  if ($LASTEXITCODE -ne 0) { return @() }

  $items = @()
  foreach ($line in ($raw -split "`r?`n")) {
    $line = $line.Trim()
    if (-not $line) { continue }

    if ($line -match '^(d)[rwx\-]{9}\s+') {
      $parts = $line -split '\s+'
      $name = $parts[-1]
      if ($name -eq '.' -or $name -eq '..') { continue }
      $items += [PSCustomObject]@{ Name = $name; IsDirectory = $true }
    } elseif ($line -match '^(-)[rwx\-]{9}\s+') {
      $parts = $line -split '\s+'
      $name = $parts[-1]
      $items += [PSCustomObject]@{ Name = $name; IsDirectory = $false }
    }
  }

  return $items
}

function Remove-FtpTree {
  param(
    [string]$Server,
    [string]$Path,
    [System.Net.NetworkCredential]$Credential
  )

  $auth = Get-FtpAuth $Credential
  $items = Get-FtpItems -Server $Server -Path $Path -Credential $Credential
  if (-not $items) { return }

  $baseUrl = New-FtpUri -Server $Server -Path "/"

  foreach ($item in $items) {
    $childPath = "$($Path.TrimEnd('/'))/$($item.Name)"
    if ($item.IsDirectory) {
      Remove-FtpTree -Server $Server -Path $childPath -Credential $Credential
      & curl.exe --silent --show-error --fail --quote "RMD $childPath" $baseUrl --user $auth 2>$null
    } else {
      & curl.exe --silent --show-error --fail --quote "DELE $childPath" $baseUrl --user $auth 2>$null
    }
  }
}

function Upload-FileToFtp {
  param(
    [string]$Server,
    [string]$RemoteFilePath,
    [string]$LocalFilePath,
    [System.Net.NetworkCredential]$Credential
  )

  try {
    $ftpUrl = New-FtpUri -Server $Server -Path $RemoteFilePath
    $auth = Get-FtpAuth $Credential

    $maxAttempts = 4
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
      & curl.exe --silent --show-error --fail --ftp-create-dirs -T $LocalFilePath $ftpUrl --user $auth
      if ($LASTEXITCODE -eq 0) { break }
      if ($attempt -eq $maxAttempts) { throw "curl exited with code $LASTEXITCODE" }
      Start-Sleep -Seconds ([Math]::Min(8, $attempt * 2))
    }
  } catch {
    throw "Upload failed for '$RemoteFilePath' from '$LocalFilePath'. $($_.Exception.Message)"
  }
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$credential = New-Object System.Net.NetworkCredential($Username, $Password)
$server = $FtpHost
$auth = Get-FtpAuth $credential

Write-Host "Using FTP host: $server" -ForegroundColor Green

if (-not $SkipBuild) {
  Write-Host "`n==> Building static export" -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed" }
}

$outDir = Join-Path $projectRoot "out"
if (-not (Test-Path $outDir)) {
  throw "Static export folder not found at $outDir. Run npm run build first."
}

if (-not $SkipCleanup) {
  Write-Host "`n==> Removing previous remote data" -ForegroundColor Cyan
  Remove-FtpTree -Server $server -Path $RemotePath -Credential $credential
}

Write-Host "`n==> Uploading static files" -ForegroundColor Cyan
$outUri = New-FtpUri -Server $server -Path $RemotePath
Get-ChildItem -Path $outDir -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($outDir.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
  $remoteFile = "$($RemotePath.TrimEnd('/'))/$relative"
  Upload-FileToFtp -Server $server -RemoteFilePath $remoteFile -LocalFilePath $_.FullName -Credential $credential
}

Write-Host "`nFTP deploy completed successfully." -ForegroundColor Green
