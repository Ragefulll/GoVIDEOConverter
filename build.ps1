$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$versionFile = Join-Path $root 'version.txt'

$version = '1.0.0'
if (Test-Path $versionFile) {
    $v = (Get-Content $versionFile -Raw).Trim()
    if ($v -match '^\d+\.\d+\.\d+$') { $version = $v }
}

$parts = $version -split '\.'
$newVersion = "$($parts[0]).$($parts[1]).$([int]$parts[2] + 1)"

Set-Content -Path $versionFile -Value $newVersion -Encoding ASCII -NoNewline

Write-Host "=== Building GoVIDEOConverter v$newVersion ==="

Push-Location $root
try {
    & wails build -ldflags "-X main.appVersion=$newVersion"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

$exe = Join-Path $root 'build\bin\GoVIDEOConverter.exe'
if (-not (Test-Path $exe)) {
    Write-Host "ERROR: not found: $exe"
    exit 1
}

$exeDir = Split-Path $exe
Set-Content -Path (Join-Path $exeDir 'version.txt') -Value $newVersion -Encoding ASCII -NoNewline

Write-Host "=== Done: $exe (v$newVersion) ==="
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $exe
$psi.Arguments = '--version'
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$p = [System.Diagnostics.Process]::Start($psi)
$embedded = $p.StandardOutput.ReadToEnd().Trim()
$p.WaitForExit()
Write-Host "=== Embedded version in exe: $embedded ==="
if ($embedded -ne $newVersion) {
    Write-Host "WARNING: embedded version ($embedded) does not match version.txt ($newVersion)!"
    exit 1
}
Write-Host "=== version.txt written next to exe ==="
Write-Host "=== Upload to server: $exe and $exeDir\version.txt ==="
