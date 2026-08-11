# 当前进度

更新时间：2026-08-11

业务功能基线：`7188fd9`；本轮视觉收口开工点：`65fb7a3`；此前证据发布提交：`f52e5b9`。

## 现役产品

- 当前参赛版是离线原生微信小程序，支持人民币、整数分、动态累计预算、六类账户、周期计划与小程序内提醒、三张账单分析图、JSON 完整备份、CSV 导出，以及账单修改、退款、撤销的可追溯闭环。
- 小程序固定五页：home、settings、entry、bills、transaction-detail。详情页是唯一非 Tab 页；底部视觉导航为“账本｜记一笔｜我的”，中央“记一笔”是动作入口。
- 日常账单列表只显示逻辑账单的最新有效版本；修改使用冲正与新版本，退款可分次发生，撤销保留审计关系。账户、预算、负债、奖励余额和可退金额必须原子一致。
- 当前存储版本是 `schemaVersion: 2`，只接受当前版本备份，不迁移版本 0 或版本 1。阶段九的 schema v1 证据只保留为历史验证记录。
- 首版仍不包含 AI 分析、云同步、行情、汇率、会员、后台定时通知或正式生产 AppID。

## 当前验证基线

- `npm run build:mini`：退出 0，生成 5 个小程序文件。
- `npm test`：467/467，fail/skip/todo 均为 0。
- `npm run check`：469 test declarations，退出 0。
- `npm run check:mini`：退出 0，五页、详情页、生成包和源码边界通过。
- `git diff --check`：退出 0；仅有工作区换行符转换提示。
- 自动视觉取证已在本环境恢复复测；本环境结论、历史失败和发布边界见 `docs/VISUAL_EVIDENCE.md`。

## 当前功能缺陷

- 应用内“清除本地数据”尚未通过 Stable 实测。微信缺失存储键读回空字符串，而 `clearLocalLedger` 目前只把 `undefined` / `null` 当作删除成功，因此真实删除后会误报失败并尝试回滚。
- 该缺陷影响用户主动清除这一隐私能力，应先于新增功能修复。修复必须覆盖空字符串缺键语义、只删除本应用键、失败原子回滚和无关键不受影响。

## 阶段十八任务0基线（2026-08-11）

- 基线复核：`agent/publish-current-progress` / `9440d4a`，工作区干净。
- `npm test -- --test-reporter=tap`：467/467，fail/cancelled/skip/todo 均为 0。
- `npm run check`：469 个测试声明，通过；`npm run check:mini`：通过。
- 目标：修复 Stable 空字符串缺键、账本原子清除和生成文件清理闭环。
- 顺序：先写真实旧实现红灯 → 统一领域存储语义 → 修正页面编排 → 生成包与隔离 Stable 验收 → 完整门禁。
- 最大风险：账本清除失败时误删文件或回滚不精确；文件清理失败时误恢复已清除账本。

## 阶段十八任务1旧实现红灯（2026-08-11）

- 命令：`node --test tests/phase7-data-safety.test.js tests/phase8-release-readiness.test.js`
- 实际结果：退出 1；80 tests，72 pass，8 fail，0 cancelled，0 skipped，0 todo。
- 失败项：5 个 Stable/空字符串缺键与精确回滚测试；3 个“账本先清除、文件后清理/部分成功”页面测试。
- 结论：旧实现确实在任务书列明的真实缺陷上变红，已保存本次红灯事实，尚未改生产代码。

## 阶段十八任务2领域与页面定向绿灯（2026-08-11）

- 修复：`isMissingStorageValue` 仅把 `undefined`、`null`、`''` 判为缺键，并统一接入四个指定持久化流程；清除回滚只触碰主键和恢复临时键。
- 页面顺序修复为“先清账本、成功后清内存状态与页面初始化标志、再删生成文件”；文件失败不恢复账本并显示确认文案。
- 定向命令：`node --test tests/phase7-data-safety.test.js tests/phase8-release-readiness.test.js`。
- 实际结果：退出 0；80 tests，80 pass，0 fail，0 cancelled，0 skipped，0 todo。

## 阶段十八 Stable 隔离验收准备（2026-08-11）

- 已重建隔离副本：`.visual-qa`，AppID 为 `touristappid`；未读取或写入测试 AppID `wx9567fb4ff6336d0b`。
- 清除前已准备：主键、恢复临时键、哨兵键 `phase7-isolated-sentinel=keep-this-sentinel`，以及 `yongdu-backup-20260811-213700.json`、`yongdu-transactions-20260811-213700.csv` 和无关文件。
- 已从真实设置页进入“数据与隐私”，输入“清除”并打开最终确认弹窗；尚未点击破坏性“确认清除”，待动作前确认后继续。

## 下一步优先级

1. 修复并验收“清除本地数据”的空字符串缺键语义；使用隔离账本做 Stable 验证，不触碰真实账本。
2. 在记账入口补齐奖励余额的全额或部分抵扣交互。领域层已经支持 `rewardOffsetCents`，但当前记账页没有用户入口。
3. 实现账户重命名、停用/归档和可追溯余额校准。
4. 补齐信用卡、借贷和投资操作的历史日期补录。
5. 功能闭环后再继续全局 UI、交互细节和自动视觉取证投入。

## 文档权威顺序

1. `docs/PRODUCT_SPEC.md`：现役产品与业务规则。
2. `docs/PHASE10_TDESIGN_UI_SPEC.md`：现役首页视觉与导航契约。
3. `docs/PHASE7_DATA_SAFETY_SPEC.md`：本地备份、恢复和精确清除契约。
4. `docs/VISUAL_EVIDENCE.md`：自动视觉取证机制与当前协议结论。
5. `docs/PHASE8_RELEASE_CHECKLIST.md`：发布前验收入口及隔离数据边界。

其余阶段文档只保留当时的决策背景；与上述现役文档冲突时，不得覆盖现役口径。详细实施过程、旧测试数和中间失败保留在 Git 与 `artifacts/`，不再堆入本文件。

## 发布边界

- 当前只有测试 AppID `wx9567fb4ff6336d0b`，没有正式小程序主体和生产 AppID。
- 正式发布前仍需在明确授权的环境中完成当前 schema v2 JSON 导出/恢复、关闭重开、真机冒烟和产品视觉确认；隔离 fixture 与 2026-08-09 的 schema v1 证据不能替代发布验收。

## 阶段十七视觉证据文档收口（2026-08-11）

- 开工核对：工作区无未提交改动；实际为 `agent/publish-current-progress` / `f52e5b9`，其父提交 `65fb7a3`，相对差异仅含任务书列明的12项视觉证据。
- 目标：只记录当前环境已恢复的自动截图链路，保留历史失败，不改产品功能、UI或测试逻辑。
- 顺序：完整性校验 → 现役文档修正 → 非视觉静态门禁与反向校验 → 白名单独立提交。
- 最大风险：把一次当前环境恢复写成永久修复，或把隔离 fixture 误写成真实账本发布验收。
- 证据完整性命令已通过：`VISUAL EVIDENCE VERIFIED`。

## 当前视觉基线（2026-08-11）

- 兼容性探针 `1/1`：`ok=true`、390×753、`runtimeErrors=0`；完整六态 `6/6`，六个 fixture 各使用独立会话。
- 六态 manifest 的应用错误、异常、警告、超时和运行时错误均为0；六次清理均 `confirmed=true`，`six-states-green.txt` 为 `ok=true`、`pngCount=6`。
- 该结论限定为当前环境恢复，不代表永久修复；隔离证据不替代真实账本导出/恢复、关闭重开和真机发布验收。

## 阶段十七收口验收（2026-08-11）

- `npm test -- --test-reporter=tap`：退出 0；467 tests、467 pass、0 fail、0 skipped、0 todo。
- `npm run check`：退出 0；469 test declarations、必需规格章节和 domain 边界通过。
- `npm run check:mini`：退出 0；五页、生成包和源码边界通过。
- `git diff --check`：退出 0；仅有 Git 的 LF→CRLF 转换提示。
- 视觉完整性原件校验：`VISUAL EVIDENCE VERIFIED`；内存副本删除一个 capture 后：`REVERSE MUTATION REJECTED`，原件再次 `VISUAL EVIDENCE VERIFIED`；磁盘证据未改动。
