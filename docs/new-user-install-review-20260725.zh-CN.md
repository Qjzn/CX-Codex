# Windows 新人安装实测与改进建议（2026-07-25）

## 结论

从没有 CX-Codex 运行环境的 Windows 状态出发，按 README 的一行命令已经能够完成安装、构建、启动、免费临时公网访问、密码登录、发送消息和接收回复。

最终成功用时 153.5 秒。功能链路可用，但还不能称为真正“傻瓜式”：安装过程缺少进度反馈，正式 Release 尚未包含新功能，没有官方卸载入口，首次工作区选择也不够明确。

## 测试边界

清理并确认不存在：

- `%LOCALAPPDATA%\CX-Codex`
- `%USERPROFILE%\.cx-codex`
- `%USERPROFILE%\.local\bin\cx-codex-start.cmd`
- CX-Codex 安装的 `cloudflared*.exe`
- 7420 监听进程和健康端点
- 旧的 `FRP frpc 7420` 定时任务及其 7420 专属配置

保留：

- 源码仓库
- `%USERPROFILE%\.codex` 登录态
- Android 签名材料
- 用户工作区
- 不属于 7420 映射的 FRP 程序文件

## 新人实际步骤

1. 在普通 PowerShell 中执行 README 命令：

   ```powershell
   & ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -UseBranchArchive -RemoteQuick -JsonOutput
   ```

2. 等待源码下载、依赖安装、前端/CLI 构建和 cloudflared 下载。
3. 本机打开 `http://127.0.0.1:7420/local-setup`，只在本机查看访问密码。
4. 手机打开安装结果中的临时 HTTPS 地址并输入密码。
5. 浏览器中新建或选择工作区，本次选择 `CodexWorkspace`。
6. 发送一条测试消息并等待回复。
7. 不再需要手机入口时，在设置的“手机访问”卡片中停止临时地址；退出 CX-Codex 后地址也会失效。

文档和提交记录中不保存本次临时公网地址、访问密码、Cookie 或私人会话内容。

## 最终验证结果

| 项目 | 结果 |
| --- | --- |
| 本机 `/health` | 200 |
| Quick Tunnel 状态 | `ready` |
| 公网健康验证 | 通过 |
| 未登录公网 API | 401 |
| 未登录 WebSocket | 拒绝连接 |
| 公网 `/local-setup` | 404 |
| 密码登录 | 200 |
| 登录后 API | 200 |
| HTTPS Session Cookie | `Secure` |
| 浏览器发送 | 已发送 |
| 浏览器接收 | 收到“新人安装验证成功” |
| 实时连接 | 正常 |

## 实测发现并已经修复

1. 某些 Windows `npm.cmd --version` 会同时输出代码页提示和版本号，旧逻辑把多行数组直接转换为版本对象而失败。现在只提取合法语义版本行。
2. npm 启动脚本会受全局 prefix 影响，即使使用便携 Node.js，也可能跳转到旧 NVM 目录中的 npm 6。现在由选定的 `node.exe` 直接执行随包 `npm-cli.js`。
3. 显式 Node.js 路径接入后，启动器、登录检查和 watchdog 仍引用旧变量，曾生成以 `""` 开头的无效启动命令。变量引用已统一，Windows CI 增加启动器内容断言。
4. 本机健康失败后仍等待 150 秒公网地址。现在本机启动失败会立即跳过隧道等待。
5. 全新安装失败只删除项目目录，曾残留运行状态、启动器和 cloudflared。现在只清理本次新建的文件，安装前已有内容不动。
6. GitHub Actions 的 PowerShell 冷启动偶发超过 5 秒。探测超时调整为 15 秒，减少无业务原因的 CI 波动。

## 槽点

### P0：正式发布一致性

- 最新正式 Release 仍是 `2.4.1`，不包含 `-RemoteQuick`。
- README 暂时必须使用 `-UseBranchArchive`，源码归档没有 Release SHA-256 保证。
- Raw 文件在连续推送后的短时间内可能命中旧缓存，bootstrap 与源码归档存在短暂版本错位风险。

### P1：安装体验

- 冷安装约 2.5 分钟，cloudflared 下载期间可连续几十秒没有输出。
- `-JsonOutput` 之前仍有构建日志和提示，不能直接作为稳定的机器接口消费。
- npm/Vite 输出较多，新人难以判断“正常构建”还是“安装失败”。
- 没有下载百分比、剩余时间、镜像切换、断点续传或明确的重试按钮。
- 安装后虽然生成 `CodexWorkspace`，已有 Codex 项目的用户仍可能默认停留在上次项目，需要手动切换。

### P1：日常使用

- 临时地址会变化，无 SLA，退出进程后失效。
- 安全模式默认不创建自启动任务；重启电脑后需要重新启动并获得新地址。
- 需要先在本机打开配对页，再到手机输入地址和密码；还没有二维码配对闭环。
- 缺少官方一键卸载命令，用户难以判断哪些运行数据、登录态和工作区应该保留。

### P2：可维护性

- Windows bootstrap、安装器、CLI 各自承担部分运行时和隧道逻辑，端到端组合测试仍偏少。
- GitHub Dependabot 未启用，Code Scanning 没有分析结果。
- 前端构建存在大于 500 kB 的 chunk 警告，影响首次打开速度。

## 优化为“傻瓜式”的建议

### 第一阶段：发布即可用

1. 发布包含本次功能的新 Release，并让 README 默认命令恢复 Release + SHA-256 链路。
2. bootstrap 读取同版本能力清单，确认归档支持 `RemoteQuick`、`JsonOutput` 和所需安装器版本，拒绝混用。
3. 规定 stdout 最终只输出一行稳定 JSON；进度和诊断写入 stderr，提供固定错误码。
4. 增加官方 `uninstall-windows.ps1`，默认保留 Codex 登录态、工作区和 Android 签名，可选清除运行数据库与托管 cloudflared。
5. Windows CI 增加真正的 `StartNow` 健康检查，而不只验证文件生成。

### 第二阶段：首次引导

1. 安装完成自动打开本机引导页，按“Codex 登录 → 选择工作区 → 本机健康 → 手机访问”显示四步状态。
2. 配对页同时显示二维码、可复制地址、可复制密码、有效期和停止按钮。
3. 首次消息提供“发送测试消息”按钮，自动验证发送、实时进度、回复和断线恢复。
4. 明确提供“安全临时访问”和“长期固定访问”两个模式，后者引导 Tailscale 或命名 Cloudflare Tunnel。

### 第三阶段：真正面向普通用户

1. 提供签名的 Windows 安装包，安装、更新、修复、启动和卸载统一到一个界面。
2. 增加下载缓存、校验后复用、失败重试、代理设置和可选镜像。
3. 使用当前用户级后台服务管理进程，不要求管理员权限；在界面中清晰控制开机启动。
4. 为安装器、服务、隧道和聊天发送/接收建立一条 Windows 端到端发布门禁。

## 建议的最终用户体验

理想情况下，新人只需要：

1. 下载并运行官方签名安装包。
2. 登录 Codex 或复用已有登录。
3. 选择一个工作区。
4. 扫描二维码。
5. 发送第一条消息。

其余 Node.js、npm、构建、端口、隧道、密码、升级和进程管理都应由安装器完成，并在失败时给出可复制的错误码和“一键修复”。
