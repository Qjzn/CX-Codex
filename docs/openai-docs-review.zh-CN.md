# OpenAI 官方文档审查手册

本项目对接的是 OpenAI 官方 Codex App Server 和少量 OpenAI API 补充能力。任何协议、安全、远程访问、权限、语音转写或发布声明变更，都必须先确认官方文档入口和当前仓库基线是否一致。

最近审查时间：2026-07-05 02:12 Asia/Shanghai。

## 官方来源清单

优先审查这些官方入口：

- Codex App Server: <https://developers.openai.com/codex/app-server>
- Agent approvals & security: <https://developers.openai.com/codex/agent-approvals-security>
- Remote connections: <https://developers.openai.com/codex/remote-connections>
- Codex open source boundary: <https://developers.openai.com/codex/open-source>
- Codex access tokens: <https://developers.openai.com/codex/enterprise/access-tokens>
- OpenAI speech to text: <https://developers.openai.com/api/docs/guides/speech-to-text>
- OpenAI audio transcription API reference: <https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create>
- OpenAI Responses API overview: <https://developers.openai.com/api/reference/responses/overview>
- OpenAI Responses migration guide: <https://developers.openai.com/api/docs/guides/migrate-to-responses>

如果需要更完整的 Codex 产品上下文，先刷新官方 Codex manual，再只读取相关章节：

```powershell
node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs
```

当前 Codex 线程如果没有暴露 OpenAI Docs MCP 工具，先注册官方 MCP server，重启 Codex 后再优先使用 MCP 搜索/抓取；本轮未重启前继续只使用官方 OpenAI 域名页面作为来源：

```powershell
codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp
```

## 必查主题

协议相关 PR 必查：

- App Server transport：`stdio` / JSONL、WebSocket、Unix socket、health probe、auth 和 overload 错误。
- Handshake：`initialize`、`initialized`、capabilities 和 `experimentalApi`。
- Thread / turn / runtime：新增 method、notification、状态字段和错误码。
- Permission / approval / MCP：approval request、elicitation、tool call、auto-review 和 sandbox 语义。
- Schema：`codex app-server generate-ts`、`codex app-server generate-json-schema` 和仓库基线差异。

安全和远程访问相关 PR 必查：

- 不直接裸露 App Server transport 到公网。
- 远程访问优先使用 SSH、VPN、mesh network 或有鉴权的反向代理。
- App Server WebSocket auth、token file/hash、signed bearer token 和日志脱敏。
- sandbox / approval 默认值是否仍保留用户可见边界。

OpenAI API 补充能力相关 PR 必查：

- API key 只来自服务端环境变量或用户本机配置。
- 诊断接口只展示 provider、模型、生效 endpoint host/path、endpoint 配置/有效性布尔值、上传上限等脱敏信息；自定义 endpoint 只接受 `http` / `https` URL，非法配置必须回退默认官方 endpoint，不能展示原始非法 URL。
- Speech to text 请求体保持官方模型、响应格式和上传限制约束；普通转写模型使用 `json`，`gpt-4o-transcribe-diarize` 使用 `diarized_json` 并补齐 `chunking_strategy=auto`，默认上传上限按官方 25 MB 文件限制收紧。
- Responses API 是通用 agentic API，推荐用于新的通用 OpenAI 应用，但不替代 Codex App Server 的线程、审批、恢复、runtime 状态和事件协议。
- OpenAI API key、Responses state、Audio transcription 配置必须与 Codex App Server 认证分离；不能把 Platform API key 当作 Codex App Server token、WebSocket token 或远程访问凭据复用。

## 审查流程

1. 打开对应官方文档，确认页面仍存在且主题没有迁移。
2. 对 Codex App Server 变更，运行 `npm.cmd run audit:app-server-schemas`，把输出留在 `output/app-server-schema-audit/`，不要直接覆盖仓库基线。
3. 如果 schema 差异变化，更新 `docs/app-server-schema-audit-summary.json` 和 `docs/app-server-protocol-matrix.zh-CN.md`。
4. 如果安全边界变化，更新 `docs/security-hardening.zh-CN.md`、`SECURITY.md` 或 `SUPPORT.md`。
5. 如果 README、Release 或 GitHub 文案新增能力声明，确认能力在官方文档或本仓库验证证据中有来源。
6. 在 `tests.md` 记录本轮验证命令和结论。

## 当前审查结论

- 2026-07-05 02:12 复核：已注册 OpenAI Docs MCP server；当前线程重启前仍未热加载 MCP 工具，因此本轮复核继续使用官方 OpenAI 域名页面。Codex manual helper 返回 `local manual was already current`；官方 App Server 页面仍要求客户端先发 `initialize`，服务端返回后再发 `initialized`，`capabilities.experimentalApi` 仍是实验 API opt-in；WebSocket transport 仍标注为 experimental / unsupported，远程暴露前必须配置 WebSocket auth。官方 Speech to text guide 仍记录 25 MB 文件上传限制和 diarize 示例，Audio transcription API reference 仍记录 `gpt-4o-transcribe-diarize`、`diarized_json`、`chunking_strategy` 及 diarize 长音频的 chunking 要求。Responses migration guide 仍把 Responses API 推荐给新通用 OpenAI 项目，但其 `Items` / `output` 对象模型不同于 Codex App Server 的 thread / turn / runtime / approval 协议。
- 2026-07-05 00:37 复核：Codex manual helper 返回 `local manual was already current`；官方 App Server 页面仍要求先 `initialize` 再 `initialized`，并把 `experimentalApi` 作为实验方法/字段的显式 opt-in；官方 Speech to text 页面仍记录 `gpt-4o-transcribe-diarize` 使用 `diarized_json` 和 `chunking_strategy=auto`。
- App Server 官方文档仍是协议审计的主入口；`experimentalApi` 相关能力不能被宣传为默认稳定能力。
- Agent approvals & security 仍是 approval、sandbox、auto-review 和危险权限边界的主入口。
- Remote connections 仍明确远程连接应通过 SSH/受控网络边界，不应把 App Server transport 直接暴露到共享或公网网络。
- OpenAI Responses API 官方文档仍推荐其作为新通用 OpenAI 项目的统一接口，但本项目核心对象是 Codex rich-client App Server；只有独立、低权限的补充能力才进入 OpenAI API 路径。
- Speech to text 官方文档仍支持 `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` 的普通转写和 `gpt-4o-transcribe-diarize` + `response_format=diarized_json` + `chunking_strategy=auto` 的说话人区分路径；当前服务端 multipart 规范化策略保持有效。
- 当前仓库已有 schema drift 记录，不能直接声明已经对齐最新 App Server 协议；正式声明“完全对齐最新 App Server”前仍必须完成 schema 差异分组和兼容实现。
