# 当前进度

更新时间：2026-08-12

## 阶段二十一 schema v3 验收缺陷（2026-08-12）

- 目标：删除旧结算兼容，补严 v3 settlement 恢复校验，完整展示已结算周期历史。
- 顺序：先写旧参数/旧事件/非法恢复/历史展示红灯 → 删除兼容 → 校验 settlement → 页面历史 → 定向、构建、全量门禁。
- 约束：只改本轮白名单；schema 保持 v3；不改结算公式、业务调整规则、历史 artifacts、真实 AppID 或 Git 历史。
- 最大风险：非法备份误恢复或历史记录混入开放周期；其次是旧契约残留造成静默兼容。

## 阶段二十一任务1红灯（2026-08-12）

- 按基线命令运行定向套件：退出 1；152 tests、145 pass、7 fail、0 cancelled、0 skipped、0 todo。
- 失败证据：旧双 mode 参数未失败；设置模型没有 settlementRecords；设置页没有“周期结算记录/带入下期/空状态”；首页仍暴露两个旧事件；v3 关闭无 settlement 与开放含 settlement 均可恢复；视觉 fixture 仍传旧双 mode 参数。
- 原始命令：`node --test tests/application.test.js tests/storage.test.js tests/phase4-budget-lifecycle.test.js tests/phase9-home-visual-contract.test.js tests/phase11-home-ledger-sheet.test.js tests/visual-evidence.test.js`。

## 阶段二十一任务2—4定向绿灯与全量结果（2026-08-12）

- 删除 `app-core.js` 双 mode 转换、首页两个旧事件；视觉 fixture 改为 `{ decision: 'carry' }`；定向套件实际 137/137 通过，0失败、0跳过、0todo。
- v3 恢复校验已覆盖周期结构、唯一 ID、日期连续性、整数金额、状态与 settlement、结果符号/预算计算、决定与带入金额、结算日期和下一周期引用；非法 rawData 原样返回。
- `npm run build:mini` 实际退出 0；生成 application、storage 和 manifest 已更新且仅在白名单内。
- 全量 `npm test` 实际为 500/497/3（失败原因已写入 BLOCKED.md），不是通过状态；其余门禁待本轮末复跑并如实记录。

## 阶段二十一最终验收记录（2026-08-12）

- 任务书指定定向命令最终实际退出 0：164 tests、164 pass、0 fail、0 cancelled、0 skipped、0 todo。
- `npm run check` 实际退出 0：499 test declarations；`npm run check:mini` 实际退出 0；`git diff --check` 实际退出 0，仅有 LF→CRLF 提示。
- 生产源码、生成包、页面和视觉脚本不含旧双 mode 参数或旧首页事件；设置模型与页面只展示有效关闭周期的结算记录及带入下期金额。
- 本轮未提交、未推送、未改 HEAD；全量测试仍受 BLOCKED.md 所述 3 个只读历史 fixture 阻塞，不能宣称全量通过。

## 阶段二十任务0基线（2026-08-12）

- 目标：彻底删除奖励余额，改为周期结余/超支一次性决定是否带入下期，并升级 schema v3。
- 顺序：先领域模型与备份/CSV → 结算与历史调整 → 应用层与页面 → 关键红灯→全绿 → 生成包与完整门禁。
- 约束：只改任务书白名单；不读写真实 AppID，不重跑 Stable，不改历史 artifacts。
- 最大风险：旧奖励语义残留造成预算、备份或历史账单不一致；其次是关闭周期被错误重算。

## 阶段二十任务1新规则红灯（2026-08-12）

- 已先改写核心结算测试：无默认决定、结余/超支全部带入或全部不带入、零结果免选择。
- 实跑 `node --test --test-reporter=tap tests/budget.test.js`：退出 1；33 tests、29 pass、4 fail、0 cancelled、0 skipped、0 todo。
- 红灯来自现有 `settleBudgetCycle` 仍预设带入并保留奖励参数；记录后继续改写领域与 schema。
- 核心结算函数已改为 `decision: carry|discard|null`，不再接受奖励参数；复跑同一命令退出 0，33/33 全绿。

## 阶段二十任务1—3实现与定向验收（2026-08-12）

- 领域层已删除奖励余额、奖励支付和混合支付字段；现行账本为 schema v3，旧 v0/v1/v2 备份明确拒绝并保留原文。
- 周期结算改为结果非零时一次性选择“全部带入／全部不带入”，不预选；结算记录写入关闭周期，下一周期只承接完整有符号结果。
- 关闭周期退款、修改和撤销不重写已关闭周期；差额由操作日覆盖的当前开放周期承担，固定支出在待结算期间仍可记账。
- CSV、资产模型、分析、详情和设置周期列表已移除奖励字段；首页只保留一个未预选的结算选择器。
- 定向测试已通过：预算33、账本47、应用35、存储19、阶段3为23、阶段4为27、阶段5为37、阶段6为30、阶段7为63、阶段8为19、阶段11为17、修正46、修正UI为20；均为0失败、0跳过、0 todo。
- 全量首次红灯：`npm test` 退出1，482 tests、480 pass、2 fail；失败来自只读视觉契约仍调用旧事件名和隔离 fixture 的显式双 carry 参数。最小桥接后复跑全绿。
- 最终门禁：`npm run build:mini`、`npm test`、`npm run check`、`npm run check:mini`、`git diff --check` 均已实际退出0；当前为482/482测试、483 test declarations。

业务功能基线：`7188fd9`；本轮视觉收口开工点：`65fb7a3`；此前证据发布提交：`f52e5b9`。

## 现役产品

- 当前参赛版是离线原生微信小程序，支持人民币、整数分、动态累计预算、六类账户、周期计划与小程序内提醒、三张账单分析图、JSON 完整备份、CSV 导出，以及账单修改、退款、撤销的可追溯闭环。
- 小程序固定五页：home、settings、entry、bills、transaction-detail。详情页是唯一非 Tab 页；底部视觉导航为“账本｜记一笔｜我的”，中央“记一笔”是动作入口。
- 日常账单列表只显示逻辑账单的最新有效版本；修改使用冲正与新版本，退款可分次发生，撤销保留审计关系。账户、预算、负债和可退金额必须原子一致。
- 当前存储版本是 `schemaVersion: 3`，只接受当前版本备份，不迁移旧版本；旧 schema 证据只保留为历史验证记录。
- 首版仍不包含 AI 分析、云同步、行情、汇率、会员、后台定时通知或正式生产 AppID。

## 当前验证基线

- `npm run build:mini`：退出 0，生成 5 个小程序文件；生成的 `application.js` 已纳入本轮交付。
- `npm test -- --test-reporter=tap`：482/482，fail/cancelled/skip/todo 均为 0。
- `npm run check`：483 test declarations，退出 0。
- `npm run check:mini`：退出 0，五页、详情页、生成包和源码边界通过。
- `git diff --check`：退出 0；仅有工作区换行符转换提示。
- 自动视觉取证已在本环境恢复复测；本环境结论、历史失败和发布边界见 `docs/VISUAL_EVIDENCE.md`。

## 阶段十九清除缺失值回滚修复（2026-08-11）

- 新增两条对称回归：主键缺失/临时键存在，以及主键存在/临时键缺失；均覆盖临时键删除失败、精确恢复、无关键保留和不误报“原数据回滚失败”。
- 旧实现红灯：`node --test --test-reporter=tap tests/phase7-data-safety.test.js` 退出 1；63 tests、61 pass、2 fail、0 cancelled、0 skipped、0 todo；失败正是两条新增对称回归。红灯时 `git diff -- src miniprogram` 为空。
- 最小修复：`clearLocalLedger` 的 `hadMain`、`hadTemp` 改为复用既有 `isMissingStorageValue`；未增加 helper、导出、错误文案或其他流程改动。
- 定向绿灯：同一命令退出 0；63 tests、63 pass、0 fail、0 cancelled、0 skipped、0 todo。
- `npm run build:mini` 退出 0；仅更新 `miniprogram/lib/application.js` 与 `miniprogram/lib/build-manifest.json`，`budget.js`、`ledger.js`、`storage.js` 与 `649306e` 字节一致；Stable 证据文件未改动。
- 全量收口：`npm test -- --test-reporter=tap` 退出 0，477 tests、477 pass、0 fail、0 cancelled、0 skipped、0 todo；`npm run check` 退出 0，479 test declarations；`npm run check:mini` 退出 0；`git diff --check` 退出 0。
- 反向证据：`git diff --exit-code 649306e -- artifacts/phase7/local-clear-stable.txt` 退出 0；本阶段未改 Stable 证据，未修改三份 domain 生成文件。

## 当前功能缺陷

- 本轮 P0“清除本地数据”已在隔离 Stable 完成一次真实清除：主键和临时键读回 `''`，无关哨兵保留，生成 JSON/CSV 已删除，页面进入未初始化状态。
- 本轮 P0 业务闭环与全部当前门禁均已通过；生成清单由本轮补充授权后的 `npm run build:mini` 自动生成。

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
- 结论：旧实现确实在任务书列明的真实缺陷上变红，红灯事实已保存，随后完成了领域与页面修复。

## 阶段十八任务2领域与页面定向绿灯（2026-08-11）

- 修复：`isMissingStorageValue` 仅把 `undefined`、`null`、`''` 判为缺键，并统一接入四个指定持久化流程；清除回滚只触碰主键和恢复临时键。
- 页面顺序修复为“先清账本、成功后清内存状态与页面初始化标志、再删生成文件”；文件失败不恢复账本并显示确认文案。
- 定向命令：`node --test tests/phase7-data-safety.test.js tests/phase8-release-readiness.test.js`。
- 实际结果：退出 0；80 tests，80 pass，0 fail，0 cancelled，0 skipped，0 todo。

## 阶段十八 Stable 隔离验收准备（2026-08-11）

- 已重建隔离副本：`.visual-qa`，AppID 为 `touristappid`；未读取或写入测试 AppID `wx9567fb4ff6336d0b`。
- 清除前已准备：主键、恢复临时键、哨兵键 `phase7-isolated-sentinel=keep-this-sentinel`，以及 `yongdu-backup-20260811-213700.json`、`yongdu-transactions-20260811-213700.csv` 和无关文件。
- 已从真实设置页进入“数据与隐私”，输入“清除”并打开最终确认弹窗；本节只记录准备过程，最终结果见下一节。

## 阶段十八 Stable 隔离验收完成（2026-08-11）

- 真实设置页确认动作已在 `.visual-qa` / `touristappid` 隔离 fixture 执行；未触碰测试 AppID `wx9567fb4ff6336d0b` 或真实账本。
- 清除后主键、恢复临时键均读回 `''`；`phase7-isolated-sentinel` 仍为 `keep-this-sentinel`；生成 JSON/CSV 不存在，无关文件仍存在。
- 页面路径为 `pages/settings/settings`，`initialized=false`，`globalData.state=null`，运行摘要和存储错误均为空。
- 原始结果（不含账本内容）：`artifacts/phase7/local-clear-stable.txt`。

## 阶段十八收口门禁实测（2026-08-11）

- `npm test -- --test-reporter=tap`：退出 0；475 tests、475 pass、0 fail、0 cancelled、0 skipped、0 todo。
- `npm run check`：退出 0；477 test declarations、必需规格章节和 domain 边界通过。
- `npm run check:mini`：退出 0；五页、详情页、生成包和源码边界通过。
- `git diff --check`：退出 0；仅有 LF→CRLF 转换提示。
- 阶段十八收口时记录的未提交变更仅为当时授权范围内的文档、生成清单和 Stable 证据文件；本阶段现行变更见阶段十九记录。
- 475 tests / 477 declarations 是阶段十八任务1新增回归测试后的历史数量；阶段十九新增两条回归后当前数量为 477 tests / 479 declarations。

## 下一步优先级

1. 完成本轮全量门禁与生成包指纹记录。
2. 实现账户重命名、停用/归档和可追溯余额校准。
3. 补齐信用卡、借贷和投资操作的历史日期补录。
4. 功能闭环后再继续全局 UI、交互细节和自动视觉取证投入。

## 文档权威顺序

1. `docs/PRODUCT_SPEC.md`：现役产品与业务规则。
2. `docs/PHASE10_TDESIGN_UI_SPEC.md`：现役首页视觉与导航契约。
3. `docs/PHASE7_DATA_SAFETY_SPEC.md`：本地备份、恢复和精确清除契约。
4. `docs/VISUAL_EVIDENCE.md`：自动视觉取证机制与当前协议结论。
5. `docs/PHASE8_RELEASE_CHECKLIST.md`：发布前验收入口及隔离数据边界。

其余阶段文档只保留当时的决策背景；与上述现役文档冲突时，不得覆盖现役口径。详细实施过程、旧测试数和中间失败保留在 Git 与 `artifacts/`，不再堆入本文件。

## 发布边界

- 当前只有测试 AppID `wx9567fb4ff6336d0b`，没有正式小程序主体和生产 AppID。
- 正式发布前仍需在明确授权的环境中完成当前 schema v3 JSON 导出/恢复、关闭重开、真机冒烟和产品视觉确认；隔离 fixture 与历史 schema 证据不能替代发布验收。

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
