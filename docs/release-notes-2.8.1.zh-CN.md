# CX-Codex 2.8.1

本版扩展长对话阅读和当前任务的侧边工作区，并改进远程登录。以下内容描述本版源码的变化；安装与跨设备能力以实际发布验证结果为准。

## 主要变化

- 对话增加 Mermaid 图表渲染和图片访问处理，改进长内容的展示与附件读取边界。
- 当前任务新增侧边对话、终端及工作区入口，相关 App Server 请求与状态读取增加回归覆盖。
- 远程访问增加 tunnel 网页登录流程，并收紧认证及本地文件访问检查。
- 侧边终端的 WebSocket 连接增加同源校验。
- Android 壳补充服务地址配置和相应测试。

## 安装与升级

Windows 安装或升级使用仓库内的 `scripts/bootstrap-windows.ps1`；保留数据或完全卸载使用 `scripts/uninstall-windows.ps1`。升级前请保存现有安装与配置的备份。Android 请下载本 Release 提供的签名 APK，并核对随附的 SHA-256 文件。

首次安装可从仓库源码目录执行：

```powershell
./scripts/bootstrap-windows.ps1 -RemoteQuick -JsonOutput
```

## 验证范围

- Ubuntu CI 覆盖依赖安装、安全审计、完整 `verify:release`；Windows CI 覆盖安装、生成文件、产品化 smoke、占用文件原地升级和卸载清理。
- 正式发布工作流还要求干净 Git 状态、发布包与校验和、Android 固定证书签名，以及公开资产校验。具体通过状态以对应提交的 CI 与 Release 运行记录为准。
- 候选构建与正式发布资产的验证记录分别保存，不以本地构建结果代替公开资产验证。
- 本次发布不表示产品长期目标中的外部安全告警、特殊设备和系统级辅助功能门槛已经完成；这些项目继续按 `PRODUCT_GOAL.md` 记录。
