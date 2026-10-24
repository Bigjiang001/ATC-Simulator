# iPad Safari 在线版适配

在雷达空白处单指拖动可平移；双指张开或合拢可缩放雷达，两指中点对应的空域保持在手指下面。缩放范围为 55%–280%，原有加减与居中按钮继续可用。雷达区域通过非被动触控监听和 touch-action 阻止网页缩放；其他页面区域保留浏览器手势。双指开始时取消尚未提交的飞机引导，全部手指抬起后才能开始下一次单指操作；系统取消触控也不会发送指令。

在线版保留 Safari 系统音色，同时加入三种内置合成男声，中文与英文均可选择。没有系统男声时，“自动匹配男声”会使用内置男声 1；若之前手动保存了婷婷或美嘉，可在设置中改选“内置男声 1 / 2 / 3”或“自动匹配男声”。手动系统音色仍优先，重复的 Safari voiceURI 只显示一项。

三种内置男声来自 eSpeak NG 的 m1、m2、m3 合成声，具有电子音质，不是自然人录音或女声降调。首次播放按需加载约 3 MB 的引擎与中英文词典；不需要在 iPad 系统设置下载声音。生成在独立 Web Worker 内执行，合成的实际 PCM 音频由 Web Audio 播放，支持静音、停止、试听打断和中英文分别保存。网络加载失败时显示错误，不会悄悄换回女声。来源、许可证和裁剪复现步骤见 online/voices/vendor/NOTICE.md 及 scripts/prepare-builtin-voices.cjs。

语音设置两列的下拉框固定为 38px，移除 flex 拉伸，统一标题、说明、滑块和试听按钮的行高。窄屏改为单列。系统音色仍可通过“刷新系统音色”更新。

验证命令：npm run typecheck、npm test、npm run test:ui、npm --prefix online run test:ipad、npm --prefix online run test:voices。独立语音浏览器测试模拟系统只有婷婷/美嘉，检查三种内置男声实际生成不同的非静音 PCM、自动回退、试听打断、重载保存、重复音色去重以及横竖屏两列对齐。本次 Chromium 和 Playwright WebKit 的横竖屏语音与布局测试均通过。设置 ATC_TEST_ENGINE=webkit 可重复 WebKit 测试。未连接实体 iPad。
