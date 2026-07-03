# 贡献指南

感谢愿意改进 `CX-Codex`。这个项目优先解决真实使用问题：部署简单、手机可用、会话稳定、交互清晰。

参与 Issue、PR、讨论和文档协作前，请先阅读并遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 适合贡献的内容

- 修复明确可复现的 Bug
- 改进 Windows / Windows Server / Linux 部署体验
- 优化手机端和长会话性能
- 改进会话同步、断线恢复、图片和本地文件展示
- 补充文档、截图、安装说明和故障排查
- 增加不依赖私人服务的通用部署方案

## 不建议直接提交的内容

- 写死个人账号、密码、Token、Cookie 或私有 IP
- 只适用于单台机器的特殊路径
- 未说明风险的大范围重构
- 删除现有部署脚本或破坏一条命令安装体验
- 默认打开公网暴露能力但没有密码、安全提示或显式说明

## 本地开发

```powershell
npm ci
npm run build
```

常用验证：

```powershell
npm run build:frontend
npm run build:cli
```

Windows 安装脚本 smoke：

```powershell
.\scripts\bootstrap-windows.ps1 `
  -SourceRepoRoot $PWD `
  -InstallDir "$env:TEMP\cx-codex-smoke-install" `
  -WorkspacePath "$env:TEMP\CodexWorkspace" `
  -Port 7441 `
  -Password "ci-password" `
  -SkipStartupTask `
  -SkipFirewall `
  -SkipLogin `
  -NoStart
```

## Pull Request 要求

- 描述问题、解决方案和验证结果
- UI 改动请附截图或录屏
- 部署脚本改动请说明目标系统和回滚方式
- Codex App Server 兼容改动请说明参考的官方文档、Codex CLI/App 版本、受影响 method / event，以及是否更新了 schema audit 或 `tests.md`
- 依赖更新优先通过 `.github/dependabot.yml` 生成的 PR 处理；人工升级依赖时请说明范围、风险和验证命令
- 文档默认使用中文，必要时补英文摘要
- 不要提交本地日志、截图里的隐私内容或个人配置

## 版本节奏

版本标签使用普通语义化版本：

```text
2.2.2
2.3.0
```

详细发版流程见 [RELEASE.md](./RELEASE.md)。
