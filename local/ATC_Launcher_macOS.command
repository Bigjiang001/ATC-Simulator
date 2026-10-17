#!/bin/bash
# ==============================================================================
#  ATC2.0 — macOS 启动器 (Apple Silicon M1-M4 / Intel 通用)
# ==============================================================================

set -e
cd "$(dirname "$0")" || exit 1

ATC_VENV="$PWD/.venv_atc_ai"
ATC_PYTHON="$ATC_VENV/bin/python3"

echo "============================================================================"
echo "  ATC2.0 — macOS 自动环境检查、模型部署与常驻内存启动器"
echo "  [1] 中文模式：本地 Qwen3-TTS-0.6B (9 种音色 · 普通话 / 方言 · 可调语速)"
echo "  [2] 英文模式：Kokoro-82M 航空英语常驻模型 (am_adam / af_bella 等)"
echo "  [3] 语音识别：SenseVoice Small (16kHz 内存直解 + 自动音量放大 AGC)"
echo "============================================================================"
echo ""

# Fresh installations use a project-local Python, avoiding Xcode stubs and
# incompatible system interpreters on computers without developer tools.
if [ ! -x "$ATC_PYTHON" ]; then
    echo "[步骤 1/4] 自动安装项目专用 Python 3.12（首次需要联网）..."
    export UV_INSTALL_DIR="$PWD/.atc_macos_runtime/bin"
    export UV_PYTHON_INSTALL_DIR="$PWD/.atc_macos_runtime/python"
    export UV_NO_MODIFY_PATH=1
    if [ ! -x "$UV_INSTALL_DIR/uv" ]; then
        curl --proto '=https' --tlsv1.2 -fL --retry 3 https://astral.sh/uv/install.sh -o "$PWD/.atc_uv_install.sh"
        /bin/sh "$PWD/.atc_uv_install.sh"
        rm "$PWD/.atc_uv_install.sh"
    fi
    "$UV_INSTALL_DIR/uv" python install 3.12
    if [ -d "$ATC_VENV" ]; then
        mv "$ATC_VENV" "$ATC_VENV.backup-$(date +%Y%m%d-%H%M%S)-$$"
    fi
    "$UV_INSTALL_DIR/uv" venv --python 3.12 --seed "$ATC_VENV"
fi

# activate 和 pip 脚本含创建时的绝对路径；项目改名/移动后直接调用环境解释器。
if [ ! -x "$ATC_PYTHON" ]; then
    echo "[错误] 虚拟环境解释器不可用：$ATC_PYTHON"
    echo "请确认创建此环境的 Python 仍已安装。"
    exit 1
fi
export VIRTUAL_ENV="$ATC_VENV"
export PATH="$ATC_VENV/bin:$PATH"
unset PYTHONHOME
"$ATC_PYTHON" -c 'import pathlib, sys; expected = pathlib.Path(sys.argv[1]).resolve(); actual = pathlib.Path(sys.prefix).resolve(); sys.exit(0 if actual == expected and sys.prefix != sys.base_prefix else "[错误] Python 未使用当前项目的独立虚拟环境。")' "$ATC_VENV"

echo "[步骤 2/4] 正在检查并补全 AI 语音引擎依赖 (SenseVoice / Kokoro；中文 Qwen 使用另一个独立环境)..."
# Use the environment's CA bundle if python.org Python has no system certificates.
ATC_CERT=$("$ATC_PYTHON" -c 'import pip._vendor.certifi as certifi; print(certifi.where())' 2>/dev/null || true)
if [ -n "$ATC_CERT" ]; then
    export SSL_CERT_FILE="$ATC_CERT"
    export PIP_CERT="$ATC_CERT"
fi
"$ATC_PYTHON" -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple || \
    "$ATC_PYTHON" -m pip install -r requirements.txt -i https://pypi.org/simple

echo ""
echo "[步骤 3/4] 正在检查本地 SenseVoice Small、Kokoro-82M 和 Qwen3-TTS-0.6B 模型文件..."
"$ATC_PYTHON" atc_ai_server.py --check-and-download-models
"$ATC_PYTHON" -u scripts/setup_qwen.py

echo ""
echo "[步骤 4/4] 正在加载模型，服务就绪后将打开当前目录的 ATC2.0 页面..."
"$ATC_PYTHON" -u scripts/launch_atc.py
