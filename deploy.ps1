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

function New-FtpRequest {
  param(
    [string]$Server,
    [string]$Path,
    [string]$Method,
    [System.Net.NetworkCredential]$Credential
  )

  $request = [System.Net.FtpWebRequest]::Create((New-FtpUri -Server $Server -Path $Path))
  $request.Method = $Method
  $request.Credentials = $Credential
  $request.UseBinary = $true
  $request.UsePassive = $false
  $request.KeepAlive = $false
  return $request
}

function Read-FtpTextResponse {
  param(
    [System.Net.FtpWebRequest]$Request
  )

  $response = $Request.GetResponse()
  try {
    $stream = $response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    try {
      return $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
  } finally {
    $response.Dispose()
  }
}

function Parse-FtpListLine {
  param(
    [string]$Line
  )

  if (-not $Line) {
    return $null
  }

  if ($Line -match '^([d\-l])[rwx\-]{9}\s+\d+\s+\S+\s+\S+\s+\d+\s+\w+\s+\d+\s+[\d:]+\s+(.+)$') {
    return [PSCustomObject]@{
      Name = $Matches[2]
      IsDirectory = $Matches[1] -eq 'd'
    }
  }

  if ($Line -match '^\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}[AP]M\s+(<DIR>|\d+)\s+(.+)$') {
    return [PSCustomObject]@{
      Name = $Matches[2]
      IsDirectory = $Matches[1] -eq '<DIR>'
    }
  }

  return $null
}

function Get-FtpItems {
  param(
    [string]$Server,
    [string]$Path,
    [System.Net.NetworkCredential]$Credential
  )

  $request = New-FtpRequest -Server $Server -Path $Path -Method ([System.Net.WebRequestMethods+Ftp]::ListDirectoryDetails) -Credential $Credential
  $raw = Read-FtpTextResponse -Request $request
  $items = @()

  foreach ($line in ($raw -split "`r?`n")) {
    $parsed = Parse-FtpListLine -Line $line.Trim()
    if ($null -eq $parsed) {
      continue
    }
    if ($parsed.Name -eq "." -or $parsed.Name -eq "..") {
      continue
    }
    $items += $parsed
  }

  return $items
}

function Ensure-FtpDirectory {
  param(
    [string]$Server,
    [string]$Path,
    [System.Net.NetworkCredential]$Credential
  )

  $segments = $Path.Trim('/').Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
  $current = ""

  foreach ($segment in $segments) {
    $current = "$current/$segment"
    $request = New-FtpRequest -Server $Server -Path $current -Method ([System.Net.WebRequestMethods+Ftp]::MakeDirectory) -Credential $Credential
    try {
      $response = $request.GetResponse()
      $response.Dispose()
    } catch {
      $message = $_.Exception.Message
      if ($message -notmatch '550|exists|exist') {
        throw
      }
    }
  }
}

function Remove-FtpTree {
  param(
    [string]$Server,
    [string]$Path,
    [System.Net.NetworkCredential]$Credential
  )

  $items = @()
  try {
    $items = Get-FtpItems -Server $Server -Path $Path -Credential $Credential
  } catch {
    return
  }

  foreach ($item in $items) {
    $childPath = "$($Path.TrimEnd('/'))/$($item.Name)"
    if ($item.IsDirectory) {
      Remove-FtpTree -Server $Server -Path $childPath -Credential $Credential
      $rmd = New-FtpRequest -Server $Server -Path $childPath -Method ([System.Net.WebRequestMethods+Ftp]::RemoveDirectory) -Credential $Credential
      try {
        $resp = $rmd.GetResponse()
        $resp.Dispose()
      } catch {
        $message = $_.Exception.Message
        if ($message -notmatch '550|No such') {
          throw
        }
      }
    } else {
      $del = New-FtpRequest -Server $Server -Path $childPath -Method ([System.Net.WebRequestMethods+Ftp]::DeleteFile) -Credential $Credential
      try {
        $resp = $del.GetResponse()
        $resp.Dispose()
      } catch {
        $message = $_.Exception.Message
        if ($message -notmatch '550|No such') {
          throw
        }
      }
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
    $auth = "$($Credential.UserName):$($Credential.Password)"

    $maxAttempts = 4
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
      & curl.exe --silent --show-error --fail --ftp-create-dirs -T $LocalFilePath $ftpUrl --user $auth
      if ($LASTEXITCODE -eq 0) {
        break
      }

      if ($attempt -eq $maxAttempts) {
        throw "curl exited with code $LASTEXITCODE"
      }

      Start-Sleep -Seconds ([Math]::Min(8, $attempt * 2))
    }
  } catch {
    throw "Upload failed for '$RemoteFilePath' from '$LocalFilePath'. $($_.Exception.Message)"
  }
}

function Resolve-FtpHost {
  param(
    [string[]]$Candidates,
    [System.Net.NetworkCredential]$Credential
  )

  $errors = @()

  foreach ($candidate in $Candidates) {
    if (-not $candidate) {
      continue
    }
    try {
      $req = New-FtpRequest -Server $candidate -Path "/" -Method ([System.Net.WebRequestMethods+Ftp]::ListDirectory) -Credential $Credential
      $resp = $req.GetResponse()
      $resp.Dispose()
      return $candidate
    } catch {
      $errors += "${candidate}: $($_.Exception.Message)"
      continue
    }
  }

  throw "Could not connect to FTP using provided hosts. Details: $($errors -join ' | ')"
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$credential = New-Object System.Net.NetworkCredential($Username, $Password)
$server = Resolve-FtpHost -Candidates @($FtpHost, $FallbackHost) -Credential $credential

Write-Host "Using FTP host: $server" -ForegroundColor Green

if (-not $SkipBuild) {
  Write-Host "`n==> Building static export" -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed"
  }
}

$outDir = Join-Path $projectRoot "out"
if (-not (Test-Path $outDir)) {
  throw "Static export folder not found at $outDir. Run npm run build first."
}

Ensure-FtpDirectory -Server $server -Path $RemotePath -Credential $credential

if (-not $SkipCleanup) {
  Write-Host "`n==> Removing previous remote data" -ForegroundColor Cyan
  Remove-FtpTree -Server $server -Path $RemotePath -Credential $credential
}

Write-Host "`n==> Uploading static files" -ForegroundColor Cyan
$files = Get-ChildItem -Path $outDir -Recurse -File

foreach ($file in $files) {
  $relative = $file.FullName.Substring($outDir.Length).TrimStart([char[]]@('\', '/'))
  $relative = $relative.Replace('\', '/')
  $remoteFile = "$($RemotePath.TrimEnd('/'))/$relative"
  $remoteDir = [System.IO.Path]::GetDirectoryName($remoteFile.Replace('/', '\'))
  if ($remoteDir) {
    Ensure-FtpDirectory -Server $server -Path ($remoteDir.Replace('\', '/')) -Credential $credential
  }
  Upload-FileToFtp -Server $server -RemoteFilePath $remoteFile -LocalFilePath $file.FullName -Credential $credential
}

Write-Host "`nFTP deploy completed successfully." -ForegroundColor Green
