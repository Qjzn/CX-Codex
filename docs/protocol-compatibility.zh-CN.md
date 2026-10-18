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

官方文档同时提供协议 schema 生成命令。生成结果与当前运行的 Codex 版本精确对应，因此每次升级 Codex CLI / App Server 后都必须重新生成并审计；但仓库基线 `documentation/app-server-schemas/` 不得被生成结果直接覆盖，一律生成到独立输出目录再比对：

```powershell
npm.cmd run audit:app-server-schemas -- -CodexCommand "E:/path/to/codex.exe" -OutputRoot "output/app-server-schema-audit" -FullDiff
```

`-CodexCommand` 指向本次要审计的可执行文件（显式参数优先于环境变量和 PATH）；脚本在生成前后对该目标做指纹校验，目标在中途变化即判 `changed` 并停止。

WebSocket 模式仍按官方说明视为实验能力。面向非本机地址开放时，不能把未鉴权 WebSocket 当作生产远程传输方案宣传或默认启用。

## 仓库内基线

当前仓库保留了 App Server 协议基线：

- `documentation/app-server-schemas/typescript/`
- `documentation/app-server-schemas/json/`
- `documentation/app-server-schemas/json/codex_app_server_protocol.schemas.json`
- `documentation/APP_SERVER_DOCUMENTATION.md`

这些文件是本项目升级 Codex CLI / App Server 时的协议审计基准。任何会影响 runtime、thread、turn、approval、interrupt、stream event、schema normalizer 的改动，都必须先比对官方最新 schema。

## 推荐审计流程

不要直接覆盖仓库基线。使用仓库内冻结的审计入口：脚本会在输出根下自建带时间戳的子目录、生成 schema，并对仓库基线做只读 diff，不会写入 `documentation/app-server-schemas/`（本文件不写具体的时间戳子目录名）：

```powershell
npm.cmd run audit:app-server-schemas -- -CodexCommand "E:/path/to/codex.exe" -OutputRoot "output/app-server-schema-audit" -FullDiff
```

`-CodexCommand` 指向本次要审计的可执行文件（显式参数优先于环境变量和 PATH），脚本在生成前后对该目标做指纹校验，目标中途变化即判 `changed` 并停止。不要用 PATH 上的 `codex` 或不带 `-CodexCommand` 的裸 `generate-ts`／`generate-json-schema` 代替这次冻结的目标。

比对按目录记录**原始退出码**：`0` = 匹配、`1` = 存在差异（差异的**数量**并不由这个 `1` 表示），其他非 0/1 的原始错误需单独处理。发布前需要人工确认差异属于以下哪一类：

- 新方法、新事件或新字段：补 normalizer、类型和 UI 展示。
- 字段重命名或删除：补兼容层，避免旧线程读取失败。
- 审批或停止语义变化：优先修 runtime 状态机和移动端停止保护。
- 认证或传输行为变化：先更新安全边界，再更新 README。

退出码语义（2026-10-16 明确）：schema 比对 `0` = 匹配、`1` = 存在差异；其他非 0/1 的原始错误（参数、环境或脚本自身失败）按错误单独处理，不计入 drift。子阶段（`--version`、`generate-ts`、`generate-json-schema`）也可能以 `1` 结束，因此判读必须结合 raw stages 与 `failedPhase` 等原始字段，不能只凭总退出码 `1` 认定 schema drift。launcher（`.cmd`/`.bat` shim）身份不足以绑定 native 目标，但两种情况要分开：B4B2 的 catalog 遇到 launcher-only 身份时返回 unavailable 且不生成；B4C 离线审计则保留 launcher-only provenance（shim hash 不能绑定 native），与活动运行身份的比较结果为 unknown。不得把离线 audit 的 provenance 一律说成 unavailable。

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

## 2026-10-16 升级候选兼容表（本地候选）

下表只汇总本轮（2026-10-15/16）本地候选的已验收范围、候选行为与降级、以及尚未测的真实层，供升级审计参考；本轮单一证据索引见 `output/hermes-codex-upgrade-20261015/b5-evidence-index.md`。所有结论都限本地离线／合成范围，不构成 OS 授权、真实新版 Runtime 或产品目标完成的声明。

| 领域 | 已验收的离线／本地范围 | 候选行为与降级 | 尚未测的真实层 |
| --- | --- | --- | --- |
| 协议基线 | 固定 0.130.0 与 0.162.1 两个离线 schema 集合的 TS／JSON 结构与权限形状对照 | 0.162.1 为固定候选（官方发布记录 2026-10-09），仅作审计基准，不声明它是当前最新版本 | 运行中 App Server 的实际版本与 executable 身份 |
| 模型选择（B1） | 合成传输下的失败／重试用例；原实现 44/50 与候选 50/50 的对照，队列 12/12、目标 27/27 | 失败后不再静默写入固定旧模型、不虚构模型能力；保留所选模型、原始错误与用户主动重试 | 真实模型入口与可用性、当前桌面行为参照 |
| 回复呈现（B2） | partial 投影、工具交错、明确 final、历史读取与刷新、导出的本地行为用例与隔离浏览器验证 | partial_answer 只作过程正文，不作为最终答案或任务终态；以上为本表已验收样本范围内的行为，不构成对所有未知事件的通用保证 | 真实 Runtime 事件流、真实 7420 入口、Android／真机 |
| 权限请求（B3） | 0.130.0／0.162.1 两版离线 schema 的 none／deny／path union／environmentId 兼容；失败保留与重试 | 产品只对本轮请求返回允许／拒绝，不给更大默认范围；省略 scope 时默认到当前 turn；按精确子集匹配，失败保留可重试 | 真实 OS 授权执行（schema 一致不足以宣称已获授权） |
| 版本绑定（B4） | 代际缓存与迟到回写防护、冻结的 active launch identity、catalog 身份绑定、离线 audit 的 generatedBy／contentDiff、与运行身份的独立比较 | catalog 遇 launcher-only 身份返回 unavailable 且不生成；离线 audit 则保留 launcher-only provenance（shim hash 不能绑定 native），与运行身份的比较结果为 unknown；旧摘要缺身份记为 unknown；离线生成结果与运行身份比较分别记录，不互相替代 | 真实新版 Runtime 的隔离验证、安装升级回滚、2h 浸泡 |

本轮 pinned 离线 audit 的真实结论：`--version`／TS／JSON 三个子阶段的原始退出码均为 `0`，TS／JSON 两个目录的**内容 diff 原始退出码均为 `1`**（差异数量不由这个 `1` 表示），总退出 `1`，并已按 drift-recorded 归档（详见 `b4c-review.md`）。这表示固定候选与仓库基线之间存在需要人工审读的 schema 差异，既不是生成崩溃，也不是“整体协议已兼容”的结论。

`documentation/APP_SERVER_DOCUMENTATION.md` 与 `docs/app-server-protocol-matrix.zh-CN.md` 仍是差异落图的主要参考；本轮未更新 schema 基线与 docs 默认 audit 摘要。

## 与其他 OpenAI API 的边界

通用 OpenAI API 只用于补充能力。例如语音转写使用 `gpt-4o-transcribe` / `gpt-4o-mini-transcribe`，但不能替代 App Server 的线程协议。接入这些 API 时，应保持独立配置、独立错误处理和最小权限环境变量，避免把 Platform API key 与 Codex App Server 认证混用。

Responses API 是 OpenAI 官方推荐给新通用 OpenAI 应用的统一 agentic API，支持多轮 state、工具和 multimodal 输入；但它的对象模型是 response/items，不是 Codex App Server 的 thread/turn/runtime/approval/notification 协议。因此本项目不能把 Responses API 当作 Codex rich-client backend 替代品，也不能用 Responses state 声明已兼容 Codex 会话恢复、审批、sandbox 或远程控制。只有当某个补充能力不需要 Codex App Server 线程语义时，才应以独立模块、独立 env、独立错误处理接入 Responses。

官方转写 multipart 由服务端规范化 `model`、`response_format` 和 diarize-only 的 `chunking_strategy`：普通转写模型使用 `json` 并清理客户端自带 `chunking_strategy`，`gpt-4o-transcribe-diarize` 使用官方要求的 `diarized_json` 并补齐 `chunking_strategy=auto`，避免客户端字段把官方模型带到不支持的响应格式。默认上传上限按官方 25 MB 文件限制收紧为 `25000000` bytes。自定义转写 endpoint 只接受 `http` / `https` URL，非法或非 HTTP(S) 配置必须回退官方默认 endpoint。诊断接口可以展示转写 provider、模型、响应格式、上传上限、生效 endpoint host/path 和 endpoint 配置/有效性布尔值，但不得展示 API key、Authorization、Cookie、URL query 或原始非法 URL。
