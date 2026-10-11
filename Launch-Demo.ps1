param([int]$Port = 4173, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22+ is required for native monitoring. You can open Launch-Rescue-Demo.html directly for offline rehearsal.'
}
if (-not (Test-Path (Join-Path $PSScriptRoot 'Launch-Rescue-Demo.html'))) {
    throw 'The standalone demo is missing. Run npm ci and npm run build.'
}
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port must be between 1024 and 65535.' }
$previousPort = $env:DEMO_PORT
$url = 'http://127.0.0.1:' + $Port + '/?scoutTheme=dark'
Write-Host ('Launch Rescue: ' + $url)
Write-Host 'Local-only server. No model calls happen when the page opens.'
Write-Host 'Press Ctrl+C in this terminal to stop the server.'
$node = (Get-Command node).Source
$serverPath = Join-Path $PSScriptRoot 'demo\server.mjs'
$server = $null
try {
    $env:DEMO_PORT = [string]$Port
    $server = Start-Process -FilePath $node -ArgumentList ('"' + $serverPath + '"') `
        -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($server.HasExited) { throw 'The demo server exited before becoming ready. Select another port if this one is occupied.' }
        try {
            $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $Port + '/health') -TimeoutSec 1
            if ($health.ready -eq $true -and $health.version -eq '1.0.0') {
                if ($health.pid -ne $server.Id) { throw 'The selected port belongs to another server. Choose another port; no browser was opened.' }
                if ($server.HasExited) { throw 'The demo server exited during its readiness check.' }
                $ready = $true
                break
            }
            throw 'The selected port did not return the Launch Rescue health response.'
        } catch {
            $exception = $_.Exception
            if ($exception -isnot [System.Net.WebException] -and $exception -isnot [System.Net.Http.HttpRequestException]) { throw }
        }
        Start-Sleep -Milliseconds 100
    }
    if (-not $ready) { throw 'The demo server did not become responsive within 10 seconds. Check the terminal output.' }
    if (-not $NoBrowser) { Start-Process $url }
    $server.WaitForExit()
    $code = $server.ExitCode
} finally {
    if ($null -ne $server -and -not $server.HasExited) { Stop-Process -Id $server.Id }
    if ($null -eq $previousPort) {
        Remove-Item Env:\DEMO_PORT -ErrorAction SilentlyContinue
    } else {
        $env:DEMO_PORT = $previousPort
    }
}
exit $code
