# 平台兼容与 Slash Command 支持

本文说明 `CX-Codex` 在 Windows、Linux、WSL2 和 Android 上的支持边界，以及与 Codex CLI slash command 的对应关系。

## 平台支持矩阵

| 平台 | 当前状态 | 说明 |
| --- | --- | --- |
| Windows / Windows Server | 重点支持 | 一键安装、固定端口、后台常驻、Android 访问和 Release 包都优先覆盖 Windows。 |
| Android | 重点支持 | Android 壳连接你自己的 CX-Codex Web 服务，支持连接地址保存、访问密钥保存、恢复补同步、文件打开和下载。 |
| Linux | 可运行，需自行验证环境 | Web 服务是 Node.js 应用；只要 Linux 内的 Codex CLI / app-server 可正常运行，就可以启动 CX-Codex。 |
| WSL2 | 可运行，注意网络和路径 | 适合在 Windows 上用 WSL2 运行 Codex CLI，但需要处理 WSL2 IP、端口暴露、防火墙和文件路径差异。 |
| macOS | 理论可运行，当前非主验证路径 | 项目没有绑定 Windows API，但当前文档、脚本和回归重点还在 Windows / Android。 |

## WSL2 部署注意事项

如果在 Windows 的 WSL2 中运行 CX-Codex，请先确认 Codex CLI 在 WSL2 内可以正常登录和启动。

建议启动方式：

```bash
npm ci
npm run build
node dist-cli/index.js --host 0.0.0.0 --port 7420 --no-tunnel --password "change-me"
```

需要注意：

- `--host 0.0.0.0` 用于让 Windows 主机和局域网设备有机会访问该服务。
- Windows 访问 WSL2 服务时，可能需要查看 WSL2 IP，或配置端口转发。
- Windows 防火墙、路由器隔离、公司网络策略都可能阻止 Android 访问 WSL2 端口。
- 本地文件浏览读取的是“运行 CX-Codex 后端的环境”。服务跑在 WSL2 时，默认看到的是 WSL 文件系统。
- Windows 盘符路径需要通过 WSL 挂载路径访问，例如 `/mnt/c/Users/...`。
- Android 文件预览、打开和下载依赖后端能读取对应文件；如果路径在 Windows 主机但服务在 WSL2，需要使用 WSL2 可见路径。

## Slash Command 支持程度

CX-Codex 不只是终端文本代理，而是通过 Codex app-server / RPC 与本机 Codex 交互。因此部分 slash command 被做成了更稳定的 UI 控件或结构化参数。

| 能力 | 当前支持方式 | 说明 |
| --- | --- | --- |
| `/model` | 输入区运行配置按钮 | 可切换模型、质量和速度。 |
| `/skill` | 技能按钮、技能选择器、技能中心 | 发送消息时会把选中的 skill 作为结构化 input 传给 Codex。 |
| 计划模式 | 输入区执行/计划切换 | 计划模式会作为 collaboration mode 传递，并在后端做权限兜底。 |
| 图片输入 | 输入区附件 | 图片会作为结构化输入发送。 |
| 文件引用 | 本地文件链接和文件附件 | 支持本地文件预览、打开、下载和复制路径。 |
| 工具权限 | 权限卡片和设置 | MCP / 命令 / 文件修改等请求通过 Web UI 确认。 |
| 未映射 slash command | 暂不保证 1:1 支持 | 可能会作为普通文本发送，是否生效取决于当前 Codex app-server 的处理。 |

当前还没有完整实现 Codex CLI 的所有 slash command 1:1 解析表。后续会继续补齐：

- slash command 兼容表
- 每个命令对应的 Web UI 入口
- 暂未支持命令的替代操作
- Android 小屏下的操作截图

## 截图和文档入口

常用截图已经放在 README 的“当前界面”区域，包括：

- 手机端脱敏会话
- 折叠屏 / 平板 GitHub 热门
- 桌面工作台
- 手机端附件和运行设置
- Android 首次连接
- GitHub 热门项目模块

这些图片由 `/#/__regression/docs-showcase` 使用当前组件和虚构数据生成，不读取真实账号、会话、个人路径或服务地址。

更多部署说明请看：

- [Android 壳说明](./android-shell.zh-CN.md)
- [Cloudflare Tunnel 远程访问](./cloudflare-tunnel.zh-CN.md)
- [Windows Server 常驻](./windows-server.md)
