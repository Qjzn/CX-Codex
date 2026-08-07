# CX-Codex 2.7.6：会话执行更稳，长任务页面保持可操作

2.7.6 是聊天稳定性补丁版，修复 2.7.5 仍可能出现的重复消息与执行中页面卡顿，并收敛 GitHub Releases 的公开版本数量。升级后不需要清理会话、浏览器缓存或 Android 应用数据。

## 重复消息与流式执行

- 会话消息投影始终使用独立数组。没有待发送气泡时，新的流式消息也不会再被写回持久历史，避免一条消息变成两条或触发响应式更新循环。
- 外部 Codex 桌面任务持续写入时，7420 优先读取最近会话的有界增量；只有最新助手消息已经最终完成且没有运行、排队或待确认信号，才做一次权威完整历史收敛。
- 文本增量不再反复清理消息结构缓存、测量全部高度或恢复滚动位置。用户阅读历史时仍保留原位置，位于底部时继续跟随最新输出。
- 已连接的空闲页面不会仅因暂时没有通知就重建连接；真正断线、正在执行或仍有待同步内容时，恢复路径保持不变。

## 手机端响应与页面体验

- 生产压力场景在 393 × 852 视口加载 1602 条消息并每 48ms 更新回复，只挂载 12–13 个可见消息节点；最大事件循环延迟 64ms，执行中按钮仍可立即响应。
- 独立 headless Playwright 复核得到最大延迟 47ms，点击后流式更新继续增长，页面无横向溢出、控制台错误或失败请求。
- GitHub 热门页改为紧凑筛选栏和手机双列卡片；默认只展示摘要，展开后再显示完整介绍与仓库地址。

## 安装与升级

Windows 一条命令安装或升级：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

需要卸载程序时使用官方入口；默认保留可恢复的用户配置，只有显式选择清理数据时才删除：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

Android 请从 [GitHub 最新 Release](https://github.com/Qjzn/CX-Codex/releases/latest) 下载 `cx-codex-android-v2.7.6.apk`。正式 APK 沿用 2.5.9 之后的固定发布证书，可覆盖升级并保留服务地址与设置。

## 发行版整理

- GitHub Releases 只保留当前稳定版、一个可靠回滚版，以及每条历史版本线最后一个发布门禁全绿的归档版本。
- 中间补丁、已撤回版本和发布门禁失败版本会从 Releases 页面移除，避免新人误装；Git 标签与提交历史不会删除，仍可审计和比对源码。
- 具体保留规则和版本清单见 [发行版保留策略](./release-retention.zh-CN.md)。

## 验证与边界

- 前端 normalizer、生产前端、CLI、服务模块和完整 38 场景前端回归通过；完整回归耗时 499.7 秒。
- 会话压力场景、消息投影不可变性、前台通知流恢复策略和外部会话最终阶段判断均有确定性回归。
- 正式稳定身份仍以主分支 CI、Release 工作流、公开 ZIP/APK、SHA-256、固定 Android 签名和公开下载复核全部通过为准。
- 浏览器与 Playwright 不能代替 Android 真机深度 Doze/进程回收验收；FCM 深度 Doze 能力仍按 issue #28 单独跟踪。

标签发布前，本版仍属于候选版本。只有主分支 CI、Release 工作流、公开 ZIP/APK、SHA-256、固定 Android 签名和公网 Windows 全新安装全部通过后，才视为正式稳定版本。
