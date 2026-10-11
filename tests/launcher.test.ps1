$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$global:LaunchRescueLauncherFixture = @{ scenario = ''; server = $null; browserStarts = 0 }

function Start-Process {
    param($FilePath, $ArgumentList, $WorkingDirectory, [switch]$NoNewWindow, [switch]$PassThru)
    if ($FilePath -like 'http*') { $global:LaunchRescueLauncherFixture.browserStarts++; return }
    if ($global:LaunchRescueLauncherFixture.scenario -eq 'startup-failure') { throw 'Fixture startup failure' }
    $global:LaunchRescueLauncherFixture.server = [pscustomobject]@{ Id = 242424; HasExited = $false; ExitCode = 0 }
    $global:LaunchRescueLauncherFixture.server | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { $this.HasExited = $true }
    return $global:LaunchRescueLauncherFixture.server
}

function Invoke-RestMethod {
    param($Uri, $TimeoutSec)
    return @{ ready = $true; version = '1.0.0'; pid = $(if ($global:LaunchRescueLauncherFixture.scenario -eq 'foreign-server') { 121212 } else { 242424 }) }
}

function Stop-Process {
    param($Id)
    if ($Id -ne 242424) { throw 'The test must never stop a real process.' }
    $global:LaunchRescueLauncherFixture.server.HasExited = $true
}

Push-Location $PSScriptRoot
$oldPort = $env:DEMO_PORT
try {
    foreach ($case in @('normal', 'startup-failure', 'foreign-server')) {
        $global:LaunchRescueLauncherFixture.scenario = $case
        $global:LaunchRescueLauncherFixture.browserStarts = 0
        $env:DEMO_PORT = '5151'
        $before = (Get-Location).Path
        $failed = $false
        try { & (Join-Path $root 'Launch-Demo.ps1') -Port 4180 }
        catch {
            $failed = $true
            if ($case -eq 'normal') { throw }
            if ($case -eq 'foreign-server' -and $_.Exception.Message -notmatch 'another server') { throw }
        }
        if ($failed -ne ($case -ne 'normal')) { throw "Unexpected launcher result for $case." }
        if ($env:DEMO_PORT -ne '5151') { throw "DEMO_PORT leaked during $case." }
        if ((Get-Location).Path -ne $before) { throw "Working directory leaked during $case." }
        if ($case -eq 'foreign-server' -and $global:LaunchRescueLauncherFixture.browserStarts -ne 0) { throw 'A browser opened on the foreign server.' }
    }
    Write-Output 'Launcher normal, startup-failure, and foreign-server regressions passed.'
} finally {
    if ($null -eq $oldPort) { Remove-Item Env:\DEMO_PORT -ErrorAction SilentlyContinue }
    else { $env:DEMO_PORT = $oldPort }
    Pop-Location
    Remove-Variable LaunchRescueLauncherFixture -Scope Global
}
