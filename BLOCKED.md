# 当前待裁决与限制

更新时间：2026-08-04

## 现役阻塞

- 无代码、测试、构建或自动视觉取证阻塞。
- 首页阶段九候选样板尚未获得产品视觉确认；这是当前唯一会改变后续开发方向的待裁决项。确认前禁止铺到另外三页。

## 发布前待完成

- 隔离自动取证不能替代真实账本的数据安全验证。正式发布前仍需在用户明确授权的环境中完成 JSON 导出、恢复、关闭重开和真机冒烟。
- 首版尚无正式小程序主体和生产 AppID；当前 `wx9567fb4ff6336d0b` 是测试 ID，不得把自动取证数据写入其中。

## 已知但不阻塞

- Stable/automator 每个会话会发送五条固定形态的 `type:error, args:[{}]` 空对象协议事件。脚本原样记录并单列为 `protocolArtifacts`；当前应用 error、exception、timeout 和 runtimeErrors 均为 0。该事件的官方来源尚未确认，禁止扩大忽略规则。
- Computer Use 曾持续返回 NW.js 窗口归属错误。日常视觉验收已改用独立 CLI/automator 会话，因此它不再阻塞首页迭代；需要真实可见 UI 操作的发布冒烟仍可能受影响。
- 工作区包含多个阶段的未提交改动和证据，不能声称工作区干净，也不能在未审计范围时整批提交。

## 已解除

- 把 `touristappid` 错传给 `--auto-account` 导致的账号错误。
- 截图挂起后复用同一 runtime，令后续重试一起超时。
- 兼容性或关闭失败仍遗留 `ok:true`、旧 PNG、manifest 或 green 的假成功风险。
- 四态自动取证缺失；当前兼容探针和四态命令均已真实通过。

## 待用户确认的清理候选

以下对象目前只做只读盘点，未删除：

- `.codex-resume-exec.json`：一次性会话恢复残留，不属于产品或验收入口。
- `.visual-qa/`：自动取证生成的可重建项目副本；下次命令会重新创建，当前无需作为交付内容保留。
- `artifacts/phase9/03-home-saved-iphone12-13.png`、`05-home-saved-iphone5-320.png`：已被后续首页图替代。
- `artifacts/phase9/08-contract-red.txt`、`09-contract-green.txt`、`10-repair-red.txt`、`11-repair-green.txt`：阶段九中间红绿记录；若不需要保留开发历史可归档或删除。
- `artifacts/phase9/13-home-prepaid-iphone12-13.png`、`15-home-prepaid-iphone5-320.png`：已明确不是视觉终证的失败截图。

`artifacts/visual-evidence/lifecycle-red.txt` 与 `session-retry-red.txt` 是现役报警器的反向验证证据，不列入删除候选。
