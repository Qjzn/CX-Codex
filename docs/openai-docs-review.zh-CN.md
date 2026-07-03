# OpenAI 官方文档审查手册

本项目对接的是 OpenAI 官方 Codex App Server 和少量 OpenAI API 补充能力。任何协议、安全、远程访问、权限、语音转写或发布声明变更，都必须先确认官方文档入口和当前仓库基线是否一致。

最近审查时间：2026-07-04 Asia/Shanghai。

## 官方来源清单

优先审查这些官方入口：

- Codex App Server: <https://developers.openai.com/codex/app-server>
- Agent approvals & security: <https://developers.openai.com/codex/agent-approvals-security>
- Remote connections: <https://developers.openai.com/codex/remote-connections>
- Codex open source boundary: <https://developers.openai.com/codex/open-source>
- Codex access tokens: <https://developers.openai.com/codex/enterprise/access-tokens>
- OpenAI speech to text: <https://developers.openai.com/api/docs/guides/speech-to-text>

如果需要更完整的 Codex 产品上下文，先刷新官方 Codex manual，再只读取相关章节：

```powershell
node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs
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
- 诊断接口只展示 provider、模型、endpoint host/path、上传上限等脱敏信息。
- Speech to text 请求体保持官方模型和响应格式约束。
- OpenAI API 不替代 Codex App Server 的线程、审批、恢复和事件协议。

## 审查流程

1. 打开对应官方文档，确认页面仍存在且主题没有迁移。
2. 对 Codex App Server 变更，运行 `npm.cmd run audit:app-server-schemas`，把输出留在 `output/app-server-schema-audit/`，不要直接覆盖仓库基线。
3. 如果 schema 差异变化，更新 `docs/app-server-schema-audit-summary.json` 和 `docs/app-server-protocol-matrix.zh-CN.md`。
4. 如果安全边界变化，更新 `docs/security-hardening.zh-CN.md`、`SECURITY.md` 或 `SUPPORT.md`。
5. 如果 README、Release 或 GitHub 文案新增能力声明，确认能力在官方文档或本仓库验证证据中有来源。
6. 在 `tests.md` 记录本轮验证命令和结论。

## 当前审查结论

- App Server 官方文档仍是协议审计的主入口；`experimentalApi` 相关能力不能被宣传为默认稳定能力。
- Agent approvals & security 仍是 approval、sandbox、auto-review 和危险权限边界的主入口。
- Remote connections 仍明确远程连接应通过 SSH/受控网络边界，不应把 App Server transport 直接暴露到共享或公网网络。
- 当前仓库已有 schema drift 记录，正式声明“完全对齐最新 App Server”前仍必须完成 schema 差异分组和兼容实现。
