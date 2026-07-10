# 安全硬化清单

`CX-Codex` 把本机 Codex 能力接到浏览器、手机和远程入口。安全目标不是把它做成多租户 SaaS，而是让个人和小团队自托管时默认边界清晰、可诊断、可回滚。

参考的官方文档：

- Codex App Server: <https://developers.openai.com/codex/app-server>
- Agent approvals & security: <https://developers.openai.com/codex/agent-approvals-security>
- Remote connections: <https://developers.openai.com/codex/remote-connections>

## 默认边界

- 默认优先绑定本机或受控网络，公网入口必须有密码、反向代理鉴权、VPN、Tailscale、Cloudflare Access 或同等级访问控制。
- 不要用 `--no-password` 暴露到局域网、公网、隧道或反向代理之后。
- 如果使用 `--host 0.0.0.0`，必须同时确认防火墙、端口映射、访问密码和反代鉴权策略。
- Release、README、截图、Issue、日志示例不得包含真实 Token、Cookie、Authorization header、真实公网地址、私有 IP、个人目录或业务文件内容。

## Web 登录与请求体边界

- 本机免登录只适用于 TCP 对端和请求 Host 同时为回环地址的直连请求；`Host` 是客户端可控输入，不能单独作为本机来源证明。
- 通过 Nginx、Caddy、frp、Cloudflare Tunnel 或其他反向代理访问时，应保留外部 Host，并由 CX-Codex 密码或代理层鉴权保护；不要把所有代理请求重写成 `Host: localhost`。
- `/auth/login` 只接受受限 JSON 请求体，默认最大 16KiB，避免远程入口被超大登录请求消耗内存。
- 如确需调整登录请求体上限，可使用 `CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES`、`CODEXUI_AUTH_LOGIN_BODY_MAX_BYTES` 或 `AUTH_LOGIN_BODY_MAX_BYTES`；不要通过移除限制解决异常客户端问题。
- 登录失败、登录请求体超限和 JSON 格式错误必须返回可读错误，但不得回显提交的密码、Cookie 或 token。

## Codex App Server

- CX-Codex 应优先把 Codex App Server 当作本机控制面，不直接把 App Server transport 暴露给公网。
- `stdio` 是默认且更适合本机桥接的 transport。
- WebSocket transport 只适合 localhost、SSH port forwarding 或受控内网；如果必须远程使用，必须配置 App Server WebSocket auth。
- App Server WebSocket token 应使用文件或本地 secret store 管理，避免把原始 bearer token 放在命令行、日志、Issue 或 Release 文档中。
- 协议变更必须通过 schema audit、`docs/app-server-protocol-matrix.zh-CN.md` 或 Issue 里的最小脱敏 payload 复核，不能只靠前端表现推断。

## Codex 执行权限

- 不在 CX-Codex 中绕过 Codex 自身 sandbox 和 approval 语义。
- 当前 app-server 子进程启动策略集中在 `src/server/appServerLaunch.ts`；该模块显式标识 legacy high-trust 默认值，并只接受官方常见 approval/sandbox 枚举值。任何默认 approval/sandbox 行为调整都必须先更新该模块、测试记录和发版说明。
- 需要更保守的本机策略时，可通过 `CX_CODEX_APP_SERVER_APPROVAL_POLICY=on-request` 和 `CX_CODEX_APP_SERVER_SANDBOX_MODE=workspace-write` 覆盖；非法值会回退到默认策略。
- Health、diagnostics 和诊断页只能展示有效 approval/sandbox 策略及 high-trust 标记，不展示原始环境变量值。
- 新增工具权限、MCP、命令执行或自动确认能力时，默认应保持显式用户确认或可见的权限边界。
- 不要为了解决一次交互阻塞而默认开启危险权限、全局 allow-all 或自动批准所有命令。
- 权限相关 UI 必须能让用户区分只读、写文件、联网、执行命令和外部工具调用。

## OpenAI API Key 与语音转写

- 官方语音转写只从环境变量或用户本机配置读取 API key，不写入前端包、截图、日志或 Issue。
- `/codex-api/health`、`/codex-api/diagnostics` 和诊断页只能展示 provider、模型、上传上限、endpoint host/path 等脱敏配置；不得展示 API key、Authorization header、Cookie 或 URL query。
- 转写上传保持服务端大小限制，避免把超大请求继续代理到上游。
- 未配置官方 API key 时可以回退到既有 Codex / ChatGPT 登录态代理，但不得记录或暴露登录态凭据。

## 远程访问

- 优先推荐 VPN、Tailscale、SSH forwarding、Cloudflare Access 或带鉴权的反向代理。
- Cloudflare Tunnel、frp、Nginx、Caddy 等入口必须说明关闭方式、鉴权方式和风险边界。
- 公网访问问题排查时，先分别验证本机 `/health`、`/codex-api/health` 和外部入口，避免把网络层问题误判成 Codex 协议问题。

## 贡献与发版检查

每个涉及安全边界、远程访问、App Server transport、权限确认、转写代理或日志输出的 PR，都应检查：

1. 是否引入新的凭据存储、命令行参数、日志字段或截图泄露面。
2. 是否改变默认绑定地址、默认密码、`--no-password`、隧道、反向代理或 App Server transport 行为。
3. 是否保留 Codex sandbox / approval 的用户可见边界。
4. 是否更新 `SECURITY.md`、`SUPPORT.md`、`RELEASE.md` 或相关部署文档。
5. 是否在 `tests.md` 记录验证步骤和实际命令结果。
6. 是否运行 `npm run verify:release -- -SchemaAudit skip`；正式发版前是否运行 schema audit 的 `warn` 或 `strict` 模式。

## 事故处理

- 如果发现凭据、真实公网入口或私人路径已进入 Issue、Release、截图或日志，应先删除公开内容，再轮换对应凭据。
- 如果默认远程访问策略存在风险，应优先发布安全修复和升级说明，而不是等待下一个功能版本。
- 安全问题优先走 `SECURITY.md` 中的报告路径，不要在公开 Issue 里贴完整利用细节。
