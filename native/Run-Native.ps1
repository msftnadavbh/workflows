param(
    [ValidateSet('Live', 'Rehearsal', 'Checkpoint')]
    [string]$Mode = 'Rehearsal',
    [ValidateSet('retries', 'capacity', 'parallel', 'mixed')]
    [string]$Scenario = 'mixed',
    [switch]$Walkthrough
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not (Get-Command copilot -ErrorAction SilentlyContinue)) {
    throw 'GitHub Copilot CLI is not installed. Use Launch-Rescue-Demo.html for the clearly labeled offline rehearsal.'
}
if (-not (Test-Path (Join-Path $root '.github\extensions\launch-rescue\extension.mjs'))) {
    throw 'The compiled extension is missing. Run npm ci and npm run build.'
}
$outputFolder = Join-Path $root 'runs'
New-Item -ItemType Directory -Path $outputFolder -Force | Out-Null
$invocation = [guid]::NewGuid().ToString()
$inputFile = Join-Path $outputFolder ('input-' + $invocation + '.json')
$outputFile = Join-Path $outputFolder ('result-' + $invocation + '.json')
$arguments = @{
    scenario = $Scenario
    mode = $(if ($Mode -eq 'Live') { 'live' } else { 'rehearsal' })
    seed = 42
    pauseForApproval = ($Mode -ne 'Rehearsal')
    walkthrough = $Walkthrough.IsPresent
} | ConvertTo-Json
[System.IO.File]::WriteAllText($inputFile, $arguments, [System.Text.UTF8Encoding]::new($false))
Write-Host ('Starting native Copilot dynamic workflow: ' + $Mode)
if ($Mode -eq 'Live') {
    Write-Host 'Actual model calls consume AI credits. Required: eligible authentication, Sol 6.1 max, Sonnet 5.5 high.'
}
Write-Host 'Reviewed project code will load for this invocation only. No all-tools or all-paths grants are used.'
$previous = $env:GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS
try {
    $env:GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS = 'true'
    $output = @(& copilot -C $root --experimental --model gpt-6.1-sol --reasoning-effort max `
        --no-remote-export --disable-builtin-mcps `
        workflow run launch-rescue --args ('@' + $inputFile) --result-file $outputFile --silent --output-format json)
    $code = $LASTEXITCODE
} finally {
    if ($null -eq $previous) {
        Remove-Item Env:\GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS -ErrorAction SilentlyContinue
    } else {
        $env:GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS = $previous
    }
}
$runRecord = $null
foreach ($line in $output) {
    if ($line.StartsWith('{')) {
        $record = $line | ConvertFrom-Json -ErrorAction Stop
        if ($record.type -eq 'workflow.result') {
            $runRecord = $record.data.run
            $envelopeFile = Join-Path $outputFolder ('envelope-' + $invocation + '.json')
            [System.IO.File]::WriteAllText(
                $envelopeFile,
                ($record | ConvertTo-Json -Depth 100),
                [System.Text.UTF8Encoding]::new($false)
            )
            & node (Join-Path $root 'native\Reconcile-Run.mjs') $envelopeFile
            if ($LASTEXITCODE -ne 0) { throw 'The native lifecycle could not be reconciled with its observer.' }
            Write-Host ('Native status: ' + $runRecord.status + '; run ' + $runRecord.runId)
        }
    } else {
        Write-Host $line
    }
}
if ($code -eq 0 -and (Test-Path $outputFile)) {
    Write-Host ('Completed. Fresh result: ' + $outputFile)
} elseif ($code -eq 1 -and $null -ne $runRecord -and $runRecord.status -eq 'paused') {
    if ($runRecord.runId -notmatch '^[a-zA-Z0-9_-]{1,100}$') { throw 'Invalid run ID in native output.' }
    $stateFile = Join-Path (Join-Path $outputFolder $runRecord.runId) 'state.json'
    $snapshot = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($snapshot.sessionId -notmatch '^[a-zA-Z0-9_-]{1,100}$') { throw 'The native snapshot has no valid session ID for resume.' }
    Write-Host ('Paused native run: ' + $runRecord.runId)
    Write-Host 'A pause is not an approval. Reopen this exact session:'
    Write-Host ('copilot --experimental --model gpt-6.1-sol --reasoning-effort max --resume ' + $snapshot.sessionId)
    Write-Host 'Then enter /workflows, select this run, and resume after inspecting the evidence.'
    Write-Host 'The current app session does not own a run started in this separate CLI session.'
} else {
    throw ('Native workflow did not complete (exit ' + $code + '). See diagnostics above; no offline fallback was silently substituted.')
}
exit $code
