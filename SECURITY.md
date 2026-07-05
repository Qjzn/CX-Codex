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

如果你发现安全问题，请不要直接公开完整利用细节。建议：

1. 在 GitHub Issue 中只描述影响范围和复现条件，不贴敏感细节。
2. 如果必须提供私密信息，请先说明需要私下沟通。
3. 提交前先确认你使用的是最新版本。

## 维护原则

- 安全修复优先于新功能。
- 默认部署路径必须有密码或明确的访问边界提示。
- 新增远程访问方案必须说明风险、适用场景和关闭方式。
- 涉及 App Server transport、权限确认、语音转写代理、日志输出或远程访问的变更必须同步更新测试记录。
