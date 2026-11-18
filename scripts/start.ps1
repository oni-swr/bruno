$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!(Test-Path .env)) { throw 'Copy .env.example to .env and configure your bot token first.' }
foreach ($line in Get-Content .env) {
    if ($line -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
$speechProcess = $null
$ready = $false
try {
    $health = Invoke-RestMethod http://127.0.0.1:8765/health -TimeoutSec 2
    if ($health.service -ne 'local-discord-mate-speech') { throw 'Port 8765 is occupied by another or older service. Stop that service first.' }
    $ready = $health.ready -eq $true
} catch {
    if ($_.Exception.Message -like 'Port 8765*') { throw }
}
if (!$ready) {
    $speechProcess = Start-Process -FilePath "$PWD\.venv\Scripts\python.exe" -ArgumentList 'speech/server.py' -WorkingDirectory $PWD -WindowStyle Hidden -PassThru
}
try {
    for ($attempt = 0; !$ready -and $attempt -lt 120; $attempt++) {
        if ($speechProcess.HasExited) { throw 'Speech worker exited. Run .venv\Scripts\python speech/server.py to diagnose.' }
        try {
            $health = Invoke-RestMethod http://127.0.0.1:8765/health -TimeoutSec 2
            $ready = $health.ready -eq $true -and $health.service -eq 'local-discord-mate-speech'
        } catch { }
        if (!$ready) { Start-Sleep -Seconds 1 }
    }
    if (!$ready) { throw 'Speech worker did not become ready.' }
    node --env-file=.env src/bot.js
    $botExitCode = $LASTEXITCODE
} finally { if ($speechProcess -and !$speechProcess.HasExited) { Stop-Process -Id $speechProcess.Id } }
exit $botExitCode
