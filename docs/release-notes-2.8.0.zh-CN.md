# CX-Codex 2.8.0

本版本聚焦对话可读性、侧栏效率、附件展示和移动端任务接续。

## 主要改进

- 侧栏快捷操作收敛为侧栏开关、全部已读、新会话、搜索、技能和 GitHub；移除工作台与诊断前端页面。
- Markdown 标题、列表、引用、代码和表格按语义排版，不再显示原始 `###` 与 `-` 标记。
- 附件消息只展示真实问题和附件卡片，隐藏宿主传输信封及本地路径清单。
- Android 前后台恢复与任务状态同步更稳定，完成通知可返回对应会话。
- 加强消息幂等、队列、outbox、7420 重启恢复和安全默认值。

## 安装与升级

Windows 可使用以下命令安装或升级：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

Android 请下载本 Release 提供的签名 APK。Release 同时提供校验文件，便于核对 SHA-256。

需要卸载时运行 `scripts/uninstall-windows.ps1`；默认保留配置和认证，升级失败会恢复上一份健康安装。

## 验收边界

发布候选已通过本地 Release 门禁、Web 回归、签名 APK 安装与 OPPO Android 主链路验证。维护者已接受尚未完成的外部设备与系统级验收风险；这些项目不属于本版本已验证声明，也不代表产品长期目标已经完成。
