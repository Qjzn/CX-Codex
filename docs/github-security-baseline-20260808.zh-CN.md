# GitHub 安全基线核验（2026-08-08）

## 结论

本次通过 GitHub App 与已认证 GitHub REST API 对 `Qjzn/CX-Codex` 做只读核验，没有修改仓库设置、告警状态、分支、Issue 或 Release。

仓库内安全默认值和 CI 已具备继续加固的基础，但 M1 外部治理门槛尚未满足：`main` 没有保护规则，Dependabot alerts / security updates 关闭，私密漏洞报告关闭，Code Scanning 没有分析结果，并有一条历史 Google API Key 告警仍处于 open。

## 当前事实

| 项目 | 2026-08-08 状态 | 证据与影响 |
| --- | --- | --- |
| 默认分支 | `main` | 仓库公开，当前账号具有 admin 权限。 |
| Branch protection | 未启用 | `branches/main/protection` 返回 `Branch not protected`，仓库 rulesets 为空；管理员可绕过 PR 与 CI 直接改写主分支。 |
| CI | 可用 | `CI / build` 与 `CI / windows-bootstrap-smoke` 是 PR 上的两个实际检查；最近一次 `main` CI run `31151290161` 成功。 |
| Dependabot version updates | 已配置 | `.github/dependabot.yml` 每周检查 npm 与 GitHub Actions。 |
| Dependabot alerts | 关闭 | Alerts API 返回 disabled，无法读取依赖安全告警。 |
| Dependabot security updates | 关闭 | 仓库 `security_and_analysis.dependabot_security_updates.status` 为 `disabled`。 |
| Secret scanning | 启用 | Secret scanning 与 push protection 均为 enabled。 |
| Secret scanning alert #1 | open | 类型为 Google API Key，位置是历史提交 `64fb01e` 的 `src/composables/useGithubSkillsSync.ts:30`。当前文件已不含该 39 字符值，移除发生在 `a289721`；历史仍可访问，删除源码不等于撤销凭据。本文不记录密钥原文。 |
| Private vulnerability reporting | 关闭 | API 返回 `enabled: false`，外部研究者目前没有仓库内私密报告入口。 |
| Code scanning | 无分析 | Code Scanning API 返回 `no analysis found`。 |

## 建议的最小外部设置

### 1. 先处置历史 Google API Key

1. 在对应 Google Cloud / Firebase 项目确认该 key 已禁用、轮换或按真实客户端来源和 API 范围严格限制。
2. 保存不含 key 原文的处置证据，例如 key 状态、限制类型、完成时间和负责人。
3. 只有确认真实状态后，才把 GitHub Secret Scanning alert #1 解析为 `revoked`、`false_positive` 或其他准确原因；不能仅因当前文件已删除就关闭。

### 2. 启用仓库安全入口

- 启用 Dependabot alerts。
- 启用 Dependabot security updates；保留现有每周版本更新配置，不自动合并 major 更新。
- 启用 Private vulnerability reporting，并把 `SECURITY.md` 的报告入口改为 GitHub 私密漏洞报告链接。

### 3. 保护 `main`

适合单维护者仓库的最小规则：

- Require a pull request before merging，批准数设为 `0`，避免单维护者无法自我批准。
- Require status checks to pass and require branches to be up to date。
- 必需检查使用实际 context：`build`、`windows-bootstrap-smoke`。
- Require conversation resolution。
- Include administrators / enforce admins，禁止管理员静默绕过。
- 禁止 force push 和 branch deletion。
- 不强制 linear history，保留仓库现有 merge commit 发布流。

## 执行边界

上述设置会改变 GitHub 远端治理或第三方凭据状态，不由本地代码回滚。启用前应由仓库管理员明确授权；Google key 的撤销或限制必须在对应云项目中完成。CX-Codex 可以继续推进不依赖这些外部设置的本地验证，但在四项外部状态被复核前，M1 不能标记为完成。

## 两小时浸泡完成后的复核

2026-08-08 09:28 +08:00 再次通过已认证 GitHub REST API 只读核验：`main` 仍返回 `Branch not protected`，仓库 ruleset 数为 0；Dependabot alerts 仍处于 disabled，security updates 为 disabled；私密漏洞报告仍为 `enabled: false`；Secret Scanning alert #1 仍为 `open` 且没有 resolution。Secret scanning 与 push protection 保持 enabled。此次复核没有修改仓库设置、告警、分支、Issue 或 Release。
