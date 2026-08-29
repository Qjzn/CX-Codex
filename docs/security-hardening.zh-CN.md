# 安全硬化清单

`CX-Codex` 把本机 Codex 能力接到浏览器、手机和远程入口。安全目标不是把它做成多租户 SaaS，而是让个人和小团队自托管时默认边界清晰、可诊断、可回滚。

参考的官方文档：

- Codex App Server: <https://developers.openai.com/codex/app-server>
- Agent approvals & security: <https://developers.openai.com/codex/agent-approvals-security>
- Remote connections: <https://developers.openai.com/codex/remote-connections>

## 默认边界

- 默认优先绑定本机或受控网络，公网入口必须有密码、反向代理鉴权、VPN、Tailscale、Cloudflare Access 或同等级访问控制。
- CLI 只允许在明确的 localhost / 回环地址上使用 `--no-password`；`0.0.0.0`、`::`、局域网地址和其他主机名会在监听前被拒绝。回环地址后方如接入反向代理，代理层仍必须配置鉴权。
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
- 当前 app-server 子进程启动策略集中在 `src/server/appServerLaunch.ts`；默认使用 `on-request` 与 `workspace-write`，只接受官方常见 approval/sandbox 枚举值，非法值回退到安全默认策略。任何默认行为调整都必须同步更新该模块、测试记录和发版说明。
- `never` 与 `danger-full-access` 仅作为显式 legacy high-trust 兼容选择保留。需要时通过 `CX_CODEX_APP_SERVER_APPROVAL_POLICY=never` 和 `CX_CODEX_APP_SERVER_SANDBOX_MODE=danger-full-access` 同时选择，并确保服务只暴露在受控环境。
- Health、diagnostics 和诊断页只能展示有效 approval/sandbox 策略及 high-trust 标记，不展示原始环境变量值。
- 新增工具权限、MCP、命令执行或自动确认能力时，默认应保持显式用户确认或可见的权限边界。
- 不要为了解决一次交互阻塞而默认开启危险权限、全局 allow-all 或自动批准所有命令。
- 权限相关 UI 必须能让用户区分只读、写文件、联网、执行命令和外部工具调用。

## 本地文件边界

- `/codex-local-image`、`/codex-local-file`、`/codex-local-browse` 和 `/codex-local-edit` 只允许访问 Codex 全局状态中已登记的工作区根目录；没有工作区根时默认拒绝，不回退到用户目录或全磁盘。
- 路径授权必须同时检查规范化路径和文件系统真实路径。相邻同名前缀目录、`..`、符号链接与 Windows junction 都不能越过已登记根目录。
- 工作区根目录内的隐藏文件可以按原有能力读取或编辑；根目录外路径统一返回 `403`，不存在的工作区内路径返回 `404`。
- 编辑接口继续只接受已有的文本类文件并保持请求体上限。新增本地文件入口时必须复用 `src/server/localFileAccessPolicy.ts`，不能只做绝对路径检查。

## OpenAI API Key 与语音转写

- 官方语音转写只从环境变量或用户本机配置读取 API key，不写入前端包、截图、日志或 Issue。
- `/codex-api/health`、`/codex-api/diagnostics` 和诊断页只能展示 provider、模型、上传上限、endpoint host/path 等脱敏配置；不得展示 API key、Authorization header、Cookie 或 URL query。
- 所有详细健康与诊断对象在响应发送前统一递归脱敏。上游错误或扩展诊断即使意外带入 password、Authorization、Cookie、secret、API key 或 access/auth/refresh token 字段，也只能显示 `[REDACTED]`；Runtime payload 和待审批参数继续不得进入诊断响应。
- 转写上传保持服务端大小限制，避免把超大请求继续代理到上游。
- 未配置官方 API key 时可以回退到既有 Codex / ChatGPT 登录态代理，但不得记录或暴露登录态凭据。

## 远程访问

- 优先推荐 VPN、Tailscale、SSH forwarding、Cloudflare Access 或带鉴权的反向代理。
- Cloudflare Tunnel、frp、Nginx、Caddy 等入口必须说明关闭方式、鉴权方式和风险边界。
- 公网访问问题排查时，先分别验证本机 `/health`、`/codex-api/health` 和外部入口，避免把网络层问题误判成 Codex 协议问题。

## 依赖供应链与本地预览

- CI 和正式 Release workflow 在安装锁定依赖后运行 `npm run verify:dependency-security`。脚本要求 npm 9 或更高版本，固定使用 `https://registry.npmjs.org`，并以 `low` 为失败阈值审计生产与开发依赖；旧 npm、无有效审计响应或任意等级漏洞都不能被误报为通过。
- 本地 PDF 预览固定使用 `pdfjs-dist/legacy/build/pdf.mjs` 与对应 worker，只把页面渲染到 Canvas，不导入 `pdf_viewer`、`AnnotationLayer` 或 `PDFScriptingManager`。
- `local-preview.html` 使用 `script-src 'self'`、`object-src 'none'` 等 CSP；7420 静态响应再发送同源脚本、独立 worker、无对象嵌入和禁止 framing 的 CSP header。未来如果需要表单、注释或 PDF 内脚本，必须作为新的高风险能力独立评审，不能通过放宽现有策略顺带接入。

## 贡献与发版检查

每个涉及安全边界、远程访问、App Server transport、权限确认、转写代理或日志输出的 PR，都应检查：

1. 是否引入新的凭据存储、命令行参数、日志字段或截图泄露面。
2. 是否改变默认绑定地址、默认密码、`--no-password`、隧道、反向代理或 App Server transport 行为。
3. 是否保留 Codex sandbox / approval 的用户可见边界。
4. 是否更新 `SECURITY.md`、`SUPPORT.md`、`RELEASE.md` 或相关部署文档。
5. 是否在 `tests.md` 记录验证步骤和实际命令结果。
6. 是否运行 `npm run verify:dependency-security` 与 `npm run verify:release -- -SchemaAudit skip`；正式发版前是否运行 schema audit 的 `warn` 或 `strict` 模式。

GitHub 仓库设置、历史 Secret Scanning 告警和建议保护规则的最近只读核验见 [GitHub 安全基线核验](./github-security-baseline-20260808.zh-CN.md)。

## 事故处理

- 如果发现凭据、真实公网入口或私人路径已进入 Issue、Release、截图或日志，应先删除公开内容，再轮换对应凭据。
- 如果默认远程访问策略存在风险，应优先发布安全修复和升级说明，而不是等待下一个功能版本。
- 安全问题优先走 `SECURITY.md` 中的报告路径，不要在公开 Issue 里贴完整利用细节。
