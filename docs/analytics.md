# ATC-Simulator 访问与游戏统计

## 直接打开

在这台 Mac 双击根目录的 **打开统计面板.command**，或执行 `npm run admin`。启动器会自动开启本机服务并验证身份，浏览器展示真实汇总和趋势图，每 15 秒刷新。无需再注册账号、填写账单地址或绑定银行卡。锁定或会话过期后，重新双击即可。

目前采用 **Firebase Spark + 本机受信任聚合**：GitHub Pages 游戏直接上传 Firebase，管理员电脑仅在看面板时需要运行。关闭管理员电脑不影响其他玩家上报。公开网站的 `/ATC-Simulator/admin/` 只提示使用本机入口，不公开报表或玩家明细。换电脑需安装 Node.js 22、项目依赖，并使用有项目权限的 Google 账号完成一次 Firebase CLI 登录。

已配置的公开项目 ID 是 `project-5127246643163647096`，GA4 衡量 ID 是 `G-ZY4BYQD11Q`。生产 Web 配置位于 `analytics/config.public.json`，已开启匿名认证并部署数据库规则。Firebase 控制台的 Google 登录也已启用；本机面板使用已登录的 CLI 身份，无须再次进行网页 Google 登录。历史数据只能从接入后积累，无法补回之前未采集的访问。

## 检查结果与最小改动

原项目的 `online/scripts/build-standalone.cjs` 把 TypeScript 打成单个游戏 HTML，`scripts/build-site.cjs` 合并 `website/` 和游戏到 `dist/`，Actions 发布该目录；测试要求 `online/index.html` 与 `website/game/index.html` 一致。

保留这些机制：首页只加入统计标记；`online/src/game/analytics.ts` 从 store 发出独立状态通知，不改变游戏状态或 UI；两个构建入口统一注入统计配置、核心与客户端代码，并同步游戏镜像。`scripts/admin-data.cjs` 在本机读取 Firebase 原始活动，在返回浏览器前聚合为数字。网络错误、广告拦截或认证失败不阻止游戏；`file://` 不发送统计。

## 指标口径

日报按北京时间（UTC+8），面板使用 Firebase 数据，GA4 是独立的访问分析来源。

| 指标 | 定义 |
| --- | --- |
| 页面浏览量 PV | 每次打开首页或游戏文档各计一次；刷新增加 PV |
| 今日网站访客 UV | 当日首页或游戏页匿名 UID 去重；直接进游戏也算 |
| 游戏访客 | 当日打开游戏页的 UID 去重，包括只停在大厅的人 |
| 实际游戏玩家 | 当日开始一局或跨日继续产生有效游玩时长的 UID 去重 |
| 当前在线玩家 | RUNNING、未暂停、页面可见、数据库已连接、近 5 分钟有操作、近 90 秒有心跳的 UID 去重 |
| 每日游戏局数 | 当天开始的局数；暂停恢复不增局，重试/换场景重新计局 |
| 有效游玩时长 | 实际墙钟时长，排除暂停、后台、断网、长时间闲置；不随游戏倍速改变 |
| 结束数 | 成功上报的通关、失败、回大厅、重试及关闭页面；不是通关数 |

同一浏览器多标签共享匿名 UID；每个文档有独立 UUID。访客、玩家、在线人数去重，局数及按局游玩的时长相加，不表示去重后的自然人小时。支持 Web Locks 时串行首次匿名登录，避免新标签并发创建身份；不支持 Web Locks 或禁止持久存储时，首次并发去重存在限制。无痕、清除站点数据、换设备/浏览器会形成新访客。

30 秒上报一次，先注册 `onDisconnect().remove()` 再发布在线状态，每次重连重新注册。暂停/隐藏立即尝试移除在线；异常断网/关闭的在线租约最多 90 秒，面板再有最多 15 秒刷新延迟。每秒计时确认的单次间隔最多 1.5 秒，挂起后不会补算数小时，跨午夜拆分时长。键鼠、触摸、滚轮、手柄操作可续期 5 分钟闲置计时。

浏览器突然关闭可能损失最后一个 30 秒上报周期，结束事件也可能缺失。因此在线数不依靠结束事件。累计上报和按文档取最大值使重试/乱序不重复累计。客户端统计不能阻止恶意玩家伪造自己范围内的活动，不能用作比赛裁判或计费依据。

## 新项目首次配置步骤

当前项目已完成这些步骤；更换项目时才需重做。

### Google Analytics

1. 在 [Analytics](https://analytics.google.com/) 创建 GA4 资源，报告时区选 Asia/Shanghai。
2. 添加 Web 数据流，网站 URL 填 `https://bigjiang001.github.io/ATC-Simulator/`，取得 `G-...` 衡量 ID。
3. 填入配置中的 `ga4MeasurementId`。代码手动发送 page_view，不要再加重复的 gtag 或 GTM 页面统计。
4. 实时或 DebugView 检查 `page_view`、`home_page_view`、`game_page_view`、`game_start`、`game_end`。可把 game_start 标记为关键事件；生产调试结束后关闭 debug_mode。
5. 按需设置内部流量过滤、数据保留期限和适用的隐私/同意流程。GA4 历史报表有延迟，实时游戏在线数以 Firebase 面板为准。面板不需要 GA4 Data API 权限。

### Firebase 免费方案

1. 在 [Firebase Console](https://console.firebase.google.com/) 创建 Spark 项目、注册 Web 应用，复制公开 Web 配置。不要进入 Blaze 升级或账单注册流程。
2. Authentication → Sign-in method 启用 Anonymous，玩家自动获得匿名身份，无须注册。Google 登录仅在使用可选云端管理员方案时必需。
3. 需要网页 Google 登录时，在 Authentication → Settings → Authorized domains 加入 `bigjiang001.github.io` 和 `localhost`。
4. 创建 Realtime Database，选锁定模式，建议 Singapore（asia-southeast1），取得完整 databaseURL。
5. 安装依赖并以项目所有者/有相应权限的账号登录，部署本仓库安全规则：

```sh
npm ci
npm ci --prefix tests/firebase
node tests/firebase/node_modules/firebase-tools/lib/bin/firebase.js login
node tests/firebase/node_modules/firebase-tools/lib/bin/firebase.js deploy --project YOUR_PROJECT_ID --only database
```

6. 修改 `analytics/config.public.json` 的公开 Web 配置、GA4 ID、`enabled: true`、`dashboardMode: "local"`。运行 `npm run build` 并发布现有 Pages。双击启动器查看面板。

本机 Google OAuth 由官方 Firebase CLI 保存与刷新，**不写入仓库或网页**。需要重新登录时运行上面的 login 命令。若本机网络依赖代理，启动器会读取 macOS HTTPS 系统代理；也支持标准 HTTPS_PROXY/HTTP_PROXY 环境变量。

## 配置与每次发布

优先级：`ATC_ANALYTICS_CONFIG_JSON` 环境变量 → `ATC_ANALYTICS_CONFIG` 指定文件 → 被 gitignore 排除的 `analytics/config.local.json` → 已提交的 `analytics/config.public.json` → 关闭的示例配置。显式指定的文件不存在会报错。CI 的 Actions Variable `ATC_ANALYTICS_CONFIG_JSON` 可覆盖公开配置；不设置时也会正常加载生产公开配置，不会每次发布丢失统计。

Firebase Web apiKey 和 GA4 衡量 ID 是公开客户端配置，访问权限依靠认证和安全规则。构建器只接受白名单字段，禁止服务账号 JSON、private_key、refresh token、GA API secret。不要手动编辑生成 HTML。

```sh
npm run typecheck
npm test
npm run build
```

现有路径保持：首页 `/ATC-Simulator/`、游戏 `/ATC-Simulator/game/`，兼容跳转不变。standalone 构建也内嵌统计。测试构建强制关闭统计，发布前最后执行正式 build。

## 权限、存储和额度

数据库默认拒绝全部读写；匿名用户只能写自己的 activity 和 presence，不能读整表或其他玩家；字段、时间、单调累计值和归属均受规则校验。网页 Google 管理员也不能直接读原始表。

本机服务只监听 127.0.0.1，验证 Host、Origin、SameSite 与本机启动器的一次性票据；浏览器得到 8 小时 HttpOnly 会话。启动器控制凭据保存在系统临时目录，文件权限 0600。API 仅返回日汇总数字和在线数，不返回 UID、标签页、OAuth 凭据或原始活动。能使用本机操作系统账号的人可运行启动器，因此管理员电脑本身应保持私有。锁定面板会销毁当前会话。

本机方案按日期读取所选 7/30/90 天原始活动后聚合，历史缓存 30 秒，在线每次重查最近 90 秒的心跳。原始数据保留在 Firebase，**本机方案没有自动清理任务**；当前最多展示 90 天，监控存储和下载使用量，在清理原始数据前应先导出备份。大流量下应改用服务端预聚合，避免频繁读取原始数据。

Spark 当前提供 1 GB 存储、每月 10 GB 下载，最多 100 个同时数据库连接；连接是标签页/客户端连接，不是去重玩家数，首页也会占连接。达到免费额度会影响统计服务；当前未关联账单，不会自动切成付费方案。参考 [官方用量说明](https://firebase.google.com/docs/database/usage/billing) 和 [连接限制](https://firebase.google.com/docs/database/faq-and-troubleshooting)。在 Firebase Realtime Database 的 Usage 页监控额度。

## 可选云端管理员模式

当前没有部署 Cloud Functions，也不需要此模式。以后若希望在任何电脑网页登录管理员面板，可自行决定启用 Blaze 后部署仓库中的 Functions；它需要关联结算账号，应先了解 [计费方案](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)。

安装 `firebase/functions` 依赖，部署 database 与 `functions:statistics`，将 dashboardMode 改为 cloud。Functions 默认区域 asia-southeast1；自定义区域需同时修改配置 functionsRegion 和函数环境变量 STATISTICS_REGION。获授权 Google 用户登录一次取得 UID 后，在可信 ADC 环境执行 `node firebase/functions/set-admin.cjs PROJECT_ID UID grant`，撤权用 revoke。接口核验有效 token、非匿名身份、admin 声明以及当前账号声明，浏览器只得到汇总。可选 ENFORCE_APP_CHECK 与公开 appCheckSiteKey 需配套配置。该模式的定时任务每天清理 35 天前原始身份记录，保留数字日报，与当前本机保留行为不同。

## 测试与验收

```sh
npm run typecheck
npm test                       # 原有回归 + 统计核心/构建 + 本机权限测试
npm run test:ui                # 原游戏真实浏览器回归
npm run test:analytics:browser # 浏览器统计生命周期，SDK 传输替身
npm ci --prefix tests/firebase
npm ci --prefix firebase/functions
npm run test:analytics:rules   # Auth/RTDB/Functions 模拟器，需要 Java 21+
npm run build                 # 最后还原正式启用的产物
```

自动化涵盖暂停、后台、闲置、断网重连、BFCache、重复标签 UID、跨日计时、重复通知、聚合重试、过期心跳、规则越权与管理员撤权；本机测试检查一次性票据、HttpOnly cookie、Host/Origin、未登录拒绝、文件隔离和锁定会话。

上线后打开首页再进游戏，应先出现访客，开始后才出现实际玩家和在线；暂停应停止计时/在线，恢复不新增局数；关闭全部游戏后最多 90 秒加刷新间隔清除在线。首次验证访问也会计入真实数字。GA4 单独通过实时报告验收，不要求与 Firebase 数字完全相同。
