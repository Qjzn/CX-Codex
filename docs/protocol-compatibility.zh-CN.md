# Codex App Server 协议兼容审计

本项目的核心对接对象是 OpenAI 官方 Codex App Server，而不是通用 OpenAI Responses API。Responses、Speech to Text 等 OpenAI API 可以作为边缘能力接入，但线程、审批、流式事件、恢复、停止和会话历史必须以 Codex App Server 协议为准。

## 官方来源

- Codex App Server 文档：`https://developers.openai.com/codex/app-server`
- Codex 开源边界：`https://developers.openai.com/codex/open-source`
- Codex 远程连接安全模型：`https://developers.openai.com/codex/remote-connections`
- Codex 访问令牌说明：`https://developers.openai.com/codex/enterprise/access-tokens`

Codex App Server 是 Codex rich clients 使用的深度集成接口，覆盖认证、会话历史、审批和 streamed agent events。自动化作业或 CI 场景优先使用官方 Codex SDK，不把本项目的 Web/Android bridge 当作 CI runner 入口。

App Server 协议基线：

- 协议形态：JSON-RPC 2.0 message，但 wire 上省略 `"jsonrpc":"2.0"` 字段。
- 默认 transport：`stdio` / JSONL，每行一个 JSON message。
- 其他 transport：`ws://` WebSocket 为 experimental and unsupported；`unix://` 走 Unix socket 上的 WebSocket；`off` 表示不暴露本地 transport。
- WebSocket health probes：`GET /readyz` 表示 listener 可接收连接；无 `Origin` 的 `GET /healthz` 返回健康；带 `Origin` 的请求应被拒绝。
- WebSocket 远程暴露：非 loopback listener 在 rollout 阶段可能默认未鉴权，生产或公网场景必须先配置 WebSocket auth。
- WebSocket auth：支持 capability token file/hash 和 signed bearer token；优先使用 `--ws-token-file`，不要把原始 bearer token 写进命令行、日志或文档。
- 过载处理：bounded queue 满时可能返回 JSON-RPC error code `-32001`，客户端应使用指数退避和 jitter 重试。
- 握手顺序：连接后先发 `initialize`，再发 `initialized` notification，然后才能启动 thread/turn 并持续读取通知。

官方文档同时提供协议 schema 生成命令。生成结果与当前运行的 Codex 版本精确对应，因此每次升级 Codex CLI / App Server 后都必须重新生成到临时目录审计：

```powershell
codex app-server generate-ts --out documentation/app-server-schemas/typescript
codex app-server generate-json-schema --out documentation/app-server-schemas/json
```

WebSocket 模式仍按官方说明视为实验能力。面向非本机地址开放时，不能把未鉴权 WebSocket 当作生产远程传输方案宣传或默认启用。

## 仓库内基线

当前仓库保留了 App Server 协议基线：

- `documentation/app-server-schemas/typescript/`
- `documentation/app-server-schemas/json/`
- `documentation/app-server-schemas/json/codex_app_server_protocol.schemas.json`
- `documentation/APP_SERVER_DOCUMENTATION.md`

这些文件是本项目升级 Codex CLI / App Server 时的协议审计基准。任何会影响 runtime、thread、turn、approval、interrupt、stream event、schema normalizer 的改动，都必须先比对官方最新 schema。

## 推荐审计流程

不要直接覆盖仓库基线。先生成到临时审计目录：

```powershell
$auditRoot = "output/app-server-schema-audit/$(Get-Date -Format yyyyMMdd-HHmmss)"
codex app-server generate-ts --out "$auditRoot/typescript"
codex app-server generate-json-schema --out "$auditRoot/json"
```

再和仓库基线做只读比对：

```powershell
git diff --no-index -- documentation/app-server-schemas/typescript "$auditRoot/typescript"
git diff --no-index -- documentation/app-server-schemas/json "$auditRoot/json"
```

`git diff --no-index` 在发现差异时会返回非零状态码，这代表 schema 有变化，不等同于命令失败。发布前需要人工确认差异属于以下哪一类：

- 新方法、新事件或新字段：补 normalizer、类型和 UI 展示。
- 字段重命名或删除：补兼容层，避免旧线程读取失败。
- 审批或停止语义变化：优先修 runtime 状态机和移动端停止保护。
- 认证或传输行为变化：先更新安全边界，再更新 README。

也可以直接运行仓库脚本：

```powershell
npm run audit:app-server-schemas
```

脚本会生成临时 schema、输出差异统计，并在发现协议差异时以退出码 `1` 结束，方便 CI 或发布前检查识别“需要审计”的状态。

## 兼容门槛

一次协议相关发布至少满足以下门槛：

1. `app-server init` / 握手能力不回退。
2. 线程列表、线程读取、发起 turn、恢复 turn、steer/interrupt 保持可用。
3. 服务端事件流不会因为新增未知事件导致前端崩溃。
4. 实验字段必须有能力判断或降级路径，不能强依赖为稳定 API。
5. 远程访问、令牌、代理和日志不泄露 OpenAI/Codex 凭据。
6. `tests.md` 记录手工验证步骤和实际验证证据。

## 2026-07-03 初始审计结论

使用当前本机 Codex CLI 运行 `npm run audit:app-server-schemas` 后，官方生成 schema 与仓库内基线存在大范围差异，因此本项目不能直接声明已经对齐最新 App Server 协议。后续升级应先完成差异分组和兼容映射，再决定是否更新仓库 schema 基线。

已观察到的重点差异领域：

- v2 协议 bundle 新增 `codex_app_server_protocol.v2.schemas.json`。
- 权限与审批扩展，包括 permission profile、guardian review、network/file-system 权限。
- MCP 扩展，包括 elicitation、resource read、server tool call/status。
- 插件与 marketplace 扩展，包括安装、读取、分享、卸载和插件技能读取。
- Hook、外部 agent 配置迁移、Windows sandbox readiness/setup。
- Thread/Turn 扩展，包括 goal、status、metadata update、inject items、shell command、unsubscribe、realtime audio/transcript。
- 文件系统与进程/命令执行扩展，包括 fs watch/read/write/remove、process output、terminal resize。

这意味着下一阶段的优先级应是“协议差异落图”，而不是直接覆盖基线。

详细差异矩阵见 `docs/app-server-protocol-matrix.zh-CN.md`。该矩阵把最新 schema 差异拆成核心 thread/turn、runtime、权限、MCP、插件、文件系统、realtime、Windows sandbox、release governance 等能力域，并标记当前项目状态和下一步门槛。

## 与其他 OpenAI API 的边界

通用 OpenAI API 只用于补充能力。例如语音转写使用 `gpt-4o-transcribe` / `gpt-4o-mini-transcribe`，但不能替代 App Server 的线程协议。接入这些 API 时，应保持独立配置、独立错误处理和最小权限环境变量，避免把 Platform API key 与 Codex App Server 认证混用。官方转写 multipart 由服务端规范化 `model`、`response_format` 和 diarize-only 的 `chunking_strategy`：普通转写模型使用 `json` 并清理客户端自带 `chunking_strategy`，`gpt-4o-transcribe-diarize` 使用官方要求的 `diarized_json` 并补齐 `chunking_strategy=auto`，避免客户端字段把官方模型带到不支持的响应格式。默认上传上限按官方 25 MB 文件限制收紧为 `25000000` bytes。自定义转写 endpoint 只接受 `http` / `https` URL，非法或非 HTTP(S) 配置必须回退官方默认 endpoint。诊断接口可以展示转写 provider、模型、响应格式、上传上限、生效 endpoint host/path 和 endpoint 配置/有效性布尔值，但不得展示 API key、Authorization、Cookie、URL query 或原始非法 URL。
