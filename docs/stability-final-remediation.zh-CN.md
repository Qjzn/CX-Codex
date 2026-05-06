# 7420 最终稳定性整改方案

更新时间：2026-04-27

## 目标

把 7420 从“前端轮询 + 局部推断状态”的模式，改成“服务端权威运行态 + 事件游标恢复 + Web/Android 薄客户端”的模式。

最终目标不是让卡顿少一点，而是让以下问题从架构上消失：

1. 任务结束后仍显示思考中。
2. 任务执行中不显示思考中、执行状态或停止入口。
3. Android 锁屏、切后台、网络切换后同步异常。
4. `thread/list`、`thread/read`、`account/rateLimits/read` 等慢 RPC 拖住发送。
5. 公网、本地、Android 三端看到的状态不一致。

## 结论

当前不稳定不是单点 UI bug。根因是三层叠加：

1. 桥接层 RPC 慢请求和普通请求混用同一通道，后台读请求会拖住交互请求。
2. 前端依赖消息、线程列表、pending request、乐观状态拼接执行态，缺少唯一事实源。
3. Android WebView 后台会暂停事件流，恢复后没有完整的服务端快照和游标追平。

因此最终方案必须同时改服务端、前端和 Android。只调整轮询间隔、按钮显示、超时时间，不能彻底解决。

## 目标架构

```text
Codex App Server
  |
  | JSON-RPC / notifications
  v
7420 Bridge Runtime
  - RPC scheduler
  - runtime snapshot
  - event cursor
  - read-through cache
  - health diagnostics
  |
  | HTTP / SSE
  v
Web UI / Android WebView
  - cache-first render
  - snapshot-driven status
  - resume catch-up
  - native lifecycle hooks
```

核心原则：

1. 服务端是运行状态唯一事实源。
2. 前端只渲染状态，不再反推状态。
3. Android 回前台先拿快照，再补事件，最后按需读完整消息。
4. 发送、停止、权限响应永远高优先级。
5. 线程列表、额度、技能列表等非交互数据必须缓存和降级。

## P0：服务端稳定基座

### 1. 统一运行态快照

新增服务端运行态缓存，按 `threadId` 维护。

状态枚举：

```ts
type RuntimeExecutionState =
  | 'idle'
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_permission'
  | 'stopping'
  | 'completed_pending_sync'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'sync_degraded'
```

快照结构：

```ts
type ThreadRuntimeSnapshot = {
  threadId: string
  executionState: RuntimeExecutionState
  activeTurnId: string | null
  activeItemId: string | null
  canStop: boolean
  stopRequested: boolean
  pendingServerRequestCount: number
  pendingServerRequests: PendingServerRequest[]
  lastEventSeq: number
  lastEventAtIso: string | null
  lastStartedAtIso: string | null
  lastCompletedAtIso: string | null
  lastError: string | null
  stale: boolean
  degradedReason: string | null
}
```

服务端根据 Codex notifications 更新快照：

1. `turn/started`：`starting -> running`。
2. `item/started`、`item/*/delta`：刷新 `lastEventAtIso`，保持 `running`。
3. approval request：`waiting_permission`，`canStop=true`。
4. approval resolved：回到 `running` 或 `completed_pending_sync`。
5. `turn/completed`：先进入 `completed_pending_sync`，轻读确认后进入 `completed`。
6. timeout、app-server restart、notification gap：进入 `sync_degraded`，触发恢复读。
7. interrupt 请求：进入 `stopping`，确认后进入 `interrupted` 或 `completed`。

新增接口：

```text
GET /codex-api/runtime/snapshot?threadId=<id>
GET /codex-api/runtime/snapshots?threadIds=<id,id>
GET /codex-api/runtime/events?afterSeq=<n>&limit=<n>
```

验收：

1. 前端不再需要从消息内容推断是否思考中。
2. 任意任务执行期间接口都能返回明确状态。
3. 任务结束后状态 3 秒内进入 `completed` 或 `failed`。

### 2. RPC 调度隔离

现有优先级队列继续保留，但要从“单队列排序”升级为“交互快车道 + 后台队列”。

高优先级，不排队或独立通道：

1. `turn/start`
2. `turn/interrupt`
3. `thread/start`
4. `thread/resume`
5. `server/request/respond`

后台队列：

1. `thread/read`
2. `thread/list`
3. `skills/list`
4. `account/rateLimits/read`
5. metadata 类请求

规则：

1. `turn/start` 不能被任何 `thread/list`、`thread/read`、`rateLimits` 阻塞。
2. 同一线程同类型 `thread/read` 合并。
3. 队列满时丢弃低优先级读请求，不丢发送、停止、权限响应。
4. 后台读请求超时时不重启 app-server，只标记对应快照 `sync_degraded`。

验收：

1. 连续 20 次发送，`turn/start` 不因后台读请求超时。
2. `queuedRpcCount` 不持续增长。
3. `account/rateLimits/read` 慢不会影响发送。

### 3. 服务端缓存

新增读穿缓存。

缓存策略：

| 数据 | TTL | 失效条件 | 失败处理 |
| --- | --- | --- | --- |
| `thread/list` | 3-5 秒 | 线程相关 notification | 返回上次缓存并标记 stale |
| 轻量 `thread/read` | 2-3 秒 | 当前线程 notification | 返回上次缓存并触发后台恢复 |
| 重量 `thread/read includeTurns=true` | 只按需 | 当前消息区强刷新 | 失败保留旧消息 |
| `account/rateLimits/read` | 120 秒 | 用户手动刷新额度 | 返回上次缓存 |
| `skills/list` | 60 秒 | 技能目录变化或手动刷新 | 返回上次缓存 |

验收：

1. 空闲状态不再频繁打 `thread/list`。
2. Android resume 不再制造 RPC 风暴。
3. 慢 RPC 期间页面仍显示旧内容和明确 stale 状态。

### 4. 健康诊断升级

扩展 `/codex-api/health`。

新增字段：

```ts
type BridgeHealth = {
  appServer: {
    running: boolean
    initialized: boolean
    pid: number | null
    pendingRpcCount: number
    queuedRpcCount: number
    pendingServerRequestCount: number
  }
  rpc: {
    slowCount5m: number
    timeoutCount5m: number
    queuePeak5m: number
    lastSlowRpc: SlowRpcRecord | null
    lastTimeout: RpcTimeoutRecord | null
  }
  notifications: {
    latestSeq: number
    oldestSeq: number
    lastEventAtIso: string | null
    stale: boolean
  }
  cache: {
    threadList: CacheHealth
    rateLimits: CacheHealth
    skills: CacheHealth
  }
}
```

验收：

1. 用户截图“同步异常”时，可以直接从健康接口判断卡在本地服务、app-server、公网、登录态还是 Android。
2. 不再只有笼统 `ok`。

## P1：前端状态机重构

### 1. 快照驱动 UI

前端新增 `runtimeSnapshotsByThreadId`，所有状态 UI 只读快照。

替换现有推断点：

1. 思考中：`executionState in ['queued','starting','running','waiting_permission','stopping','completed_pending_sync']`
2. 停止按钮：`snapshot.canStop === true`
3. 等待权限：`executionState === 'waiting_permission'`
4. 同步异常：`snapshot.stale || executionState === 'sync_degraded'`
5. 任务完成：`executionState in ['completed','failed','interrupted']`

保留本地乐观状态，但只能作为发送后的短暂占位：

1. 用户点击发送后立即显示 `queued`。
2. 3 秒内没有服务端快照则显示“连接中”。
3. 超过 10 秒无快照进入 `sync_degraded`，触发恢复，不继续假装 running。

### 2. 消息渲染 cache-first

线程切换流程：

```text
1. 立即显示本地缓存消息和最后快照。
2. 请求 /runtime/snapshot。
3. 补 /runtime/events?afterSeq。
4. 如果 snapshot 表示有版本变化，再轻量 read。
5. 用户滚动到底部或手动刷新时，才重读完整 messages。
```

验收：

1. 切线程不空白。
2. 慢 `thread/read` 不阻塞状态栏。
3. 消息旧但状态新时，UI 明确显示“内容同步中”，不显示错误状态。

### 3. 手动刷新必须有结果

刷新按钮语义改为“强制恢复当前线程”。

动作顺序：

```text
1. restart notification stream
2. replay missed events
3. fetch runtime snapshot
4. light thread read
5. optional full read
```

刷新结果必须显示：

1. 已同步到最新。
2. 服务端运行中。
3. 网络不可用。
4. app-server 慢请求。
5. 登录态失效。
6. 公网不可达。

### 4. 状态显示规范

顶部和消息区统一状态：

| executionState | 文案 | 停止按钮 |
| --- | --- | --- |
| `queued` | 排队中 | 显示 |
| `starting` | 启动中 | 显示 |
| `running` | 执行中 | 显示 |
| `waiting_permission` | 等待确认 | 显示 |
| `stopping` | 停止中 | 禁用或 loading |
| `completed_pending_sync` | 收尾同步中 | 不显示或禁用 |
| `completed` | 已完成 | 不显示 |
| `failed` | 执行失败 | 不显示 |
| `interrupted` | 已停止 | 不显示 |
| `sync_degraded` | 同步异常 | 显示刷新 |

验收：

1. 没有“任务执行中但无状态”的情况。
2. 没有“已完成但还一直思考中”的情况。
3. 停止入口出现和消失有明确规则。

## P1：Android 稳定性重做

### 1. Resume 三段式恢复

Android 回前台后：

```text
0ms：显示本地缓存和上次快照。
0-800ms：请求 /runtime/snapshot，恢复状态 UI。
800-2500ms：请求 /runtime/events 补通知。
2500-6000ms：如果仍 stale，轻量 thread/read。
>6000ms：只在用户打开当前线程时 full read。
```

禁止：

1. 回前台立即全量 `thread/list + thread/read includeTurns=true`。
2. 多个 visibility/resume/network 事件同时触发全量同步。
3. 后台恢复时自动刷新全部线程详情。

### 2. 登录保持

Android 启动和 resume 时做健康检查：

1. WebView cookie 是否存在。
2. localStorage 关键项是否存在。
3. `/health` 是否可达。
4. `/codex-api/health` 是否 app-server 正常。
5. 401/403 是否出现。

策略：

1. 网络短断不能清登录态。
2. 401/403 才进入登录异常。
3. 登录异常只提示，不自动清缓存。

### 3. 输入法和折叠屏

输入框聚焦时：

1. 只移动 composer。
2. 不隐藏顶部状态栏。
3. 不隐藏侧边栏。
4. 折叠屏双栏布局固定为 `sidebar + conversation`，不使用普通手机单栏高度算法。

验收：

1. 折叠屏点输入框后菜单栏不消失。
2. 锁屏 1 分钟后回来，5 秒内恢复状态。
3. 网络切换 Wi-Fi/5G 后不踢登录。

## P2：公网和发布稳定

公网健康要独立于本地健康。

新增诊断项：

1. 本地 `127.0.0.1:7420/health`
2. 公网 `<your-public-url>/health`
3. app-server health
4. tunnel/FRP 状态
5. Android 当前 serverUrl

发版前必须通过：

1. 本地 Web 回归。
2. 公网 Web 回归。
3. Android APK 安装和 resume 回归。
4. 折叠屏视口回归。
5. GitHub Release 资产和版本号核对。

版本号规则：

1. 稳定性大改：`2.2.0`
2. 小修：`2.1.x`
3. 不使用英文后缀。

## 实施顺序

### 第 1 阶段：P0 服务端真相源

改动文件：

1. `src/server/codexAppServerBridge.ts`
2. `src/api/codexGateway.ts`
3. `src/api/types.ts` 或现有类型文件
4. `docs/stability-final-remediation.zh-CN.md`

任务：

1. 增加 runtime snapshot 类型和内存存储。
2. 从 notification 更新 runtime snapshot。
3. 增加 `/codex-api/runtime/snapshot`、`/snapshots`、`/events`。
4. 增加 read-through cache。
5. 增强 `/codex-api/health`。

验收命令：

```powershell
npm.cmd run build
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7420/codex-api/health
Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:7420/codex-api/runtime/snapshot?threadId=<threadId>"
```

### 第 2 阶段：P1 前端只读快照

改动文件：

1. `src/composables/useDesktopState.ts`
2. `src/api/codexGateway.ts`
3. `src/api/normalizers/v2.ts`
4. `src/App.vue`
5. `src/components/content/ThreadConversation.vue`
6. `src/components/content/ThreadComposer.vue`

任务：

1. 增加 `runtimeSnapshotsByThreadId`。
2. 替换思考中、执行中、停止按钮、同步异常判断。
3. 切线程改 cache-first。
4. 刷新按钮改强制恢复。
5. 状态文案统一。

验收：

1. 任务运行中始终有状态。
2. 停止按钮稳定出现。
3. 任务完成后 3 秒内清理思考中。
4. 慢 RPC 时不空白、不假死。

### 第 3 阶段：P1 Android 恢复链

改动文件：

1. `src/mobile/capacitorBridge.ts`
2. `src/mobile/mobileShell.ts`
3. `src/composables/useDesktopState.ts`
4. `android/app/src/main/java/com/cxcodex/bridge/MainActivity.java`
5. `android/app/src/main/java/com/cxcodex/bridge/MobileShellPlugin.java`

任务：

1. resume 事件去重。
2. resume 三段式恢复。
3. 增加 Android session health。
4. WebView cookie/localStorage 健康检查。
5. 折叠屏输入法布局修复。

验收：

1. 锁屏恢复 20 次，状态无错乱。
2. 网络切换 10 次，不掉登录。
3. 折叠屏输入框聚焦不隐藏菜单栏。

### 第 4 阶段：发版和长期监控

任务：

1. 更新 changelog。
2. 打包 APK。
3. 发布 GitHub Release。
4. 保留最近 7 天稳定性日志摘要。
5. 建立回归脚本。

验收：

1. 本地、公网、Android 三端健康。
2. APK 版本号与 GitHub Release 一致。
3. Release 附带稳定性修复说明。

## 回归用例

必须覆盖：

1. 新建会话发送一条消息。
2. 已有会话继续发送。
3. 长任务运行 2 分钟以上。
4. 任务运行中点击停止。
5. 任务等待权限时允许和拒绝。
6. 锁屏 1 分钟后恢复。
7. Android 切后台 5 分钟后恢复。
8. Wi-Fi/5G 切换。
9. 公网访问发送任务。
10. 折叠屏输入框聚焦。
11. 连续快速切换线程。
12. app-server 慢 RPC 时页面可继续阅读。

## 失败回滚

每阶段必须可单独回滚。

1. P0 回滚：保留旧 `/codex-api/rpc`，新 runtime API 不影响旧前端。
2. P1 回滚：前端保留旧推断逻辑开关，必要时切回。
3. P1 Android 回滚：resume 新链路通过 feature flag 控制。
4. P2 回滚：GitHub Release 保留上一版 APK。

建议 feature flags：

```ts
runtimeSnapshotEnabled
runtimeEventCursorEnabled
serverReadCacheEnabled
androidResumeSnapshotFirstEnabled
enhancedHealthEnabled
```

## 最终验收标准

达到以下标准才算稳定性整改完成：

1. 连续 20 次发送任务无 `turn/start` 前端超时。
2. 任务运行中 100% 有状态和停止入口。
3. 任务结束后 3 秒内不再显示思考中。
4. Android 锁屏恢复 20 次无同步异常。
5. Android 网络切换 10 次不踢登录。
6. `queuedRpcCount` 不持续增长。
7. 公网和本地状态一致。
8. 慢 RPC 出现时健康接口能说明原因。
9. GitHub Release、APK、package version 一致。
10. 回归清单全部通过后再发布。
