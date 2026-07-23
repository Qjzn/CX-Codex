# Android 壳应用一期

本项目的一期 Android 方案不是把 Node 桥接后端搬进手机，而是用 Capacitor 把现有 Web 前端封装成安卓壳，并连接一台已经运行 `CX-Codex` 的远程地址。

## 目标

- 复用现有 Web 前端，不重写页面
- 在 Android 端接入更稳定的前后台恢复和网络恢复事件
- 为后续通知、语音、文件上传和本地持久化预留原生入口

## 当前范围

- 已接入 Capacitor Android 基础依赖
- 已新增 App 生命周期和网络状态桥接
- 已新增 Android 原生通知权限和任务通知桥接
- App 回到前台、网络恢复或 WebView 重新载入时，会先回放持久化的服务端事件游标，再复用现有 Web 端自动补同步逻辑

当前这版仍然依赖远程 `CX-Codex`，不支持离线独立运行。

## 使用方式

1. 先准备一台可访问的 `CX-Codex`

例如局域网或公网地址：

- `http://192.168.x.x:7420`
- `https://your-remote-host.example.com`

2. 可选：在 PowerShell 中设置 Android 壳要预置的连接地址

```powershell
$env:CAP_SERVER_URL = "https://your-remote-host.example.com:7420"
```

默认发行 APK 不预置任何服务地址。首次进入 App 时需要输入连接地址，保存后会持久化到本机，后续启动会自动进入该地址。可以直接粘贴浏览器中的 CX-Codex 地址；App 会自动移除 `#/`、会话路由和查询参数，只保留可用于连接的服务基础地址。

3. 生成 Android 工程

```powershell
npm run mobile:android:add
```

4. 同步前端资源与 Capacitor 配置

```powershell
npm run mobile:android:sync
```

5. 用 Android Studio 打开原生工程

```powershell
npm run mobile:android:open
```

## 当前脚本

- `npm run mobile:android:add`
- `npm run mobile:android:sync`
- `npm run mobile:android:open`
- `npm run mobile:android:run`

## 本地 release 签名

当前工作区已经支持本地签名版 APK：

- 本地 keystore：`%USERPROFILE%\\.cx-codex\\android-signing\\cxcodex-release.jks`
- 本地签名配置：`android/keystore.properties`

这两个文件只用于当前机器：

- `android/keystore.properties` 已加入 `.gitignore`
- keystore 不会随仓库提交

构建命令：

```powershell
$env:JAVA_HOME = "C:\\Program Files\\Java\\jdk-24"
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\\Android\\Sdk"
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
cd android
.\gradlew.bat assembleRelease
```

默认产物：

- `android/app/build/outputs/apk/release/app-release.apk`

## 当前 Android 产品化收口

- 应用名称：`CX-Codex`
- 默认远程地址：发行包默认留空；如需私有包预置地址，可通过 `CAP_SERVER_URL` 同步写入原生配置
- Android 已显式放开 HTTP 明文访问，适配自托管 `http://host:port` 场景
- 启动页已改为原生 SplashScreen + 品牌图标方案
- App 设置里已新增“移动端连接”区块：
  - 可直接查看当前连接地址
  - 可手动修改服务地址并保存重连
  - 私有预置包可恢复打包时写入的默认地址；公开发行包默认地址为空
- Android 会在登录成功后持久化访问密钥；Cookie / token 失效或服务重启后，会优先使用本机密钥自动重登
- App 设置里已新增“App 更新”区块：
  - 可读取 GitHub 最新 Release
  - 可显示当前安装版本、最新版本和 APK 名称
  - 可直接下载最新 APK 并拉起系统安装
- Android 原生插件已补充移动端稳定性能力：
  - 对话执行、发送、排队、打断时接入轻量触感反馈
  - 对话活跃和同步追平期间保持屏幕活跃，减少锁屏 / 息屏后的断点感
  - App 设置里可读取原生网络、设备省电状态和 WebView 版本，方便定位真机差异
  - App 设置会显示系统是否限制后台运行，并提供进入 Android 电池优化名单的手动入口
  - App 设置里可分别检测 Android 应用通知权限和“任务完成”通道，通道被单独关闭时可直达对应系统设置恢复
  - 等待确认、任务完成和任务出错时，可通过 Android 本地通知提醒
  - 语音转文字由 App 原生录音后自动提交 CX-Codex 转写接口：即使连接的是 `http://` 自托管服务也不受网页麦克风安全上下文限制，也不依赖厂商系统语音服务；首次使用会申请 `RECORD_AUDIO` 权限，用户点“完成”后自动转写并回填输入框，不需要手动选择或上传音频。
  - 设置中的“任务宠物”可开启 Android 系统悬浮窗：空闲时默认收成 48 × 48 dp 安全触控气泡，任务到来后恢复为 72 × 79 dp 的 CX 品牌宠物，并在收起状态保留一条可点击的最新回复气泡；宠物会随待命、工作中、待处理、完成未读和拖拽切换五组四帧动图。展开后最多显示 3 条任务与最近 2 条会话，任务卡优先展示助手最新回复，标题和项目只作为上下文；头部 CX Logo 用于进入平台，叉号用于关闭浮窗。
- 任务宠物由 `specialUse` 前台服务维持；该类型用于用户主动发起的 AI 长任务进度监控、完成通知和可选浮窗，不使用 Android 15 受 6 小时配额限制的 `dataSync` 类型。WebView 切到后台后会把最多 8 个已知任务交给原生监控。活跃任务会建立独立的原生 SSE 事件连接，助手回复、待确认和终态事件会立即唤醒一次权威快照核对；连续回复在浮窗展开可见时按 250 毫秒节流，收起或后台时按 750 毫秒节流，若事件到达时已有请求在途，会在本次请求结束后立刻补查一次，终态始终零等待。约 3 秒的常规批量轮询继续作为断流、代理不支持 SSE 或事件顺序不确定时的兜底，失败时降频到 7.5 秒，SSE 自身按 1.5 秒有界重连。单条与批量快照都会从 Runtime Store 的 SQLite 记录恢复，7420 或 App Server 重启后不会因新进程内存为空而丢掉浮窗最新回复；首个后续增量也会在持久化尾部上继续拼接。每条回复同时保留 agent item 归属；同一 turn 的 commentary 或 final assistant item 切换时，首段新内容会替换上一条而不是临时拼接。长回复在服务端保留最新 1200 字，WebView 交接摘要保留最新 260 字，完成和前端同步都不会跳回开头。前端任务列表暂时变空只代表渲染层已收敛，不会停止或删除原生仍在跟踪的任务；原生会保留最多 16 条已知记录，直到服务端给出权威终态。每个活跃记录同时携带稳定的活动标识、开始时间和事件序号；同一会话开始下一轮后，上一轮仍在途的轮询结果会被识别为旧代际并丢弃，不能误发完成通知或把新任务改成已完成。新会话、已有会话、自动队列执行、失败重试和语音回滚重发都会在本轮请求提交时立即把稳定的 `clientMessageId` 交给原生层；自动队列执行期间直接使用首条持久队列项的 ID。原生先查询持久化请求记录确认本轮已经被 Runtime Store 接受，再读取会话快照，因此不会把上一轮完成状态误当成本轮终态。该交接可越过一条仍在等待 bridge 回执的旧同步，同时 `/runtime/send` 继续并行派发，不增加发送前等待。无 `threadId` 的 HTTP 202 已经表示请求持久接收，界面会立即记录接收反馈；真正的 `thread/start` / `turn/start` 仍作为独立阶段继续显示和计时，不会用提前确认掩盖启动耗时。只有已被前端移除且连续 3 次确认服务端不存在的无会话临时请求才会静默清理。活跃任务连续 10 分钟没有新状态、事件或回复时，会通过独立的默认重要性通道首次提醒；此后约每 20 分钟低频复盘一次。每次持久任务快照都会用 `setAndAllowWhileIdle` 安排非精确本地复盘：Service 存活时沿用内存任务去重，进程已回收时 Receiver 只读取持久快照、提交提醒水位并续约，不联网、不改变任务状态，也不依赖后台重启前台服务。实际时间可能被 Doze 或厂商省电策略延后，有真实进展后重新计时，完成通知会覆盖无进展提醒。活跃任务会持有最长 30 分钟的受控 CPU 唤醒锁，状态、事件序号或回复有新进展时重新计算时限；任务全部结束会立即释放，长时间没有任何进展不会无限耗电。复盘 alarm 与 WakeLock 时限相互独立，因此释放 CPU 所有权不会永久丢掉后续提醒。完成记录持久保留，只有用户点击进入对应会话读过后才清理。
- 原生监控会订阅 Android 应用默认网络变化。服务启动时先记录当前网络，避免首次注册重复拉取；之后飞行模式关闭、默认网络恢复或 Wi-Fi/移动网络切换且仍有活跃任务时，立即触发一次权威快照并重建 SSE。若快照已经在途，只保留一次紧随其后的补查。回调随服务销毁注销，网络恢复次数和最近可用/丢失时间会写入不含会话内容的诊断快照。
- 原生监控另保存一份不含消息正文、会话标识和服务地址的低频诊断快照，并随 `getTaskPetStatus` 返回：包括当前监控/SSE 状态、重连次数、最近相关事件与事件唤醒轮询时间、权威快照成功/失败、终态时间、完成通知投递结果，以及通知正文来自 `latest_reply`、通用 `detail` 还是 `reply_retry`。该来源标记只证明通知是否携带了权威最新回复，不保存回复内容。回复渲染计数仅在匹配任务位于实际 shown 且 alpha 非零的展开面板或收起态最新回复气泡时提交；预构建的隐藏行不会让严格真机验收假通过。诊断只用于真机锁屏、弱网、进程重建和 Doze 时延复盘，不参与任务状态判断，也不在普通设置界面持续展示。
- Android 深度 Doze 的终态提醒支持可选 FCM 唤醒：服务端只在 Runtime Store 已持久化 `turn/completed`、中断或失败终态后，向仍订阅该会话的 Android 实例发送高优先级 data message。载荷只包含 `kind`、`threadId`、`turnId`、`eventSeq` 和终态方法，不包含问题、回复正文、服务地址、Cookie 或访问密钥。原生收到后只把它当作唤醒信号；必须同时满足“本地仍有该任务或未完成回执”和“消息实际以高优先级送达”，才会从后台拉起现有 `specialUse` 前台服务并回查 `/runtime/snapshots`。最终状态、最新回复和完成通知仍由权威快照与现有任务身份去重链路决定。FCM HTTP 2xx 只表示 Google 接受了消息，7420 会继续保留 outbox；Android 应用权威终态并尝试完成通知后，通过当前登录态提交设备处理回执，服务端此时才写入投递账本并停止重投。未配置 Firebase 时该路径关闭，SSE、3 秒轮询、网络恢复和前台补同步保持原样。
- 若任务终态先于 FCM token 或活跃会话订阅注册，注册请求会从 Runtime Store 的持久快照追赶当前仍有效的最后终态并补入同一 outbox。追赶只接受完成、中断、停止或失败快照及其匹配的最后事件；同一会话已经进入新一轮 running 时不会发送上一轮唤醒，重复注册、终态回调并发和服务重启继续由同一投递身份与设备回执去重。

## 深度休眠 FCM 配置

FCM 是可选增强，不是普通开发构建的前置条件。当前仓库没有提交设备端 Firebase 配置或服务账号凭据；缺少配置时 Android 仍可编译运行，设置页会显示“App 未配置 Firebase”或“服务端未配置”。

配置前后都可以运行脱敏预检；默认模式只报告状态，不会因为缺配置而中断开发构建，也不会输出私钥、服务账号邮箱、设备 token 或 Firebase 项目标识：

```powershell
npm.cmd run verify:mobile-push-readiness
```

1. 在 Firebase 项目中添加 Android 应用，包名必须为 `com.cxcodex.bridge`，把生成的 `google-services.json` 放到本机 `android/app/google-services.json` 后重新构建 APK。
2. 为 7420 所在主机准备仅用于 FCM HTTP v1 的服务账号 JSON，保存在仓库之外。不要把服务账号 JSON、私钥或设备 token 提交到 Git。
3. 启动 7420 前把服务账号路径交给 Google Application Default Credentials：

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\cx-codex-firebase-service-account.json"
# 仅当服务账号中的 project_id 不是目标发送项目时才显式覆盖：
$env:CX_CODEX_FIREBASE_PROJECT_ID = "your-firebase-project-id"
```

重新启动 7420 后先通过双端配置门槛。若服务账号只在另一个启动终端中设置，可用 `--service-account <仓库外路径>` 显式指定给预检：

```powershell
npm.cmd run verify:mobile-push-readiness -- --require-configuration
```

4. 打开 Android App。FCM SDK 生成或轮换 token 后，App 会使用当前 7420 登录态调用 `/codex-api/mobile-push/register`；服务端只保存 token、应用实例标识和当前活跃 thread 订阅，不返回或记录 token 内容。如果首次 `getToken()` 因弱网失败，活跃任务的原生监控会在权威快照收敛时继续补取，取 token 和相同失败注册都按 30 秒持久节流且禁止并发请求；WebView 挂起不会让一次 token 失败永久关闭本轮深度休眠通知。开始新任务或任务结算导致订阅集合变化时会立即注册，不等待注册节流窗口；回执丢失后的订阅状态按不确定处理，不会误用更早的成功签名跳过恢复。
5. 在 `设置 -> 移动端连接 -> 深度休眠通知` 确认状态为“已就绪”。有活跃任务时会显示订阅任务数量；没有任务时保留设备注册但不接收无关终态唤醒。

发送一个仍在执行的任务后，正式验收使用完整门槛；它同时要求运行中的 7420 已配置、至少一台设备已注册且存在活跃会话订阅：

```powershell
npm.cmd run verify:mobile-push-readiness -- --require-ready
```

注册成功同时是终态追赶边界：即使用户发送后立即锁屏，终态已经在 token 或订阅就绪前落库，设备仍会补收当前任务的无正文唤醒；这不允许把历史终态广播给没有活跃订阅的设备。

服务端发送使用 FCM HTTP v1、短期 OAuth 2.0 access token、Android `high` 优先级和 60 秒 TTL。网络或 FCM 失败按 1 秒、5 秒、15 秒、1 分钟、5 分钟和最长 15 分钟退避；FCM 接受后则按 15 秒、1 分钟、5 分钟和最长 15 分钟等待设备处理回执并重发同一无正文唤醒。每台设备最近 128 个已由设备确认的终态才会按投递身份进入 SQLite 账本，服务重启或不同任务交错后再收到同一终态也不会重复通知；token 轮换或注销会同时清理旧状态。终态推送与回执失败只写入去敏状态码与时间，不改变任务状态；FCM 报告 token 已注销时会删除该设备注册。高优先级只用于用户可见终态，不发送逐 token 进度。

## 任务宠物浮窗

1. 安装包含该功能的新 APK，进入 `设置 -> 任务宠物`。
2. 打开“系统悬浮窗”；首次开启会跳到 Android 的“显示在其他应用上层”权限页。
3. 授权后返回 CX-Codex，浮窗会自动启动并同步当前运行或等待处理的任务。
4. 可直接拖动宠物；超过轻触阈值后会切换拖拽动作并给出触感确认，松手恢复当前任务动作并自动吸附最近屏幕边缘。横竖屏或折叠状态变化后会重新贴合可见边界，矮屏自动收紧任务行数。
5. 点击宠物会平滑展开或收起任务卡；收起后保留最新一条回复气泡，点击气泡直接回到所属会话。点“进入平台”可回到 CX-Codex；“最近会话”固定显示按更新时间排序的最近两条，点击任务或最近会话都会回到对应会话。目标会话会在消费一次性 Android Intent 前同步持久化：即使首次点击时尚未配置服务地址，或 Activity、WebView、进程在异步路由加载前重建，完成配置或重建后仍会继续打开唯一的 `/#/thread/:threadId`。Vue 实际显示同一会话的消息后会先确认导航，因此活动任务或无进展提醒不会在以后每次回到 App 时反复抢占当前页面；只有任务不再运行时才会另行回执已读并清除完成记录。误入首页、空白/读取失败、仍在切换或先打开其他会话都不会确认导航。保存的服务地址也会先清除已有 `#/`、会话路由和查询参数，避免冷启动、后台唤醒或从浏览器复制地址时生成双 hash。长按最近会话，或点击任务右侧“回复”，会在浮窗内打开输入框；发送后该会话立即进入任务列表并继续轮询真实状态。若 POST 回执因断网丢失，原生会跨服务重建按同一消息标识查询而不自动重发；连续 3 次确认服务端没有该请求后，任务变成红色“待重试”、停止后台轮询和唤醒锁、保留完整回复内容并发送通知，用户手动重试时再使用新消息标识。
6. 任务完成后，只有未读任务才会切换庆祝动作并通过独立的高重要性“任务完成”通知通道展示最新回复；该通道与低干扰的常驻前台服务通知分离。Android 13 及以上会在首个真实任务已写入可靠发件箱、交给原生监控且 `/runtime/send` 已发出后，再请求一次通知权限；授权窗口不会阻塞发送，拒绝后也不会在后续任务中反复弹出。设置页会分别检测应用总通知权限和“任务完成”通道；如果用户只关闭了完成通道，会明确显示“任务完成通道已关闭”，手动点击“开启任务通知”会直达该通道的系统设置，自动发送路径不会跳转设置。永久拒绝或系统级关闭仍打开本 App 的通知设置，返回后自动重新检测。完成记录不会因为 WebView 下一次只上报活跃任务而消失；点击该任务只负责打开目标会话，等对应会话内容实际加载且任务不再运行后，前端才向原生服务回执“已读”并清理记录。若 WebView 已读状态比原生终态快一帧，回执会随当前任务代际持久化；同一代际稍后确认完成时直接清理且不发通知，新一轮任务不会继承旧回执。打开失败或尚未读到内容时记录继续保留。
   - 运行或等待中的任务连续 10 分钟没有新进展时，会显示带实际静默时长的提醒并直达原会话；之后每 20 分钟复盘一次。实际提醒时间跟随任务持久化，服务重启不会提前重复提醒；状态、事件或回复推进后旧提醒会撤销，下一段 10 分钟静默窗口再开始计时。
7. 没有任务记录时浮窗会自动收成 48 × 48 dp 气泡，内部图像为 36 × 36 dp；点击气泡可临时展开空闲面板查看最近会话，收起后重新回到气泡。任务到来时会自动恢复完整宠物，不再提供需要用户维护的“最小化”按钮。
8. 点击头部 CX Logo 进入平台；点叉号会先显示二次确认，确认后移除浮窗并同步关闭设置开关。若仍有运行任务，轻量后台监控和完成通知继续工作，任务结束后自动停止；没有运行任务时会立即停止前台服务。之后仍可在 `设置 -> 任务宠物` 中重新开启浮窗。
9. `设置 -> 移动端连接 -> 后台运行` 会显示当前系统限制。未允许时可点“调整后台运行”，在 Android 的电池优化名单中手动允许 CX-Codex；返回 App 后状态自动刷新。应用不会自动申请直接豁免，也不会在发送任务时强行跳转系统设置。

实现边界：WebView 活跃时，任务阶段、最新活动和助手最新回复会合并推送到原生浮窗；WebView 进入后台后，服务端从 `item/agentMessage/delta` 与完成事件维护有界的最新回复摘要，原生服务继续用一次批量快照约每 3 秒同步，不会为每个会话追加重读请求。多任务批量快照中会按全局事件序号选出最新助手回复并把所属任务提升到首行；该序号来自一个跨会话持久递增的回放计数器，不是每会话局部序号。后续前端快照再按原生 `lastUpdatedAtMs` 保持最新进展优先，因此可见三条不会被旧的线程列表顺序覆盖。面板收起时会把首行同一份最新回复渲染为单条紧凑气泡；若应用了新回复，待展示的任务和覆盖事件序号会跨 Service 重建保留，只有展开任务行或收起气泡真实可见后才记为已渲染，隐藏的预构建内容不会计数。WebView 恢复时可能先恢复活动任务、稍后才恢复消息历史；此时同一任务代际的相同事件序号或无序号空回复快照会继续使用原生已持久化的非空回复，只有更高事件序号或新任务代际才允许清空，避免恢复窗口让浮窗内容倒退。原生已持久化的 completed 或手动 retry 同样不会被恢复中的同代际旧 running/waiting 快照复活，即使该快照携带更高事件序号也不例外；拒绝时会同步删掉该代际刚写回的前端活跃缓存，避免下次 Service 重建再次尝试监控。事件序号只负责排序，因为同一 turn 在 assistant item 完成后仍可能收到更高序号的 token/status 元数据；只有不同 turnId/activityId 证明的新任务代际才能正常进入活动状态。每个新发送请求（包括已有会话、尚未生成 `threadId` 的首条消息和回执不确定的浮窗直接回复）都会先按稳定 `clientMessageId` 查询轻量请求记录；确认运行后再并入批量快照。浮窗只轮询前端曾同步过且尚未权威结算的任务，不扫描全部历史会话；前端省略不是删除，终态结算时原生先同步提交 completed 快照并清理旧的活跃快照缓存，然后才发送完成通知和设备回执，避免通知后进程死亡把同一轮恢复为运行中。断网时保留最后一次可用内容，恢复网络后继续核对。没有活跃任务时停止网络轮询；红色待重试项只保留用户反馈和完整草稿，不保持 SSE、轮询、无进展提醒或 CPU 唤醒锁。Android 9 及以上在可见完整宠物上播放五态 Animated WebP，旧系统使用同状态 PNG；48 dp 待命气泡固定使用静态图，完整宠物隐藏或服务关闭时停止原生动图解码。Android 会为持续浮窗显示常驻的低优先级前台服务通知。

- 同一会话的浮窗任务代际不会仅凭 Runtime 事件序号换代。WebView 的活动身份/开始时间与 Runtime 游标来自独立状态，恢复或并行页面可能短暂组合出“旧 activity + 新游标”；当新旧记录都有 `startedAtMs` 时，原生先按开始时间判断，较早活动即使序号更高也会被拒绝。开始时间相同才以序号打破平局，两侧都缺少开始时间时才把序号作为旧版本兼容依据。

## 本地一键打包

```powershell
./scripts/package-android-release.ps1 -Version 2.1.7 -VersionCode 20107
```

默认会产出：

- `artifacts/cx-codex-android-2.1.7.apk`
- `artifacts/cx-codex-android-2.1.7.apk.sha256`

如需构建私有预置地址包，再显式传入：

```powershell
./scripts/package-android-release.ps1 -Version 2.1.7 -ServerUrl https://your-codex-host.example.com -VersionCode 20107
```

## 7420 回归检查

每次调整移动端恢复、折叠屏布局、Android 壳或 7420 服务稳定性后，建议先启动本地服务，再执行：

```powershell
npm run test:7420
```

脚本会检查：

- `http://127.0.0.1:7420/health`
- `http://127.0.0.1:7420/codex-api/health`
- 传入 `-PublicHealthUrl` 时会额外检查公网 `/health`
- `http://127.0.0.1:7420/codex-api/events/replay`
- WebView 通知游标恢复
- 桌面 `1440x900`
- 手机 `390x844`
- 折叠屏 `884x1104`
- 页面关键元素、横向溢出和浏览器错误

如果本地服务没有启动，可用：

```powershell
npm run test:7420 -- -RestartIfUnhealthy
```

## Android 真机后台证据

先安装包含当前原生代码的开发包，打开任务宠物并发送一个仍在处理的任务。验证脚本默认只读，不会构建、安装 APK，也不会自动发送任务：

```powershell
npm run test:android:background
```

它会从 Android `dumpsys` 采集脱敏的任务监控状态、下一次无进展复盘时间与 AlarmManager 登记、WakeLock、息屏 / Doze、电池优化、悬浮窗和通知权限证据，写入 `output/android-background/<时间>-snapshot/`。服务诊断只包含计数、状态和时间戳，不包含服务地址、会话标识、提示词或回复正文。

每次运行还会生成 `summary.json`，自动计算本次是否出现相关事件、事件唤醒轮询、权威快照、浮窗最新回复应用/渲染、终态、完成通知和设备处理回执，并在时间顺序有效时给出事件到轮询、轮询到快照、回复事件到快照应用、快照应用到浮窗渲染、终态到通知、终态到回执的毫秒数。回复证据只记录计数、事件序号和时间，完成通知只记录结果和正文来源 `latest_reply` / `detail` / `reply_retry`，均不保存正文。

多任务同时完成时，摘要还会记录 `completionNotificationAttemptDelta` 和 `completionNotificationPostedDelta`。例如要求观察窗口内两个任务都实际投递完成通知：

```powershell
npm run test:android:background -- -Mode Observe -ObservationSeconds 60 -RequireActiveTask -RequireTerminalNotification -MinimumTerminalNotificationAttempts 2
```

需要执行真实息屏或强制 Doze 时必须显式选择模式；观察时间限制为 1–60 秒：

```powershell
npm run test:android:background -- -Mode ScreenOff -ObservationSeconds 20
npm run test:android:background -- -Mode Doze -ObservationSeconds 30
```

验证“切到其他应用”或“从最近任务划掉 CX-Codex”时使用只观察模式；脚本本身不操作最近任务，在等待窗口内手动完成动作：

```powershell
npm run test:android:background -- -Mode Observe -ObservationSeconds 30 -RequireActiveTask -RequireTaskRemoval
```

验证展开浮窗的流式最新回复时，在观察窗口内保持任务面板展开并让任务产生助手回复；默认回复事件到浮窗渲染上限为 2 秒：

```powershell
npm run test:android:background -- -Mode Observe -ObservationSeconds 30 -RequireActiveTask -RequireLiveReplyUpdate -MaxReplyRenderLatencyMs 2000
```

`summary.json` 会同时记录 Service 创建次数、sticky restart 次数、最近任务移除次数和最后启动原因。需要专门验证系统回收后的 `START_STICKY` 重建时，可再传入 `-RequireStickyRestart`；普通划掉最近任务应由同一个前台 Service 继续运行，不要求发生重建。

正式验收时可要求开始前必须已有活跃任务，并要求观察窗口内出现终态通知；默认终态到通知上限为 10 秒，可按测试目标收紧：

```powershell
npm run test:android:background -- -Mode ScreenOff -ObservationSeconds 30 -RequireActiveTask -RequireTerminalNotification -RequireDeviceAcknowledgement -MaxTerminalNotificationLatencyMs 5000 -MaxTerminalAcknowledgementLatencyMs 10000
npm run test:android:background -- -Mode Doze -ObservationSeconds 60 -RequireActiveTask -RequireTerminalNotification -RequireDeviceAcknowledgement -MaxTerminalNotificationLatencyMs 10000 -MaxTerminalAcknowledgementLatencyMs 20000
```

如果要求实时回复但没有回复事件、权威快照没有应用新回复、展开浮窗没有渲染、渲染事件序号落后或超过延迟上限，脚本会失败。任务终态验收中，任务没有在观察窗口内完成、通知尝试/成功数量少于 `MinimumTerminalNotificationAttempts`、通知结果不是实际 `posted`、正文来源不是 `latest_reply` / `detail`、设备回执不是 `acknowledged`，或任一延迟超过上限也会在保留完整脱敏证据后失败。权限或通道阻止、`reply_retry` 提醒都不会被误算成任务完成通知已送达。

`ScreenOff` 仅在屏幕原本亮起时关闭屏幕，结束后唤醒；`Doze` 会临时模拟未充电并执行 `force-idle`，脚本通过 `finally` 执行 `unforce`、恢复电池状态并唤醒屏幕。脚本不会解锁设备。多设备环境使用 `-Serial <设备序列号>`，只查看已授权设备可运行：

```powershell
npm run test:android:background -- -ListDevices
```

判定重点：跨应用且浮窗展开时，`replyEventCount`、`replySnapshotApplyCount`、`replyRenderCount` 依次前进，应用/渲染事件序号不低于回复事件序号；息屏 / Doze 期间 `running=true`、活动任务数不回退、普通息屏时 `wakeLockHeld=true`；有活跃任务时 `noProgressReviewScheduledAtMs` 应为未来时间且 `noProgressReviewAlarm` 能看到本应用的 Receiver，30 分钟 WakeLock 到期后该 alarm 仍应存在；终态后 `lastTerminalAtMs`、`lastCompletionNotificationAttemptAtMs` 与 `lastAcknowledgementAtMs` 前进，通知结果为 `posted` 且回执状态为 `acknowledged`。若通知为 `blocked` / `channel_blocked` 或回执为网络错误，分别恢复权限、通道或连接再复测。

配置 FCM 后，7420 会在网络请求前把终态唤醒写入持久化 outbox。FCM 2xx 后行仍保留为 `awaiting_device_ack`，只有同一应用实例通过 `/codex-api/mobile-push/ack` 证明已经看到不低于该终态的权威事件序号才会删除并写入去重账本。可通过 `/codex-api/mobile-push/status` 的 `pendingDeliveryCount`、`awaitingDeviceAckCount`、`nextRetryAtIso`、`lastFailureAtIso` 和 `lastError` 区分发送失败、等待设备和已收敛。outbox 与回执都不包含问题或回复正文。

Android 侧分三段持久收敛：Service 成功启动后才声明事件；权威终态应用且完成通知已尝试后写入本地待回执队列；7420 接受回执后才记录已确认并清除队列。若系统拒绝后台启动，`wake_failed` 不声明事件；若 Service 在声明后、快照前死亡，同一高优先级事件可重新启动；若本地已完成但回执网络失败，重复 FCM 只重试回执，不重复通知。

## GitHub Release 挂 APK

仓库内的 `release.yml` 已支持额外上传 Android APK，但为了保证后续站内更新可以覆盖安装，Release APK 必须始终使用同一把签名 key。建议在 GitHub 仓库配置以下 secrets：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_DEFAULT_SERVER_URL`（可选）

配置后，打标签发版时会自动：

- 构建 Web Release 包
- 构建签名版 `CX-Codex` Android APK
- 将 APK 与 `.sha256` 一并挂到 GitHub Release

## 已知边界

- 如果没有设置 `CAP_SERVER_URL`，安卓壳仍可生成，首次进入会显示连接地址配置页。
- 锁屏期间由原生前台服务通过 SSE 事件唤醒与约 3 秒快照兜底同步最新回复和完成状态，不保持 WebView 的逐 token 流式连接；重新进入应用后再由事件回放补齐完整消息历史。
- 受控 CPU 唤醒锁只能改善普通息屏；未配置 FCM 时，Android 深度 Doze 仍会暂停网络并把完成通知延迟到维护窗口或用户唤醒设备后。配置 FCM 后，高优先级终态可唤醒休眠设备，但实际时延仍受 Google Play 服务、厂商推送限制、网络和通知权限影响，必须用目标真机验证，不能描述成绝对保证。
- 长任务复盘使用无需精确闹钟权限的 `setAndAllowWhileIdle`，目的是避免主线程和 WakeLock 停止后永久无提醒，不保证严格在第 10/20 分钟触发；Doze、厂商省电、强制停止应用或设备重启都可能延后或清除系统调度，必须以目标真机 `dumpsys alarm` 和通知时间为准。
- Android 完成通知和 10 分钟无进展提醒都依赖系统通知权限；Android 13+ 会在首次真实任务可靠入队后自动请求一次，拒绝后需从设置页手动开启。应用总通知或独立“任务完成”通道被关闭时，设置页会给出对应状态和恢复入口；浮窗仍会显示“无新进展”时长，Web 端也会在回到前台后通过事件回放追平状态。
- 任务宠物依赖系统悬浮窗权限；部分厂商系统还可能要求允许后台运行或关闭激进省电策略。拒绝悬浮窗权限不会影响正常会话功能。
- 真机安装、调试和发布仍需要本机 Android SDK / Android Studio。

## 后续建议

- 在真机上补一轮锁屏、切后台、弱网和折叠屏展开 / 合上回归
- 用 `adb shell dumpsys deviceidle force-idle` 补充深度 Doze 回归，并分别验证允许/不允许后台运行时的通知延迟和恢复行为
- 配置 Firebase 后，用目标机型补齐 FCM 注册、锁屏、强制 Doze、应用进程被杀、token 轮换和通知通道关闭矩阵；记录终态事件、推送接收、权威快照、完成通知和设备回执五段时延
- 继续把高频线程状态做成更轻的服务端快照，降低长线程恢复时的重读压力
