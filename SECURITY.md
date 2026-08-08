# 安全策略

`CX-Codex` 会把本机 Codex 能力暴露到浏览器，因此部署时必须注意访问边界。

## 支持版本

当前只维护最新 Release 版本线。请优先升级到 [最新 Release](https://github.com/Qjzn/CX-Codex/releases/latest) 后再反馈安全问题。

## 安全边界

- 不要把服务无密码暴露到公网。
- 公网访问建议放在 Cloudflare Tunnel、Tailscale、VPN、反向代理鉴权或其他受控入口之后。
- Codex App Server transport 不应直接裸露到公网；官方 WebSocket transport 仍是 experimental / unsupported，若必须使用，必须配置官方支持的 WebSocket auth 或受控内网/SSH/VPN 边界。
- CX-Codex 不应绕过 Codex sandbox / approval 语义；权限确认、工具调用和远程访问能力必须保持用户可见边界。
- 不要在 Issue、日志或截图里泄露密码、Token、Cookie、私有 IP、个人目录和业务文件内容。
- 如果使用 `--host 0.0.0.0`，请确认防火墙、端口映射和访问密码符合预期。
- 本项目不会要求你在 Issue 中提供 OpenAI、GitHub 或系统账号密码。

更细的维护者检查清单见 [docs/security-hardening.zh-CN.md](./docs/security-hardening.zh-CN.md)。

## 报告安全问题

如果你发现安全问题，请不要直接公开利用细节、凭据或复现数据：

1. 优先使用仓库 Security 页的 **Report a vulnerability** 私密报告入口（该入口由 GitHub 仓库设置控制）。
2. 如果私密入口暂不可用，只能在公开 Issue 中请求维护者提供私密渠道；不要写漏洞细节、受影响路径、凭据或可直接利用的复现步骤。
3. 提交前先确认你使用的是最新版本，并在私密报告中说明受影响版本和最小复现条件。

## 维护原则

- 安全修复优先于新功能。
- 默认部署路径必须有密码或明确的访问边界提示。
- 新增远程访问方案必须说明风险、适用场景和关闭方式。
- 涉及 App Server transport、权限确认、语音转写代理、日志输出或远程访问的变更必须同步更新测试记录。
- CI 与正式发版必须运行 `npm run verify:dependency-security`；该命令使用 npm 9+ 和官方 npm registry 审计完整锁文件，发现任意等级漏洞或无法获得有效审计结果时失败。
- 本地 PDF 预览只使用 PDF.js legacy display/canvas 管线，不接入 annotation scripting manager；独立预览页同时使用响应头与 HTML meta CSP 限制脚本来源。
