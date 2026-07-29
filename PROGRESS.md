# Progress

- 第二阶段目标：把已验证财务内核接入原生微信小程序核心闭环：设置、首页、记一笔、最近账单，并让本地数据可恢复。
- 顺序：任务0复跑基线与工具 → 任务1应用层和测试 → 任务2四页界面 → 任务3构建、开发者工具闭环、截图和反向验收。
- 最大风险：小程序不能直接复用 ESM、页面误算预算/余额、损坏存储白屏，以及开发者工具真实运行条件不足。
- 当前：基线与 CLI 登录检查已通过；任务1应用层、任务2四页和生成构建已完成，134项测试全绿，应用层不接平台API；真实工具仍有 timeout，闭环截图受本地零余额状态阻塞。
- 第二阶段边界：只改任务书白名单；不改 src/domain、旧三份测试或旧校验器，不做 AI、云端、图表、资产全量管理或真实提醒。

## Phase 2 task 1

- 应用层入口：`src/application/app-core.js`；页面只通过它初始化、读取首页模型、记账、同类检索和账单排序。
- 本地持久化使用既有版本化 JSON 备份函数；损坏文本由应用层原样返回给页面，不清空。
- `tests/application.test.js` 与 `tests/miniprogram.test.js` 已加入真实应用/项目结构测试；当前总测试数 134。

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

- 已恢复 `src/domain/ledger.js`、`tests/ledger.test.js` 到提交 `4cc737367f467dc7e114725ab0de9738547fd1c5` 内容；第一阶段其他冻结文件未改。
- 应用层已将周期结束改为显式结算状态：结余/超支必须选择带入下期或奖励余额；固定支出不再依赖开放预算周期。
- 追加应用层回归后，`npm test` 为 134/134，`npm run check` 与 `npm run check:mini` 通过；生成包重新构建通过。

## Phase 2 reverse validation

- 反向一：临时把 30 天周期首日完整额度期望从 `10000` 改为 `10001`；`npm test` 红，实际 `10000 !== 10001`，退出码 1；还原后 128 passed、0 failed、0 skipped、0 todo。
- 反向二：临时把 `miniprogram/app.json` 的设置页改成 `pages/settings/broken`；`npm run check:mini` 红，报告 `app.json must declare the four phase-two pages in order`，退出码 1；还原后检查通过，随后 `npm test` 128 passed。

## Phase 2 real-tool evidence

- 测试 AppID 已生效：`cli.bat islogin --lang zh` 返回 `{"login":true}`；重新 `open --project ...` 退出码为 0；设置页真实显示 ¥3000.00 和现金 ¥0.00。
- 清空旧 Console 后重新加载，开发者工具重新产生 `Error: timeout`，面板计数为 `Errors: 1 / Warnings: 3`；该错误仍在，未用清空或隐藏伪造零错误。
- 重新加载后页面不再持续白屏，但本地模拟器已有状态现金为 ¥0.00，且设置页无增加余额入口；本轮未删除本地模拟器数据，也未注入账单。
- 因此四张“设置→记账→上一笔同类→账单→关闭重开”闭环截图未更新；旧空账单截图不作为本轮闭环证据，详见 `BLOCKED.md`。
- `node --check` 生成包文件退出 0；当前自动化验收为 134 passed、0 failed、0 skipped、0 todo，`npm run check` 与 `npm run check:mini` 均通过。

## Phase 2 continuation — current run

- 奖励余额不足时，结算模型现在按 `min(奖励余额, 超支总额)` 计算抵扣；未抵扣部分明确带入下期，奖励余额不会变负；新增 5 项真实应用层回归。
- `npm run build:mini`：通过；`npm test`：139 passed, 0 failed, 0 skipped, 0 todo；`npm run check` 与 `npm run check:mini`：通过。
- 反向测试：临时将部分结转期望 `-30000` 改为 `-30001`，`npm test` 以 138 passed / 1 failed、退出码 1 变红；还原后恢复 139 全绿。
- `cli.bat islogin --lang zh` 返回 `{"login":true}`；仅针对当前项目/AppID 清理了 storage、session、file、compile 缓存，并重新加载。
- 清空旧 Console 后重新编译：当前 Console 错误数为 0，`timeout` 为 0；但模拟器仍显示 `./pages/settings/settings.wxml not found`，无法真实进入设置页并完成闭环截图。
- 因此本轮不伪造或覆盖四张闭环截图；该外部工具渲染阻塞详见 `BLOCKED.md`。未扩展第三阶段。
- 追加一次只读重载尝试后，最新 WeappLog 仍显示 `isMiniAppProject=false`，编译缓存键仍漏掉 `miniprogram/`；未改动只读配置或白名单外文件，闭环仍阻塞。
- 再次重启并用 CLI 打开根项目后，RC 仍出现项目脚本错误、`41002 appid missing` 和 `routeTo appLaunch timeout`；将 `miniprogram` 子目录单独打开又因缺 `project.config.json` 退出码 10，随后已恢复根项目入口。
- `--disable-gpu` 重启及开发者工具项目菜单重载均未改变根目录识别结果；没有修改只读配置、注入模拟器数据或生成不实截图。
- 第三次连续重载仍显示 17 个 Console 错误与 `settings.wxml not found`；三轮均不是纯 timeout，按任务书停止，真实闭环和四张截图仍未完成。

## Phase 2 Stable acceptance

- 使用微信开发者工具 Stable `2.01.2510290` 打开根项目；Stable 自动补全后的 `project.config.json` 已保留，测试 AppID `wx9567fb4ff6336d0b` 与 `miniprogramRoot: miniprogram/` 未改变。
- 经用户授权，仅清除当前项目模拟器数据；按月预算 3000、周期起始日 1、现金 1000 重新完成真实闭环：早餐 50 后第二次记账显示“上一笔同类 ¥50.00”，再保存早餐 80，账单按 80、50 展示。
- 关闭并重开 Stable 后，两笔账单仍存在，设置页现金余额为 ¥870.00，首页今日可自由花为 ¥2579.67；持久化验证通过。
- 清空旧 Console 后重新编译并重载，闭环全过程未再出现 `timeout`，Console 错误数为 0；基础库为 `3.17.0`。
- 四张真实证据已更新到 `artifacts/phase2/01-settings.png`、`02-home.png`、`03-entry.png`、`04-bills.png`；未使用空账单或注入数据替代。
- 本轮只完成第二阶段验收与文档收尾，未开发第三阶段。

## Phase 3 kickoff

- 基线 HEAD：`7b34440afb0f2ddd6af9cb509bf8f9b79a121663`，开工前工作区干净。
- `npm test`：139 passed、0 failed/skipped/todo；`npm run check`、`npm run build:mini`、`npm run check:mini` 均退出 0，构建后工作区仍干净。
- 目标：在既有四页内接入六类账户和完整资产负债操作，保持预算口径、旧 schemaVersion=1 数据与离线持久化不变。
- 顺序：应用层资产契约与集成测试 → 四页真实交互 → 反向验证与自动化 → Stable 九步闭环、截图、重启验证 → 文档与提交。
- 最大风险：负债方向、投资成本/现值、转账双方以及周期待结算时固定类资金动作被页面错误计入预算。
- 技术边界：只调用既有领域函数；页面不复制余额或预算算法，不新增路由、依赖、网络请求或第三阶段范围外功能。

## Phase 3 task 1

- `src/application/app-core.js` 已增加六类账户模型、资产/负债汇总和收入、互转、信用卡还款、借贷、本金、利息、投资买卖及手工估值入口；所有余额变化仍由既有领域函数完成。
- 新入口统一解析整数分并将领域失败转换为中文可见错误；领域函数返回新状态，失败不会留下半笔交易。
- 最近流水模型覆盖收入、支出、转账、还款、借贷、利息与投资操作，旧第二阶段支出仍可读取。
- `tests/phase3-assets.test.js` 新增 23 项真实应用集成与页面契约测试，单文件结果 23 passed、0 failed/skipped/todo；精确九步账本结果为资产 570000、负债 402000、净资产 168000 分。

## Phase 3 task 2

- 设置页初始化后复用为资产中心，显示总资产、总负债、净资产、奖励余额、六类账户，并提供新增账户和七种债务/投资专项操作。
- “记一笔”已增加支出/收入/转账三模式；信用卡可作为支出账户，收入排除负债，转账限定现金类账户且禁止同账户。
- 最近账单已升级为最近流水，展示交易类型、金额、日期、账户方向和预算属性；首页保留预算与结算并增加资产中心入口。
- 构建后全量结果：162 tests passed、0 failed/skipped/todo；`npm run check`、`npm run check:mini` 和 9 个小程序 JS 语法检查均通过。

## Phase 3 reverse validation

- 反向一：临时将九步验收净资产期望从 `168000` 改为 `168001`；`npm test` 以 161 passed / 1 failed、退出码 1 变红，错误为 `168000 !== 168001`；还原后恢复 162 全绿。
- 反向二：临时从统一记账模式删除“转账”；`npm test` 以 161 passed / 1 failed、退出码 1 变红，页面契约明确缺少 `['支出', '收入', '转账']`；还原后恢复 162 passed、0 failed/skipped/todo。

## Phase 3 automated acceptance

- `npm test`：162 passed、0 failed/skipped/todo；`npm run check`：通过，确认 162 个测试声明、规格章节和领域边界。
- `npm run build:mini`：通过，生成 5 个文件；`npm run check:mini`：通过；`miniprogram/**/*.js` 共 9 个文件逐个 `node --check` 均退出 0。
- `git diff --check` 退出 0（仅报告 Git 的 LF→CRLF 工作区提示）；冻结区精确命令退出 0、无输出。
- 用户确认后，Stable `2.01.2510290` 已仅清除当前项目模拟器数据；完成预算 3000、起始日 1、现金 1000 的首次设置，建立现金、储蓄卡、电子钱包、信用卡、借贷和投资六类账户，并真实执行收入、转账、信用卡可控支出、还款、借款、还本金、利息、投资买入、手工估值九步操作。
- 九步后界面实值：总资产 ¥5700、总负债 ¥4020、净资产 ¥1680；现金 ¥1750、储蓄卡 ¥2100、钱包 ¥300、信用卡负债 ¥420、借贷负债 ¥3600、投资现值 ¥1550（成本 ¥1300）。
- 首页当日可自由花由释放额 ¥2806.45 降至 ¥2686.45，仅信用卡可控支出 ¥120 影响预算；最近流水已显示九步操作，固定利息、还款和资产转换未冒充可控支出。
- 清空旧 Console 后以 `Ctrl+B` 重新编译，实测 0 Errors、0 Warnings，未出现 `timeout`；关闭项目并从 Stable 项目管理器重新打开后，上述账户、余额和流水仍存在，Console 仍为 0 Errors，未出现 `timeout`。
- 六张闭环截图已更新到 `artifacts/phase3/01-assets.png` 至 `06-reopen.png`，分别覆盖资产总览、统一记账、债务流水、投资估值、首页预算和关闭重开。

## Phase 4 开工回执

- 基线核对：HEAD `1d518b6788bf7dae5a3e910cfe6e5de0fedcde85`，工作区干净，162 passed、0 failed/skipped/todo。
- `npm run check`、`npm run build:mini`、`npm run check:mini` 均退出 0。
- 目标：补齐三种预算修改范围和起始日立即、待生效、过渡、取消、覆盖、持久化生命周期。
- 顺序：领域日期规划 → 应用原子操作 → 设置页/首页 → ≥12 项测试 → Stable 不清数据闭环 → 全量验收提交。
- 最大风险：schemaVersion=1 下新增可选设置字段须兼容旧数据，结算创建过渡周期时必须无重叠、无断档且不改历史。

## Phase 4 implementation

- 应用层已接入三种预算范围；当前基础预算、两个默认预算按范围更新，正负结转、净支出、奖励余额、账户和流水保持原值。
- 起始日已形成空周期立即调整、有流水待生效、覆盖、取消、结算后过渡、过渡后常规周期闭环；跨年、闰年二月和 29/30/31 日按实际天数处理。
- 待结算仅允许修改下周期及以后默认预算；进入过渡后不允许取消，避免产生重叠周期。
- 设置页已显示当前/默认预算、周期日期、当前/待生效起始日，接入三范围二次确认、变更预览和取消；首页显示周期与待变更提示。
- 新增 21 项第四阶段真实测试；构建后全量为 183 passed、0 failed/skipped/todo。
- 反向验证：临时把“仅本周期”基础预算期望由 350000 改为 350001，`npm test` 以 182 passed / 1 failed、`350000 !== 350001` 变红；还原后恢复 183 passed、0 failed/skipped/todo。

## Phase 4 Stable acceptance

- 在未清除、未注入模拟器数据的前提下，Stable `2.01.2510290` 真实验证三种预算范围：仅本周期 3100、本期及以后 3200、下期及以后 3300；界面分别显示正确的当前预算与默认预算，资产负债数值未变。
- 随后将当前与默认预算恢复为 3000；把周期起始日从 1 改为 10 时，界面明确预览旧周期截止日、一次性过渡周期和新常规周期，并显示待生效状态；再经确认取消，未静默替用户选择。
- 首页恢复显示当前周期 `2026-07-01` 至 `2026-07-31`、今日可自由花 ¥2686.45；关闭项目并从 Stable 项目管理器重开后，当前/默认预算仍为 ¥3000、起始日仍为每月 1 日、无待生效设置。
- 重开后资产仍为 ¥5700、负债 ¥4020、净资产 ¥1680、奖励余额 ¥0；现金 ¥1750、储蓄卡 ¥2100、钱包 ¥300、信用卡负债 ¥420、借贷负债 ¥3600、投资现值 ¥1550（成本 ¥1300）。
- 清空旧 Console 后的本轮编译、修改、取消及关闭重开过程中，当前可见 Console 为 0 Errors，未出现 `timeout`；没有通过隐藏或再次清空错误伪造结果。
- 五张真实证据位于 `artifacts/phase4/01-original.png` 至 `05-reopen.png`，覆盖原始状态、三范围结果、待生效起始日、恢复后的首页和关闭重开持久化。
- 最终自动化：`npm run build:mini` 生成 5 个文件；`npm test` 为 183 passed、0 failed/skipped/todo；`npm run check`、`npm run check:mini`、9 个小程序 JavaScript 语法检查和 `git diff --check` 均退出 0。
