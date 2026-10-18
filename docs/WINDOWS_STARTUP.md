# Windows 启动器更新（2026-10-18）

这次只调整 Windows 启动和环境准备，不修改游戏、语音模型与 Mac 启动器。

## 如何运行

完整下载并解压仓库，进入 `local/`，双击 `ATC_Launcher_Windows.bat`。不要在压缩包里直接运行，也不要只复制这一个 BAT 文件；它需要同目录的游戏文件和 `scripts/`。

新版入口由一个小型 CMD 文件调用 `scripts/launch_windows.ps1`，避免在 BAT 中混合解析大量 PowerShell 代码。

第一步会复用可用的项目环境或已安装 Python；找不到可用解释器时，自动下载带校验的引导工具，在项目目录安装独立 Python，不要求先手工安装编程环境，也不依赖刷新 PATH。便携安装失败时会尝试带签名验证的官方 Python 安装器。下载会重试，项目环境的旧内容不会直接覆盖。

安装完成后，后续依赖安装、三个本地模型准备、服务就绪后自动打开游戏的流程保持一致。

## 如果再次失败

新版错误会注明发生阶段：

- `PRECHECK`：文件未完整解压、目录不可写或日志无法创建。
- `PYTHON_SETUP`：Python 下载、安装或虚拟环境创建失败。
- `DEPENDENCIES`：依赖安装失败。
- `MODELS`：模型准备失败。
- `SERVER`：服务启动失败。

窗口会保留错误，日志位于 `local/.atc_windows_logs/`。反馈时请贴出第一条 `[ERROR][阶段]` 与日志末尾内容，不必先删除模型或重新安装整个游戏。

## 单独验证第一步

在 `local/` 中打开终端执行：

```bat
ATC_Launcher_Windows.bat -BootstrapOnly
```

它只准备并检查 Python 虚拟环境，不下载语音模型。正常游玩仍直接双击，不需要参数。

自动回归脚本位于 `local/scripts/test-windows-launcher.ps1`，通过 Windows 原生 CMD 和 PowerShell 5.1 检查启动、路径、首次安装、复用以及错误日志。自动测试的覆盖范围会随每次 CI 运行结果更新，不等同于所有电脑、网络和完整模型推理均已验证。


通用 Windows 入口支持 Windows 10/11 64 位，旧 Windows11 文件名仍可使用。复制到其他电脑时请携带完整 local 文件夹；models 中的模型可以直接复用。不要依赖复制的 .venv 环境：启动器会检查并保留失效环境，然后为当前电脑重建。首次准备需联网，目录应可写。AMD/Intel/无独立显卡使用 CPU；NVIDIA CUDA 检查失败时回退 CPU 并提示更新驱动。CPU 下中文语音合成可能较慢。
