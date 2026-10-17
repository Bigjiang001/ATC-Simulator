@echo off
setlocal DisableDelayedExpansion
title ATC2.0 - Windows 11 Launcher
set "ATC_LAUNCHER_FILE=%~f0"
set "ATC_PROJECT_DIR=%~dp0"
set "ATC_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%ATC_POWERSHELL%" goto :no_powershell
"%ATC_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "try { $s = [IO.File]::ReadAllText($env:ATC_LAUNCHER_FILE); $m = '# ATC_POWERSHELL_BEGIN'; & ([scriptblock]::Create($s.Substring($s.LastIndexOf($m) + $m.Length))) } catch { Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
set "ATC_EXIT_CODE=%errorlevel%"
if not "%ATC_EXIT_CODE%"=="0" pause
exit /b %ATC_EXIT_CODE%
:no_powershell
echo [ERROR] Windows PowerShell was not found. Repair Windows PowerShell and retry.
pause
exit /b 1

# ATC_POWERSHELL_BEGIN
# Single-file CMD/PowerShell launcher. Keep this file ASCII without a BOM and
# with CRLF line endings. No venv activation or PATH edits are needed.
# Uses the same requirements, model-check command and server as the macOS launcher.
# Windows dependencies go into .venv_atc_ai_windows; .venv_atc_ai is untouched.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
# Ignore inherited Python settings that could redirect this project's interpreter.
Remove-Item Env:PYTHONHOME, Env:PYTHONPATH, Env:PYLAUNCHER_ALLOW_INSTALL -ErrorAction SilentlyContinue
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$script:Python = $null
$transcriptStarted = $false
$logPath = $null

function Test-Python {
    param([string]$Executable, [string[]]$Selector = @())
    if (-not $Executable -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
        return $null
    }
    # WindowsApps python.exe may open the Microsoft Store instead of running Python.
    if ($Executable -match '\\WindowsApps\\') { return $null }
    # Single quotes inside Python code survive Windows PowerShell 5.1 native quoting.
    $probe = 'import sys,struct,platform; assert sys.platform == ''win32''; assert platform.python_implementation() == ''CPython''; assert (3,10) <= sys.version_info[:2] < (3,14); assert struct.calcsize(''P'') == 8; print(sys.executable)'
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = @(& $Executable @Selector -I -c $probe 2>$null)
        if ($LASTEXITCODE -eq 0 -and $result.Count -gt 0) {
            $resolved = ([string]$result[-1]).Trim()
            if (Test-Path -LiteralPath $resolved -PathType Leaf) { return $resolved }
        }
    } catch {
        # A stale executable/registry entry is not a usable Python installation.
    } finally {
        $ErrorActionPreference = $savedPreference
    }
    return $null
}

function Find-Python {
    param([string]$RuntimeDir)
    $found = Test-Python (Join-Path $RuntimeDir 'Python311\python.exe')
    if ($found) { return $found }

    $launcher = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($launcher) {
        foreach ($version in @('-3.11', '-3.12', '-3.13', '-3.10')) {
            $found = Test-Python $launcher.Source @($version)
            if ($found) { return $found }
        }
    }
    foreach ($name in @('python.exe', 'python3.exe')) {
        foreach ($command in @(Get-Command $name -All -CommandType Application -ErrorAction SilentlyContinue)) {
            $found = Test-Python $command.Source
            if ($found) { return $found }
        }
    }
    # Python installed moments ago may not be on this process's inherited PATH.
    foreach ($version in @('3.11', '3.12', '3.13', '3.10')) {
        foreach ($hive in @('HKCU:', 'HKLM:')) {
            $key = "$hive\Software\Python\PythonCore\$version\InstallPath"
            if (Test-Path -LiteralPath $key) {
                $installPath = (Get-Item -LiteralPath $key).GetValue('')
                if ($installPath) {
                    $found = Test-Python (Join-Path $installPath 'python.exe')
                    if ($found) { return $found }
                }
            }
        }
        foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles)) {
            if (-not $base) { continue }
            $folder = 'Python' + $version.Replace('.', '')
            foreach ($relative in @("Programs\Python\$folder\python.exe", "$folder\python.exe")) {
                $found = Test-Python (Join-Path $base $relative)
                if ($found) { return $found }
            }
        }
    }
    return $null
}

function Install-Python {
    param([string]$RuntimeDir)
    # Official per-user installer; no winget, administrator account or PATH refresh needed.
    # 3.11.9 is the final Python 3.11 release with a traditional Windows installer.
    $installer = Join-Path $RuntimeDir 'python-3.11.9-amd64.exe'
    $target = Join-Path $RuntimeDir 'Python311'
    $setupLog = Join-Path $RuntimeDir 'python-install.log'
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    Write-Host '[INFO] Downloading Python 3.11 (64-bit) from python.org ...'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe' -OutFile $installer
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
        throw 'Python installer signature verification failed. Retry the download or install Python from python.org.'
    }
    Write-Host '[INFO] Installing Python for this user. Please wait ...'
    $setupArgs = @('/quiet', 'InstallAllUsers=0', 'PrependPath=0', 'Include_launcher=0',
        'AssociateFiles=0', 'Shortcuts=0', 'Include_test=0', 'Include_doc=0', 'Include_pip=1',
        ('TargetDir="' + $target + '"'), '/log', ('"' + $setupLog + '"'))
    $setup = Start-Process -FilePath $installer -ArgumentList $setupArgs -Wait -PassThru
    if ($setup.ExitCode -notin @(0, 3010)) {
        throw "Python installation failed (exit $($setup.ExitCode)). Installer log: $setupLog"
    }
    $found = Find-Python $RuntimeDir
    if (-not $found) {
        throw "Python could not be started after installation. See $setupLog; restart Windows if requested by setup."
    }
    return $found
}

function Invoke-Python {
    param([string[]]$Arguments, [switch]$AllowFailure)
    # PS 5.1 can treat native stderr (including pip progress) as PowerShell errors.
    # Native success/failure must be determined from the process exit code.
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $script:Python @Arguments | Out-Host
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedPreference
    }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "Python command failed (exit $code): $($Arguments -join ' ')"
    }
    return $code
}

try {
    $projectDir = $env:ATC_PROJECT_DIR
    Set-Location -LiteralPath $projectDir
    foreach ($required in @('requirements.txt', 'atc_ai_server.py', 'atc_command_simulator.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $projectDir $required) -PathType Leaf)) {
            throw "Missing $required. Extract the whole project ZIP before double-clicking this launcher."
        }
    }
    $logDir = Join-Path $projectDir '.atc_windows_logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $logPath = Join-Path $logDir ('launcher-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID + '.log')
    Start-Transcript -Path $logPath | Out-Null
    $transcriptStarted = $true
    Write-Host '===================================================================='
    Write-Host ' ATC2.0 - Windows 11 automatic setup and launcher'
    Write-Host ' SenseVoice Small + Qwen3-TTS-0.6B (9 voices, adjustable rate) / Kokoro English (local)'
    Write-Host '===================================================================='
    Write-Host "[INFO] Project: $projectDir"
    Write-Host "[INFO] Log: $logPath"

    $runtimeDir = Join-Path $projectDir '.atc_windows_runtime'
    $venvDir = Join-Path $projectDir '.venv_atc_ai_windows'
    $venvPython = Join-Path $venvDir 'Scripts\python.exe'
    Write-Host '[1/4] Checking the Windows Python environment ...'
    $script:Python = Test-Python $venvPython
    if (-not $script:Python) {
        $script:Python = Find-Python $runtimeDir
        if (-not $script:Python) { $script:Python = Install-Python $runtimeDir }
        if (Test-Path -LiteralPath $venvDir) {
            # Preserve a broken/copied Windows venv instead of overwriting its contents.
            $backup = $venvDir + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID
            Move-Item -LiteralPath $venvDir -Destination $backup
            Write-Host "[INFO] Previous Windows environment preserved at: $backup"
        }
        Invoke-Python -Arguments @('-I', '-m', 'venv', $venvDir) | Out-Null
        $script:Python = Test-Python $venvPython
        if (-not $script:Python) { throw 'Failed to create a working Windows virtual environment.' }
    }
    Write-Host "[INFO] Python: $script:Python"
    # Refuse to install packages globally if a copied executable is not actually a venv.
    Invoke-Python -Arguments @('-I', '-c', 'import sys; assert sys.prefix != sys.base_prefix, ''Not a virtual environment''; print(sys.version)') | Out-Null

    Write-Host '[2/4] Checking and installing AI dependencies ...'
    # Ignore user/global pip configuration so installs stay inside this Windows venv.
    $env:PIP_CONFIG_FILE = 'NUL'
    foreach ($setting in @('PIP_TARGET', 'PIP_PREFIX', 'PIP_USER', 'PIP_REQUIRE_VIRTUALENV')) {
        Remove-Item "Env:$setting" -ErrorAction SilentlyContinue
    }
    Invoke-Python -Arguments @('-I', '-m', 'ensurepip', '--upgrade') | Out-Null
    foreach ($packages in @(@('--upgrade', 'pip'), @('-r', (Join-Path $projectDir 'requirements.txt')))) {
        $arguments = @('-I', '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check',
            '--retries', '2', '--timeout', '30') + $packages
        $code = Invoke-Python -Arguments ($arguments + @('--index-url', 'https://pypi.tuna.tsinghua.edu.cn/simple')) -AllowFailure
        if ($code -ne 0) {
            Write-Host '[INFO] Mirror install failed; retrying with pypi.org ...'
            Invoke-Python -Arguments ($arguments + @('--index-url', 'https://pypi.org/simple')) | Out-Null
        }
    }
    Invoke-Python -Arguments @('-I', '-m', 'pip', '--isolated', 'check') | Out-Null
    Invoke-Python -Arguments @('-I', '-c', 'import fastapi, uvicorn, multipart, numpy, soundfile, onnxruntime, kokoro_onnx, torch, torchaudio, funasr, modelscope, huggingface_hub; print(''AI dependency imports OK'')') | Out-Null

    Write-Host '[3/4] Checking/downloading SenseVoice Small and Kokoro models ...'
    Invoke-Python -Arguments @('-u', (Join-Path $projectDir 'atc_ai_server.py'), '--check-and-download-models') | Out-Null
    # The backend catches download errors, so also check that model files exist.
    Invoke-Python -Arguments @('-c', 'from atc_ai_server import engine, KOKORO_DIR; sv = engine._find_local_sensevoice_dir(); assert sv is not None and (sv / ''model.pt'').is_file(), ''SenseVoice model download incomplete; check network and retry''; assert all((KOKORO_DIR / n).is_file() and (KOKORO_DIR / n).stat().st_size > 0 for n in (''kokoro-v1.0.onnx'', ''voices-v1.0.bin'')), ''Kokoro model download incomplete; check network and retry''; print(''Local model files OK'')') | Out-Null

    Invoke-Python -Arguments @('-u', (Join-Path $projectDir 'scripts\setup_qwen.py')) | Out-Null

    Write-Host '[4/4] Loading models and starting http://127.0.0.1:18765/ ...'
    Write-Host '[INFO] The server opens your default browser after loading the models.'
    Write-Host '[INFO] Keep this window open while playing. Press Ctrl+C to stop.'
    # Both platforms wait for the current page AND all local speech models.
    Invoke-Python -Arguments @('-u', (Join-Path $projectDir 'scripts\launch_atc.py')) | Out-Null
} catch {
    Write-Host ''
    Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
    if ($logPath) { Write-Host "[INFO] See the full launcher log: $logPath" }
    exit 1
} finally {
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
}
exit 0
