$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$launcher = Join-Path $root 'ATC_Launcher_Windows11.bat'
$text = [IO.File]::ReadAllText($launcher)
$marker = '# ATC_POWERSHELL_BEGIN'
$payload = $text.Substring($text.LastIndexOf($marker) + $marker.Length)
$tokens = $null; $errors = $null
$null = [Management.Automation.Language.Parser]::ParseInput($payload, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$bodyStart = $payload.IndexOf("try {`r`n    `$projectDir")
if ($bodyStart -lt 0) { throw 'Main entry point not found' }
. ([scriptblock]::Create($payload.Substring(0, $bodyStart)))
$found = Find-Python (Join-Path $env:RUNNER_TEMP 'ATC empty runtime')
if (-not $found) { throw 'Runner Python not discovered' }
Write-Host ('PASS: existing Python discovery: ' + $found)
function Test-Python { return $null }
$missing = Find-Python (Join-Path $env:RUNNER_TEMP 'ATC no Python')
if ($missing) { throw 'Missing Python should return null' }
Write-Host 'PASS: no Python discovery does not terminate setup'
