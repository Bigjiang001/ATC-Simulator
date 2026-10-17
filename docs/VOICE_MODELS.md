# 本地声音与模型扩展

这里介绍项目当前实际接入的模型。在线版使用浏览器声音，本页的模型设置只用于 `local/`。

## 当前组合

- 中文合成：[Qwen3-TTS-12Hz-0.6B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice)。Apple Silicon 使用 [MLX 8-bit 转换版本](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit)，Windows / Intel Mac 使用 PyTorch 运行方式。
- 默认英文合成：[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)，通过 [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) 运行。当前游戏接入六种英文音色；模型提供的其他声音不代表已经在游戏菜单中接好。
- 识别：[SenseVoice Small](https://huggingface.co/FunAudioLLM/SenseVoiceSmall)。它负责把语音变成文字，不提供机组声音。

## 可以先试听哪些声音

| 模型音色 | 原生语言或方言 | 大致特点 |
| --- | --- | --- |
| Vivian | 普通话 | 明亮年轻女声 |
| Serena | 普通话 | 温暖柔和女声 |
| Uncle_Fu | 普通话 | 成熟浑厚男声 |
| Dylan | 北京话 | 年轻男声 |
| Eric | 四川成都话 | 活泼男声 |
| Ryan、Aiden | 英语 | 不同风格男声 |
| Ono_Anna | 日语 | 轻快女声 |
| Sohee | 韩语 | 温暖女声 |
| Adam、Michael、George | 英语 | Kokoro 男声，其中 George 为英式英语 |
| Bella、Heart、Emma | 英语 | Kokoro 女声，其中 Emma 为英式英语 |

Qwen 音色可以跨语言朗读，外语音色读中文可能有口音；标签标的是音色原生语言。选一个自己喜欢的声音，调到适合短句通话的速度即可，不需要为了换内置音色再次下载模型。

## 想换成别的模型

欢迎试验和分享。建议先 Fork 仓库，从一组固定的中英文指令开始比较，尤其留意航班号、跑道号、高度、航向的读法和机组最后报呼号的顺序。

需要适配的主要位置：

- `local/atc_ai_server.py`：`/api/tts`、`/api/asr` 与健康检查。
- `local/scripts/qwen_bridge.py`、`qwen_worker.py`：独立模型进程和合成适配。
- `local/src/audio/voiceCatalog.ts`：可用音色、模型标识和默认声音。
- `local/src/audio/soundEngine.ts`：前端请求、返回模型/音色校验、播放和取消。
- `local/scripts/launch_atc.py`：如果替换模型改变健康检查条件，要同步更新就绪判断。

现有前端会校验 TTS 返回的 `X-ATC-TTS-Engine`、`X-ATC-TTS-Voice`。接入新模型时应同步维护接口与目录，不要让“选中的声音”和“实际播放的声音”不一致。语音合成失败保留通话文字，不自动切换其他声音。

修改源码后在 `local/` 安装开发依赖并运行 `npm test`、`npm run build`，重新生成本地 HTML，再重启启动器。请不要只修改已打包 HTML 而遗漏源代码。

模型权重不放进 Git 仓库。模型及运行库各有许可，接入与分享时请以其官方页面为准，保留相应说明。感谢这些开源项目让本地语音体验成为可能。
