# Progress

- 第二阶段目标：把已验证财务内核接入原生微信小程序核心闭环：设置、首页、记一笔、最近账单，并让本地数据可恢复。
- 顺序：任务0复跑基线与工具 → 任务1应用层和测试 → 任务2四页界面 → 任务3构建、开发者工具闭环、截图和反向验收。
- 最大风险：小程序不能直接复用 ESM、页面误算预算/余额、损坏存储白屏，以及开发者工具真实运行条件不足。
- 当前：基线与 CLI 登录检查已通过；任务1应用层、任务2四页和生成构建已完成，127项测试全绿，应用层不接平台API；任务3真实工具证据待补最终审计。
- 第二阶段边界：只改任务书白名单；不改 src/domain、旧三份测试或旧校验器，不做 AI、云端、图表、资产全量管理或真实提醒。

## Phase 2 task 1

- 应用层入口：`src/application/app-core.js`；页面只通过它初始化、读取首页模型、记账、同类检索和账单排序。
- 本地持久化使用既有版本化 JSON 备份函数；损坏文本由应用层原样返回给页面，不清空。
- `tests/application.test.js` 与 `tests/miniprogram.test.js` 已加入真实应用/项目结构测试；当前总测试数 128。

- 目标：交付整数分预算内核、资产与流水账、可恢复备份迁移和 CSV 导出；不做 UI、AI、云端或提醒。
- 顺序：任务0初始化与校验器 → 任务1预算规则 → 任务2资金账 → 任务3恢复与导出 → 最终验收。
- 最大风险：周期边界、负结转、累计取整、信用卡还款与退款可能造成重复计账。
- 当前：任务0—3已完成；预算、资产流水、恢复迁移和 CSV 导出均已通过 88 项真实测试与项目校验，进入最终反向验收。
- 约束：只改白名单；金额使用整数分；测试调用真实业务函数。

## Task 3 freeze fingerprints

- `tests/budget.test.js`: `D4DE2ABAB923E9B3315CC5999DAA9877668A1D421F3937419F097925E404446E`
- `tests/ledger.test.js`: `694A0B2D9116CA46969C4C3A71281E6B626FA96D5A6FCCE0670D9D883617E7E3`
- `tests/storage.test.js`: `EB47602EE3CB0D92AC494E5A3773CF71D9F7C23DD67A889596DD3DB7668D6176`
- `scripts/validate-project.js`: `05C7BAB31560307DF2B1242E5C157DE0B17D36068DBB261EE8C6E32304B3F9AE`

## Final acceptance

- `npm test`: 88 passed, 0 failed, 0 skipped, 0 todo.
- `npm run check`: passed; domain boundary and required specification sections present.
- `git diff --check`: passed.
- Reverse check 1: intentionally changed the credit-card repayment assertion; `npm test` failed with actual 7000 vs expected 0; restored and `npm test` returned 88 passed.
- Reverse check 2: temporarily removed the data-recovery specification heading; `npm run check` failed for that exact missing section; restored and check passed.

## Refund regression fix

- `recordRefund` now allocates each open-period mixed refund against the remaining original budget impact first and the remaining original reward offset second; cumulative restoration cannot exceed either component.
- Added full, split, reversed-order, open-period, closed-period, and credit-card mixed-refund regressions.
- Refund fix and its regression tests are tracked in commits `57bed81` and `ef90a9e`; current `npm test` reports 128 passed, 0 failed, 0 skipped, 0 todo.

## Phase 2 continuation

- 已读断点并核对现状：四页、应用层、生成包和项目检查脚本存在；`npm test` 为 127/127，`npm run check` 通过。
- 待办顺序：复跑 CLI/基线 → 同步生成包 → 真实工具闭环与截图 → 两次红绿反向验证 → 白名单、冻结目录和 Git 审计。

## Phase 2 reverse validation

- 反向一：临时把 30 天周期首日完整额度期望从 `10000` 改为 `10001`；`npm test` 红，实际 `10000 !== 10001`，退出码 1；还原后 128 passed、0 failed、0 skipped、0 todo。
- 反向二：临时把 `miniprogram/app.json` 的设置页改成 `pages/settings/broken`；`npm run check:mini` 红，报告 `app.json must declare the four phase-two pages in order`，退出码 1；还原后检查通过，随后 `npm test` 128 passed。

## Phase 2 real-tool evidence

- 已用微信开发者工具真实导入并渲染设置、首页、记一笔和最近账单；四张截图位于 `artifacts/phase2/01-settings.png` 至 `04-bills.png`。
- 初始化截图显示真实设置表单，首页显示真实预算模型，记账页显示“上一笔同类 / 暂无记录”，账单页显示真实空状态。
- CLI `quit` 后再 `open` 的重启尝试出现开发者工具白屏；在此前可见运行状态中 Console 已报告 `Errors 6 / Warnings 2` 和 `err_code=41002 appid missing`，所以真实保存账单、同类已有记录和 Console 0 错误仍未通过，详见 `BLOCKED.md`。
- 纯生成包 `node --check` 四个文件均退出 0；当前自动化验收为 128 passed、0 failed、0 skipped、0 todo，`npm run check` 与 `npm run check:mini` 均通过。
