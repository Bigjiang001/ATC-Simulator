$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$scriptPath = Join-Path $PSScriptRoot 'launch_windows.ps1'
$tokens = $null; $parseErrors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$bytes = [IO.File]::ReadAllBytes((Join-Path $root 'ATC_Launcher_Windows11.bat'))
if (@($bytes | Where-Object { $_ -gt 127 }).Count) { throw 'CMD wrapper must be ASCII' }
$text = [Text.Encoding]::ASCII.GetString($bytes)
if ($text.Replace("`r`n", '').Contains("`n")) { throw 'CMD wrapper must use CRLF' }
. $scriptPath -FunctionsOnly
if (@(Get-ApplicationPaths 'atc_python_that_does_not_exist.exe').Count) { throw 'Missing application should be empty' }
if (Test-Python 'C:\atc_python_that_does_not_exist.exe') { throw 'Missing Python accepted' }
$found = Find-Python (Join-Path $env:RUNNER_TEMP 'ATC missing runtime')
if (-not $found) { throw 'Runner Python not discovered' }
Write-Host ('PASS: existing Python discovery: ' + $found)
& {
    function Test-Python { return $null }
    if (Find-Python (Join-Path $env:RUNNER_TEMP 'ATC no Python')) { throw 'Invalid Python accepted' }
}
Write-Host 'PASS: empty and broken Python discovery does not terminate setup'

function Run-Launcher {
    param([string]$Directory, [string]$Arguments)
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $env:ComSpec
    $info.Arguments = '/d /s /c ""' + (Join-Path $Directory 'ATC_Launcher_Windows11.bat') + '" ' + $Arguments + '"'
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    $info.WorkingDirectory = $env:RUNNER_TEMP
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    [void]$process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $output = $stdoutTask.Result + $stderrTask.Result
    Write-Host $output
    return @{ Code = $process.ExitCode; Output = $output }
}

$unicode = ([string][char]0x4e2d) + ([char]0x6587)
$fixture = Join-Path $env:RUNNER_TEMP ('ATC bootstrap & test (' + $unicode + ')')
New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts') -Force | Out-Null
foreach ($name in @('ATC_Launcher_Windows11.bat', 'requirements.txt', 'atc_ai_server.py', 'atc_command_simulator.html')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $fixture $name) -Force
}
foreach ($name in @('launch_windows.ps1', 'setup_qwen.py', 'launch_atc.py')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $fixture 'scripts') -Force
}
$env:ATC_NO_PAUSE = '1'
$env:ATC_PYTHON_TRACE = '1'
$savedPath = $env:PATH
try {
    $env:PATH = $env:SystemRoot + '\System32'
    $result = Run-Launcher $fixture '-BootstrapOnly -ForceProjectPython'
    if ($result.Code -ne 0 -or $result.Output -notmatch '\[READY\] Python setup passed') { throw 'Fresh project bootstrap failed' }
    $python = Join-Path $fixture '.venv_atc_ai_windows\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python)) { throw 'Virtual environment was not created' }
    & $python -I -c 'import sys; assert sys.prefix != sys.base_prefix; print(sys.version)'
    if ($LASTEXITCODE -ne 0) { throw 'Virtual environment is invalid' }
    if (Test-Path -LiteralPath (Join-Path $fixture 'models')) { throw 'Bootstrap-only mode downloaded models' }
    Write-Host 'PASS: fresh Python download and venv creation with no Python on PATH, Chinese/space/ampersand path'
    $result = Run-Launcher $fixture '-BootstrapOnly -ForceProjectPython'
    if ($result.Code -ne 0 -or $result.Output -match 'Installing project-local Python') { throw 'Existing venv not reused' }
    Write-Host 'PASS: second launch reuses existing environment'
} finally { $env:PATH = $savedPath }

$missing = Join-Path $env:RUNNER_TEMP 'ATC incomplete extraction'
New-Item -ItemType Directory -Path $missing -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'ATC_Launcher_Windows11.bat') -Destination $missing -Force
$result = Run-Launcher $missing ''
if ($result.Code -eq 0 -or $result.Output -notmatch 'Extract the WHOLE') { throw 'Incomplete ZIP extraction was not explained' }
Write-Host 'PASS: missing helper reports full-extraction instruction'

$failure = Join-Path $env:RUNNER_TEMP 'ATC simulated network error'
Copy-Item -LiteralPath $missing -Destination $failure -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $failure 'scripts') -Force | Out-Null
foreach ($name in @('requirements.txt', 'atc_ai_server.py', 'atc_command_simulator.html')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination $failure -Force
}
foreach ($name in @('setup_qwen.py', 'launch_atc.py')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $failure 'scripts') -Force
}
$payload = [IO.File]::ReadAllText($scriptPath).Replace('if ($FunctionsOnly) { return }', "function Get-SetupFile { throw 'TEST simulated network unavailable' }`r`nif (`$FunctionsOnly) { return }")
[IO.File]::WriteAllText((Join-Path $failure 'scripts\launch_windows.ps1'), $payload, (New-Object Text.UTF8Encoding($false)))
$result = Run-Launcher $failure '-BootstrapOnly -ForceProjectPython'
if ($result.Code -eq 0 -or $result.Output -notmatch '\[ERROR\]\[PYTHON_SETUP\]') { throw 'Network failure lacks a named setup stage' }
if (@(Get-ChildItem -LiteralPath (Join-Path $failure '.atc_windows_logs') -Filter '*.log').Count -eq 0) { throw 'Error log missing' }
Write-Host 'PASS: download failure reports Python setup stage and retains transcript'
Write-Host 'ALL WINDOWS LAUNCHER TESTS PASSED'
