# 当前待裁决与限制

更新时间：2026-08-12

## 阶段二十一阻塞（已解除，2026-08-12）

- 修复前全量 `npm test` 实测：500 tests、497 pass、3 fail、0 cancelled、0 skipped、0 todo；失败均在只读 `tests/transaction-corrections.test.js` 的第 473、484、658 行。
- 根因是三个 `freshLedger()` 夹具生成了缺少 settlement 的关闭 p0；严格 v3 校验拒绝该非法状态是正确行为。
- 本轮仅修正测试夹具的合法 v3 settlement 与生命周期，未放宽、绕过或修改生产校验；此前 497/500 明确保留为修复前事实。
- 修复后实测：`tests/transaction-corrections.test.js` 为 46/46，`npm test` 为 500/500，失败/取消/跳过/todo 均为 0。
- `npm run check` 通过 499 条声明，`npm run check:mini` 与 `git diff --check` 均退出 0；阶段二十一该阻塞已解除。
- 本轮无新增阻塞。

## 阶段二十当前限制（2026-08-12）

- 本轮未发现需要用户裁决的阻塞项；生成包、全量门禁和白名单核对均已完成。
- 不使用真实 AppID、不重跑 Stable、不修改历史 artifacts、不提交 Git。
- 旧 schema 不迁移；关闭周期没有覆盖操作日的开放预算周期时，历史调整明确失败并保留原状态。

## 任务0现状复核（2026-08-11）

- `npm test -- --test-reporter=tap`：退出 0；475 tests、475 pass、0 fail、0 cancelled、0 skipped、0 todo。
- `npm run check`：退出 0；477 test declarations，通过。
- `npm run check:mini`：退出 0；五页、详情页、生成包和源码边界通过。
- 当时 `git status --short --branch` 的任务0复核工作区干净；阶段十九当前变更及验证见下方记录。
- 475 tests / 477 declarations 是阶段十八任务1新增回归测试后的历史数量；阶段十九新增两条回归后当前数量为 477 tests / 479 declarations。

## P0：本地清除功能缺陷（已解除，2026-08-11）

- 根因已修复：`undefined`、`null`、`''` 统一视为缺键；空白字符串及其他无效值不视为缺键。
- 领域层已覆盖账本清除失败的精确回滚；页面编排为先清账本、成功后清内存状态和页面初始化标志、再清理生成文件，文件失败不恢复账本。
- 隔离 Stable 实测已通过：主键和临时键读回 `''`，哨兵 `phase7-isolated-sentinel=keep-this-sentinel` 保持不变，用度 JSON/CSV 不存在，无关文件保留，页面未初始化。
- 证据文件：`artifacts/phase7/local-clear-stable.txt`；真实账本和测试 AppID `wx9567fb4ff6336d0b` 未触碰。

## 任务0基线核对（2026-08-11）

- 任务书预期开工点为 `master` / `65fb7a3`；实测工作区干净，当前为 `agent/publish-current-progress` / `f52e5b9`。
- `f52e5b9` 是 `65fb7a3` 的直接子提交，差异正好为任务书列明的12项视觉证据变更；没有额外未提交改动。本轮沿当前已发布历史继续，不重写分支或历史证据。

## 已解除的视觉工具观察项

- 2026-08-11 当前环境恢复复测已通过：兼容性 `1/1`、完整六态 `6/6`、六个独立会话、运行时错误/异常/警告/超时均为0，清理均确认。历史 `sent-no-matching-reply` 诊断完整保留，不改写为成功。
- Computer Use 已连续两次识别并截图 Stable NW.js 窗口，但仍不作为日常视觉门禁；自动截图结论只限定为“本环境已经恢复”，不写成永久修复或归因于单一更新。
- 六态隔离证据不替代真实账本和真机发布验收；视觉证据也不加入非视觉功能的日常门禁。机制和原始历史证据见 `docs/VISUAL_EVIDENCE.md` 与 `artifacts/visual-evidence/`。

## 发布前待完成

- 当前没有正式小程序主体和生产 AppID；`wx9567fb4ff6336d0b` 只是测试 ID。
- 正式发布前需在用户明确授权的环境中完成 schema v3 JSON 导出/恢复、关闭重开、真机冒烟和产品视觉确认。
- 隔离自动取证不能替代真实账本的数据安全验证；2026-08-09 的 21–23 号证据使用 schema v1，只能作为历史记录。

## 已知但不阻塞

- Stable/automator 会产生固定形态的无 UUID `App.logAdded type:error args:[{}]` 事件。现有脚本原样记录并单列，不能扩大忽略范围，也不能把它当作截图回复。
- 首页第二版尚未完成产品视觉终验。按当前战略，先完成剩余功能和已知缺陷，再继续另外三页的高保真重绘。
- `artifacts/visual-evidence/` 中名称含 `red` 的文件是报警器或红绿流程证据，不是待删除的失败残留。

## 已解除

- 账单修改、分次退款、退款撤销、普通撤销、历史调整、分析重述、CSV 与 schema v2 审计关系已经实现并通过 467/467 自动测试。
- 详情页已接入普通点击与左滑快捷入口，且保持唯一非 Tab 页。
- 版本 0、1 和 2 的恢复与迁移路径已删除；当前恢复只接受 schema v3。
- 阶段十八生成清单与白名单冲突已解除：本轮补充授权仅允许 `npm run build:mini` 自动生成 `miniprogram/lib/build-manifest.json`，未手工编辑；随后 `npm run check:mini` 已通过。

## 阶段十九清除回滚修复（已完成，2026-08-11）

- 本任务无新增待裁决项；只修复稳定存储缺失值在清除回滚中的误判，未扩展第二阶段或修改 Stable 证据。
- 生产修复仅改 `src/application/app-core.js` 的 `hadMain`、`hadTemp` 缺失值判定；定向 63/63，全量 477/477，`npm run check` 为 479 declarations，`npm run check:mini` 与 `git diff --check` 均通过。

## 阶段十八 Stable 清除证据（已完成，2026-08-11）

- `.visual-qa` / `touristappid` 隔离 fixture 已从真实设置页完成最终确认；清除后两项目标键均为 `''`，哨兵和无关文件均保留，生成文件均不存在。
- 页面读回为 `pages/settings/settings`、`initialized=false`、`globalData.state=null`；完整原始结果见 `artifacts/phase7/local-clear-stable.txt`。

详细历史错误、旧窗口 ID、中间测试数字和已经结束的阶段过程以 Git 历史及 `artifacts/` 为准，不再在本文件重复维护。
