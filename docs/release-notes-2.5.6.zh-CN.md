# CX-Codex 2.5.6：手机扫码配对与更完整的稳定性门禁

2.5.6 聚焦新人第一次从电脑连接手机的实际步骤：手机访问入口现在更容易找到，本机配对页可以直接扫码打开临时地址。同时，长时浸泡测试开始持续核对消息事件回放和公网鉴权，避免服务看似健康但消息接收或访问边界已经退化。

## 本版变化

- 设置中的“手机访问”移动到基础设置之后，不再需要先滚过套餐余量和权限控制。
- 仅限本机的 `/local-setup` 配对页新增二维码，手机相机可直接打开当前已验证的临时地址。
- 二维码只包含公网地址，不包含访问密码；在本机生成，不请求第三方二维码服务。
- 配对页继续使用 `no-store` 和禁止脚本的 CSP，通过公网 Host 访问仍返回 404。
- 长时稳定性浸泡逐样本验证事件回放结构、`latestSeq` 单调性，以及公网未登录 Codex API 始终返回 HTTP 401。
- 浸泡报告新增回放失败、鉴权失败和事件序号倒退汇总，便于区分服务健康、消息接收与公网安全问题。

## 安装或升级

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

同一条命令可用于首次安装、升级和修复。它会选择最新正式 Release、校验 SHA-256，并保留用户配置、Codex 登录态和工作区。

安装完成后，在电脑本机打开：

```text
http://127.0.0.1:7420/local-setup
```

用手机相机扫描二维码，再输入页面单独显示的访问密码。不要截图或转发密码。

## 卸载

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

默认卸载会停止 CX-Codex 和对应临时通道，删除程序与启动器，同时保留运行数据、Codex 登录态、工作区、Android 签名和已校验的 cloudflared 缓存。

## 验证

- Linux 构建与 Windows bootstrap smoke 均通过。
- 本机配对页在 393 × 852 下无横向溢出，二维码宽度为 220px。
- 从真实页面截图解码二维码，结果与服务端当前 `publicUrl` 完全一致。
- 真实 Quick Tunnel 通过公网健康、未登录 HTTP 401、未登录 WebSocket 拒绝、配对页公网 404 和停止清理，残留 cloudflared 数量为 0。
- 7420 前端 21 个表面回归通过，覆盖主页、手机抽屉、折叠屏、输入框、消息尾部、恢复与任务状态。
- 完整 Release 验证通过构建、服务模块、CLI、Release 归档和 npm package smoke。

## 边界

Quick Tunnel 免费、免注册且不需要自有服务器，但地址临时、没有 SLA，也不支持 SSE；CX-Codex 会使用 WebSocket 和轮询恢复链路。二维码不会把密码写入 URL，因此扫码后仍需手动输入密码。

本版没有扩大对最新 Codex App Server 能力的公开承诺。当前 schema audit 仍记录上游漂移，协议能力继续以仓库兼容矩阵和 candidate review 为准。

正式标签发布前，本版仍按候选版本审查；只有 Release 工作流、公开资产校验和正式归档安装回归全部完成后，才视为正式可交付版本。
