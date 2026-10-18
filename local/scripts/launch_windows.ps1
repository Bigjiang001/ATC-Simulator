param(
    [switch]$BootstrapOnly,
    [switch]$ForceProjectPython,
    [switch]$NoBrowser,
    [switch]$FunctionsOnly
)
# Windows PowerShell 5.1 compatible. Keep ASCII, without a BOM.
# Invoked by the small CMD wrapper; all paths are resolved from this script.
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
    # Return the path as ASCII base64: PS 5.1/OEM decoding can corrupt non-ASCII paths.
    $probe = 'import sys,struct,platform,base64; assert sys.platform == ''win32''; assert platform.python_implementation() == ''CPython''; assert (3,10) <= sys.version_info[:2] < (3,14); assert struct.calcsize(''P'') == 8; print(base64.b64encode(sys.executable.encode(''utf-8'')).decode(''ascii''))'
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $result = @(& $Executable @Selector -I -c $probe 2>$null)
        if ($env:ATC_PYTHON_TRACE -eq '1') { Write-Host ('[TRACE] Probe ' + $Executable + ': exit=' + $LASTEXITCODE + ', lines=' + $result.Count) }
        if ($LASTEXITCODE -eq 0 -and $result.Count -gt 0) {
            $resolved = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(([string]$result[-1]).Trim()))
            if (Test-Path -LiteralPath $resolved -PathType Leaf) { return $resolved }
        }
    } catch {
        # A stale executable/registry entry is not a usable Python installation.
    } finally {
        $ErrorActionPreference = $savedPreference
    }
    return $null
}

function Get-ApplicationPaths {
    param([string]$Name)
    # Missing commands are expected during first installation, never fatal.
    try {
        @(Get-Command $Name -All -CommandType Application -ErrorAction Stop) | ForEach-Object { $_.Source }
    } catch { return }
}

function Find-Python {
    param([string]$RuntimeDir, [switch]$ProjectOnly)
    foreach ($relative in @('Python311\python.exe', 'managed-python\cpython-3.11-windows-x86_64-none\python.exe')) {
        $found = Test-Python (Join-Path $RuntimeDir $relative)
        if ($found) { return $found }
    }
    $managed = Join-Path $RuntimeDir 'managed-python'
    if (Test-Path -LiteralPath $managed -PathType Container) {
        foreach ($candidate in @(Get-ChildItem -LiteralPath $managed -Filter python.exe -Recurse -ErrorAction SilentlyContinue)) {
            $found = Test-Python $candidate.FullName
            if ($found) { return $found }
        }
    }
    if ($ProjectOnly) { return $null }
    foreach ($launcher in @(Get-ApplicationPaths 'py.exe')) {
        foreach ($version in @('-3.11', '-3.12', '-3.13', '-3.10')) {
            $found = Test-Python $launcher @($version)
            if ($found) { return $found }
        }
    }
    foreach ($name in @('python.exe', 'python3.exe')) {
        foreach ($command in @(Get-ApplicationPaths $name)) {
            $found = Test-Python $command
            if ($found) { return $found }
        }
    }
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

function Get-SetupFile {
    param([string]$Url, [string]$Destination)
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination -TimeoutSec 180
            if ((Get-Item -LiteralPath $Destination).Length -eq 0) { throw 'Empty download' }
            return
        } catch {
            if ($attempt -eq 3) { throw "Download failed: $Url : $($_.Exception.Message)" }
            Write-Host "[INFO] Download interrupted; retry $($attempt + 1)/3 ..."
        }
    }
}

function Install-PortablePython {
    param([string]$RuntimeDir)
    # Project-local managed Python; no PATH changes, registry installation or admin access.
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    $uvDir = Join-Path $RuntimeDir 'uv-0.13.1'
    $uv = Join-Path $uvDir 'uv.exe'
    if (-not (Test-Path -LiteralPath $uv -PathType Leaf)) {
        $archive = Join-Path $RuntimeDir 'uv-0.13.1-windows-x64.zip'
        Write-Host '[INFO] Downloading the project-local Python bootstrap tool ...'
        Get-SetupFile 'https://github.com/astral-sh/uv/releases/download/0.13.1/uv-x86_64-pc-windows-msvc.zip' $archive
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne '3B2661A463A5BAEA7F5076EA2B25AB71D77F36A6C0D809E5350651792F80A672') {
            Remove-Item -LiteralPath $archive -Force
            throw 'Bootstrap download checksum mismatch; retry the launcher.'
        }
        $extract = Join-Path $RuntimeDir 'uv-extracted'
        Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
        $exe = @(Get-ChildItem -LiteralPath $extract -Filter uv.exe -Recurse)[0]
        if (-not $exe) { throw 'Python bootstrap archive does not contain uv.exe' }
        New-Item -ItemType Directory -Path $uvDir -Force | Out-Null
        Copy-Item -LiteralPath $exe.FullName -Destination $uv -Force
    }
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $RuntimeDir 'managed-python'
    $env:UV_CACHE_DIR = Join-Path $RuntimeDir 'uv-cache'
    Write-Host '[INFO] Installing project-local Python 3.11 ...'
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $uv python install 3.11 | Out-Host
        $installCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($installCode -ne 0) { throw "Managed Python download failed (exit $installCode)" }
    $found = Find-Python $RuntimeDir -ProjectOnly
    if (-not $found) { throw 'Managed Python is incomplete; rerun the launcher.' }
    return $found
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
    Get-SetupFile 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe' $installer
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
        & $script:Python @Arguments 2>&1 | ForEach-Object { $_.ToString() } | Out-Host
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedPreference
    }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "Python command failed (exit $code): $($Arguments -join ' ')"
    }
    return $code
}

if ($FunctionsOnly) { return }
$stage = 'PRECHECK'
try {
    if (-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Version.Major -lt 10) {
        throw 'Windows 10 or Windows 11 (64-bit) is required by the speech dependencies.'
    }
    $projectDir = Split-Path $PSScriptRoot -Parent
    Set-Location -LiteralPath $projectDir
    $logDir = Join-Path $projectDir '.atc_windows_logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $logPath = Join-Path $logDir ('launcher-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID + '.log')
    Start-Transcript -Path $logPath | Out-Null
    $transcriptStarted = $true
    foreach ($required in @('requirements.txt', 'atc_ai_server.py', 'atc_command_simulator.html', 'scripts\setup_qwen.py', 'scripts\ensure_cuda.py', 'scripts\launch_atc.py')) {
        if (-not (Test-Path -LiteralPath (Join-Path $projectDir $required) -PathType Leaf)) {
            throw "Missing $required. Extract the whole project ZIP before double-clicking this launcher."
        }
    }
    Write-Host '===================================================================='
    Write-Host ' ATC2.0 - Windows 10/11 automatic setup and launcher'
    Write-Host ' SenseVoice Small + Qwen3-TTS-0.6B (9 voices, adjustable rate) / Kokoro English (local)'
    Write-Host '===================================================================='
    Write-Host "[INFO] Project: $projectDir"
    Write-Host "[INFO] Log: $logPath"

    $runtimeDir = Join-Path $projectDir '.atc_windows_runtime'
    $venvDir = Join-Path $projectDir '.venv_atc_ai_windows'
    $venvPython = Join-Path $venvDir 'Scripts\python.exe'
    $stage = 'PYTHON_SETUP'
    Write-Host '[1/4] Checking the Windows Python environment ...'
    $script:Python = Test-Python $venvPython
    if (-not $script:Python) {
        $script:Python = Find-Python $runtimeDir -ProjectOnly:$ForceProjectPython
        if (-not $script:Python) {
            try { $script:Python = Install-PortablePython $runtimeDir }
            catch {
                Write-Host ('[INFO] Portable setup failed: ' + $_.Exception.Message)
                Write-Host '[INFO] Trying the signed official Python installer ...'
                $script:Python = Install-Python $runtimeDir
            }
        }
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

    if ($BootstrapOnly) {
        Write-Host '[READY] Python setup passed. No speech dependencies or models were downloaded.'
        exit 0
    }
    $stage = 'DEPENDENCIES'
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
    Write-Host '[INFO] Checking NVIDIA GPU acceleration (ASR) ...'
    Invoke-Python -Arguments @('-u', (Join-Path $projectDir 'scripts\ensure_cuda.py')) | Out-Null
    Invoke-Python -Arguments @('-I', '-c', 'import fastapi, uvicorn, multipart, numpy, soundfile, onnxruntime, kokoro_onnx, torch, torchaudio, funasr, modelscope, huggingface_hub; print(''AI dependency imports OK'')') | Out-Null

    $stage = 'MODELS'
    Write-Host '[3/4] Checking/downloading SenseVoice Small and Kokoro models ...'
    Invoke-Python -Arguments @('-u', (Join-Path $projectDir 'atc_ai_server.py'), '--check-and-download-models') | Out-Null
    # The backend catches download errors, so also check that model files exist.
    Invoke-Python -Arguments @('-c', 'from atc_ai_server import engine, KOKORO_DIR; sv = engine._find_local_sensevoice_dir(); assert sv is not None and (sv / ''model.pt'').is_file(), ''SenseVoice model download incomplete; check network and retry''; assert all((KOKORO_DIR / n).is_file() and (KOKORO_DIR / n).stat().st_size > 0 for n in (''kokoro-v1.0.onnx'', ''voices-v1.0.bin'')), ''Kokoro model download incomplete; check network and retry''; print(''Local model files OK'')') | Out-Null

    Write-Host '[INFO] Checking Chinese TTS runtime and GPU acceleration ...'
    Invoke-Python -Arguments @('-u', (Join-Path $projectDir 'scripts\setup_qwen.py')) | Out-Null

    $stage = 'SERVER'
    Write-Host '[4/4] Loading models and starting http://127.0.0.1:18765/ ...'
    Write-Host '[INFO] The server opens your default browser after loading the models.'
    Write-Host '[INFO] Change the push-to-talk key in System Settings > Push-to-talk key.'
    Write-Host '[INFO] Keep this window open while playing. Press Ctrl+C to stop.'
    # Both platforms wait for the current page AND all local speech models.
    $launchArguments = @('-u', (Join-Path $projectDir 'scripts\launch_atc.py'))
    if ($NoBrowser) { $launchArguments += '--no-browser' }
    Invoke-Python -Arguments $launchArguments | Out-Null
} catch {
    Write-Host ''
    Write-Host ('[ERROR][' + $stage + '] ' + $_.Exception.Message) -ForegroundColor Red
    if ($_.InvocationInfo.PositionMessage) { Write-Host $_.InvocationInfo.PositionMessage }
    if ($stage -eq 'SERVER') {
        Write-Host '[HELP] See the specific server error above. Close any older ATC launcher window and retry.'
    } else {
        Write-Host '[HELP] Check the specific setup error above; run the launcher inside the complete local/ folder.'
    }
    if ($logPath) { Write-Host "[INFO] See the full launcher log: $logPath" }
    exit 1
} finally {
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
}
exit 0
