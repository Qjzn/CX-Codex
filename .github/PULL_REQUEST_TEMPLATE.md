## 变更说明

-

## 验证结果

- [ ] `npm run build`
- [ ] `npm run verify:release -- -SchemaAudit skip`（需 PowerShell 7 / `pwsh`）或说明未运行原因
- [ ] 如涉及 Android：已验证 `mobile:android:sync` 或 APK 构建
- [ ] 如涉及安装脚本：已说明目标系统和回滚方式
- [ ] 如涉及 UI：已附截图或说明移动端表现

## 隐私与安全

- [ ] 不包含密码、Token、Cookie、私有 IP、真实公网地址或个人目录
- [ ] 不写死个人配置、私人服务器地址或本地路径
- [ ] 新增远程访问能力时已说明安全边界
- [ ] 涉及 App Server transport、权限确认、语音转写代理或日志输出时，已对照 `docs/security-hardening.zh-CN.md`
