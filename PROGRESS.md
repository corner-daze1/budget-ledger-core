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

## Phase 4 hidden-acceptance repair kickoff

- 基线 HEAD `c778e7b64d747d750462f9efd3531190a0a6bc21`，工作区干净，183 passed、0 failed/skipped/todo。
- `npm run check` 与 `npm run check:mini` 均退出 0。
- 目标：拒绝非法公历日期、消除空周期改起始日造成的断档、按实际天数折算过渡周期预算修改。
- 顺序：日期校验与原子失败 → 周期连续性 → 过渡预算折算 → 回归和反向红绿 → 构建、Stable 只读复验、提交。
- 最大风险：修复空周期立即调整时误伤首次设置能力，或折算当前过渡预算时错误改写 carry、流水和未来默认值。
- 边界：只修改任务书八个白名单文件；不改页面、schema、校验器、截图或模拟器数据。

## Phase 4 hidden-acceptance implementation

- 应用日期入口现在复用领域层真实公历解析，非闰年2月29日、2月30日和4月31日均以“日期无效，请检查年月日”拒绝，传入状态不变。
- 空周期立即改起始日要求新周期开始日严格等于前一期结束日次日；不满足时保存待生效规则。普通延迟结算也从上一周期次日创建下一周期，不再按操作日跳月。
- 过渡周期修改本期预算时，把输入视为完整月度基准，按过渡开始月份实际天数折算；仅“本期及以后”与“下期及以后”更新未来默认预算。
- 新增6项真实回归，总测试预计189项；第四阶段单文件27 passed、0 failed/skipped/todo。
- 反向验证：临时把过渡周期正确期望90000改为90001，`npm test` 以188 passed / 1 failed变红，错误为 `90000 !== 90001`；还原后189 passed、0 failed/skipped/todo。
- Stable `2.01.2510290` 仅用 `Ctrl+B` 重新编译并只读查看：当前/默认预算均为 ¥3000、起始日1、无待生效规则；资产 ¥5700、负债 ¥4020、净资产 ¥1680。
- Stable Console 显示 Errors: 0、Warnings: 3（环境提示），当前日志无 `timeout`；未点击设置修改、未清除或注入模拟器数据。
- 最终验收：`npm run build:mini` 生成5个文件；`npm test` 189 passed、0 failed/skipped/todo；`npm run check`、`npm run check:mini` 与 `git diff --check` 均退出0，差异严格限于8个白名单文件。

## Phase 5 kickoff

- 基线 HEAD `cac1129fd72e0ae5862d33697727a45d13ccb599`，工作区干净，189 passed、0 failed/skipped/todo。
- `npm run check`、`npm run build:mini`、`npm run check:mini` 均退出0。
- 目标：三类计划按发生期幂等自动入账，失败原子化转待处理，并提供重试、提醒、编辑和停用闭环。
- 顺序：领域计划/发生期 → 应用自动处理与提醒 → app启动/前台及两页交互 → ≥24项测试 → Stable只读复验 → 提交。
- 最大风险：跨多期补记重复、贷款两笔非原子、短月日期漂移、失败重试产生重复结果。
- 边界：仅改第五阶段白名单，不改schemaVersion、路由、校验器、依赖、网络或模拟器数据。
- 未采用 Coze 远程项目工作流：本任务以现有本地仓库为唯一来源，且硬约束禁止网络/云服务及白名单外状态；继续使用本地原生构建和测试。

## Phase 5 implementation

- 计划继续使用既有 `plans/pendingItems/transactions`：发生期键为 `planId@dueDate`，成功流水和待处理均携带该键，重复启动、重开或点击不会重复。
- 单次、月度、年度推进支持月末31日和年度2月29日锚点恢复；多期遗漏按到期日和计划ID稳定排序逐笔补记。
- 固定支出、信用卡还款和贷款本金+利息已接入；贷款先完整预检，再原子生成两笔流水，失败只生成一条中文待处理且不改账户、流水或预算。
- 应用层已提供创建、编辑未来、停用、自动处理、补金额重试、提醒模型和逾期横幅关闭；旧计划无到期日仅标记“待补充计划信息”。
- `app.js` 在启动和回前台复用同一处理入口，仅状态变化后保存；同日重复检查保留本次执行摘要，跨日无结果时清除旧摘要。
- 设置页和首页已接入计划表单、三周期、提醒多选、计划列表、空状态、自动执行、待处理重试和逾期关闭，不新增路由或网络。
- 新增34项真实集成测试，单文件34 passed、0 failed/skipped/todo。
- 反向验证：临时把同一 `rent@2028-01-20` 发生期的期望流水数从1改为2，单文件以33 passed / 1 failed变红，错误为 `1 !== 2`；随后已还原唯一键断言。

## Phase 5 Stable acceptance

- Stable `2.01.2510290` 使用当前测试 AppID 重新编译；只读核对当前/默认预算均为 ¥3000、起始日1、无待结算周期，资产 ¥5700、负债 ¥4020、净资产 ¥1680，六类账户余额未变。
- 设置页真实显示三类计划、三种周期、到期日、小程序内提醒和“暂无计划”空状态；首页真实显示“计划与提醒”“暂无计划提醒或待处理项”，今日可自由花仍为 ¥2686.45。
- 当前 Console 为 Errors: 0、Warnings: 5；警告均为开发者工具/基础库环境提示，当前日志未出现 `timeout`。未清除、注入或修改模拟器业务数据。
- 两张证据位于 `artifacts/phase5/01-settings-plans.png` 与 `02-home-empty.png`。
- 最终自动化：`npm run build:mini` 生成5个文件；`npm test` 为223 passed、0 failed/skipped/todo；`npm run check`、`npm run check:mini`、9个小程序 JavaScript 语法检查和 `git diff --check` 均退出0。

## Phase 6 kickoff

- 基线 HEAD `1e562200408e6fc1bd6e712f768d186b41ad930e`，工作区干净，223 passed、0 failed/skipped/todo。
- `npm run check`、`npm run build:mini`、`npm run check:mini` 均退出0。
- 目标：把最近流水升级为由应用层唯一统计的账单分析，覆盖每日净支出、分类占比和真实预算周期趋势。
- 顺序：统计模型 → ≥20项真实测试 → bills/home界面 → 反向红绿 → Stable只读验收 → 提交。
- 最大风险：退款发生日与分类继承、可控/全部口径分离、关闭周期历史不被改写，以及跨期趋势的真实预算值。
- 边界：仅改阶段六白名单，不改领域、schema、存储、路由、依赖、校验器或模拟器业务数据。
- 未采用 Coze 远程项目工作流：本任务禁止网络、云服务和白名单外状态，继续使用现有本地原生构建与测试。

## Phase 6 implementation

- `getBillAnalysisModel` 成为唯一统计入口：按真实预算周期输出每日净支出、一级分类净额占比、最近6个真实周期预算/可控支出趋势和最近流水，传入状态保持逐字段不变。
- 可控/全部支出口径、退款发生日与原分类、关闭周期退款、跨期退款、自然日补零、未来排除、过渡周期和正负结转均由应用层整数分计算。
- bills页已升级为账单分析，提供两种范围、三张原生Canvas图、完整WXML金额/图例/空状态兜底和底部最近流水；首页入口已改为“账单分析”。
- 新增30项真实测试；构建后全量253 passed、0 failed/skipped/todo，原223项无回退。
- 反向验证：临时把“关闭周期退款不改写历史可控支出”期望从10000改为10001，单文件27 passed / 1 failed，错误为 `10000 !== 10001`；还原后全量253项全绿。

## Phase 6 Stable acceptance

- Stable `2.01.2510290` 未清除、注入或修改业务数据；重新编译后真实打开账单分析，可控口径显示 ¥120、全部口径显示 ¥170，固定利息只进入全部口径。
- 每日折线、一级分类占比、真实周期双序列趋势均成功绘制；普通WXML同时显示日期金额、分类金额/占比、预算/支出图例、周期状态和底部最近流水。
- 关闭项目并从Stable项目管理器重开后，可控合计仍为 ¥120、分析周期仍为 `2026-07-01` 至 `2026-07-31`，既有资产和流水保持。
- 当前 Console 为 Errors: 0、Warnings: 8，警告为开发者工具、基础库、Canvas接口建议和worker环境提示；当前日志无 `timeout`，未靠清空错误冒充。
- 五张真实截图位于 `artifacts/phase6/01-controlled-scope.png` 至 `05-reopen.png`。
- 最终验收按指定顺序执行：`npm run build:mini` 生成5个文件；`npm test` 为253 passed、0 failed/skipped/todo；`npm run check`、`npm run check:mini`、`git diff --check` 均退出0。
- 差异仅在阶段六白名单；`src/domain/*`、既有测试、路由、依赖、schema、存储和模拟器业务数据均未修改。

## Phase 6 selector compatibility repair

- `bills.wxss` 原第17、18、24行的 `text` 标签组合选择器已全部替换为 `.point-amount`、`.point-amount.negative`、`.series-item` 纯类选择器；对应WXML元素已补语义class。
- 全文件复查未再发现 `text` 标签选择器；统计逻辑、领域层、存储、路由、依赖和模拟器业务数据均未修改。
- 指定顺序验收通过：构建生成5个文件，253 passed、0 failed/skipped/todo，两个项目检查与 `git diff --check` 均退出0。
- Stable `2.01.2510290` 点击编译按钮后重新产生本次日志；禁用选择器告警已消失，Console为0 Errors且无 `timeout`。其余当前可见内容仅为自动热重载、SharedArrayBuffer、HarmonyOS兼容与灰度基础库环境提示，不将Warning数量写成固定验收值。

## Phase 7 kickoff

- 基线 HEAD `cf202edab7cb37f4664921cbd674a4605a41be01`，工作区干净，253 passed、0 failed/skipped/todo。
- `npm run check`、`npm run build:mini`、`npm run check:mini` 均退出0。
- 目标：接通完整JSON备份、CSV查看导出、原子恢复和精确清除，同时保持离线与原账安全。
- 顺序：规格/纯契约 → 文件适配与设置页 → ≥28项测试 → 反向红绿 → Stable非破坏验收 → 提交。
- 最大风险：主键替换中途失败导致数据丢失、超大文件卡死、恢复时提前执行计划，以及清除误伤无关键。
- Stable实测 `getFileSystemManager/chooseMessageFile/shareFileMessage/setClipboardData` 与文件管理器 `writeFile/readFile/stat/unlink/readdir` 均为函数，`wx.env.USER_DATA_PATH`为字符串；后备复制仍只允许用户主动点击。
- 边界：仅改阶段七白名单，不改领域、schema、路由、依赖、网络或模拟器业务数据；不采用与离线边界冲突的Coze远程工作流。

## Phase 7 implementation

- 应用层复用 `schemaVersion: 1`、领域 JSON 序列化和固定列 CSV；新增本地时间文件名、UTF-8 5 MiB 双重限制、中文预检摘要、重复标识与账户/周期/关联流水引用校验。旧 v0 备份以确定默认值补齐应用设置，schema 1 缺少应用设置则明确拒绝。
- 原子恢复先完整校验候选，再按“原主键读取→临时键写读→主键写读→清临时键”执行；失败时按实际写入阶段回滚并复核原主键，原主键首次读取失败时零写入零删除，回滚和清理均有一次重试与持续失败明示，恢复函数不运行到期计划。
- 设置页底部拆成“完整备份、恢复预览、CSV账单、危险操作、隐私说明”五个独立区块；支持主动生成、分享、手动复制、单个 JSON 选择、粘贴预检、“恢复”与“清除”双确认，文件写入失败仍保留显式复制后备，原始 JSON 预检后立即从页面展示状态移除。
- 精确清除只处理主键、恢复临时键和用户目录中两类严格匹配的生成文件，不使用 `clearStorage`，不扫描其他目录；任一存储键删除失败时回滚两键，避免半清除。
- 新增53项真实测试；单文件53 passed、0 failed/skipped/todo。覆盖适配器真实边界、扩展名与 stat 前置限流、必需字段、迁移、零副作用预检、恢复/回滚/清理失败和清除回滚；全量测试为306项。
- 收口反向验证再次把“主键写入失败仍保留原数据”的正确期望改成错误字符串；定向命令以0 passed / 1 failed变红，actual仍为 `{"original":true}`，还原后同命令1 passed / 0 failed。

## Phase 7 Stable acceptance

- Stable `2.01.2510290` 使用测试 AppID 重新加载；真实生成 `yongdu-backup-20260729-234538.json`（4.0 KiB）和 CSV（858 B），JSON/CSV用途提示正确，用户主动复制出现“内容已复制”反馈。
- `wx.chooseMessageFile` 真实打开系统文件选择器；先取消一次，再选择刚生成的 JSON。预检显示 schema `1 → 1`、CNY、6个账户、9笔流水、1个周期、0个计划、0个待确认项、最近流水 `2026-07-29`、生成时间未知，页面未显示 JSON 原文。
- 输入“恢复”和“清除”均真实进入最终确认弹窗并选择取消；取消后资产 ¥5700、负债 ¥4020、净资产 ¥1680、奖励 ¥0 保持不变，未执行恢复或删除。
- 完成审计后重新编译并清空旧 Console：Stable 当前为0 Errors，当前日志无 `timeout`；可见 Warning 为基础库灰度、SharedArrayBuffer 和 `WAWroker.js reportRealtimeAction` 等开发者工具环境提示，不是项目源码告警。
- Stable 的 `shareFileMessage` 明确返回“开发者工具暂时不支持此 API”，页面保留手动复制后备；未自动分享或上传。五张无 JSON 原文截图位于 `artifacts/phase7/`。
- 最终固定顺序验收：`npm run build:mini` 生成5个文件；`npm test` 为306 passed、0 failed/skipped/todo；`npm run check` 确认306个测试声明；`npm run check:mini` 与 `git diff --check` 均退出0。

## Phase 7 generated-file whitelist repair

- 基线：HEAD `da86bd6e40cd073a16edfe47a73a68a7d09ebaa9`，工作区干净；阶段七53/53、全量306/306通过，skip/todo均为0。
- 目标：把备份前缀只绑定 `.json`，把账单前缀只绑定 `.csv`；交叉扩展名一律不可写、不可删。
- 顺序：先补真实适配器边界红测 → 最小修改共享正则 → 临时还原故障正则验证红 → 恢复正确实现并全量验收 → 提交。
- 最大风险：写入与删除白名单分叉，或误删名称相似但不属于“用度”的用户文件。
- 边界：只修改 `data-files.js`、阶段七测试、`PROGRESS.md`、`BLOCKED.md`；不执行真实清除、恢复、分享或上传。
- 已新增3项真实边界测试，覆盖规范映射、交叉扩展名拒写零调用，以及混合文件列表仅删除两个规范文件。
- 最小修复只改共享正则，`writeGeneratedFile()` 与 `removeGeneratedFiles()` 继续复用同一规则。
- 反向验证：临时恢复旧正则后新增测试0 passed / 3 failed；恢复正确正则后3 passed / 0 failed。
- 最终验收：构建生成5个文件；阶段七56/56、全量309/309通过，failed/skipped/todo均为0；两个项目检查与 `git diff --check` 退出0。
- 提交：`fix: bind generated file extensions to prefixes`；最终提交号以本节所在提交的 `git log -1` 为准。

## Phase 8 release-readiness kickoff

- 基线：HEAD `5f0ab7deb43f2f51692b441e62e10c45815ad86b`，工作区干净；309/309通过，两个项目检查退出0。
- 目标：把初始化后设置页整理为四个互斥折叠分区，并补齐错误定位、文件忙碌锁、小屏、安全区、空状态和真实文档。
- 顺序：体验清单与红测 → 设置页交互骨架 → 四页兼容样式/空状态 → 文档同步 → 反向及全量验收 → Stable双设备非破坏验证。
- 最大风险：折叠重构使既有表单操作不可达，或异步锁在失败后未释放；其次是小屏长金额和错误文本溢出。
- 边界：只改阶段八白名单，不触碰领域、schema、路由、依赖、构建或现有模拟器业务数据。
- 未采用 Coze 远程项目工作流：本任务以现有本地仓库与 Stable 为唯一验收源，且禁止网络和白名单外状态。
- 发布检查清单已冻结8条非破坏路径；恢复和清除成功路径明确仅由自动化覆盖。
- 新增16项阶段八真实页面处理函数/契约测试；旧界面下0 passed / 16 failed，已证明折叠、忙碌锁、小屏与文档缺口。
- 设置页已改为四个互斥折叠分区，默认预算、可全部收起；标题摘要来自真实设置模型，业务错误和成功反馈回到所属分区。
- 文件生成、选择、分享、复制和清除文件步骤使用同一页面忙碌锁；重复触发不重复调用，成功或异常后均释放。
- 全局与四页已加入安全区、≤320px字段/金额换行、88rpx主按钮、页面级横向隐藏及真实空状态下一步。
- README、PRODUCT_SPEC与8路径发布清单已同步当前能力和首版排除项；阶段八16/16、全量325/325通过。
- 反向验证：临时把互斥切换后的正确期望 `assets` 改为 `plan`，定向测试0 passed / 1 failed；还原后相关定向测试2 passed / 0 failed。

## Phase 8 Stable acceptance

- Stable `2.01.2510290` 未清除、恢复、分享、注入或修改业务数据；在 iPhone 12/13 与 iPhone 5（320px）两种模拟设备上检查设置、首页、记账、账单四页，未见页面级横向溢出，底部操作可滚动到安全区内。
- 四个设置分区已真实验证默认展开预算、切换计划/资产/数据、再次折叠；摘要保持资产 ¥5700、负债 ¥4020、净资产 ¥1680，账单可控支出保持 ¥120，记账页仍显示上一笔同类 ¥120。
- 清空旧 Console 后点击 Stable 编译按钮重新编译；当前为0 Errors、4条开发者工具/基础库环境 Warning，当前日志无 `timeout`，没有隐藏或再次清空编译结果。
- 13张不含JSON原文的非破坏截图位于 `artifacts/phase8/`，覆盖四个折叠分区、四页、两种设备、真实汇总和编译后 Console。
- 最终固定顺序验收：`npm run build:mini` 生成5个文件；阶段八16/16、全量325/325通过，failed/skipped/todo均为0；`npm run check`、`npm run check:mini` 与 `git diff --check` 均退出0。

## Phase 9 home visual sample kickoff

- 基线：HEAD `54f3daa49b49de4759c7b4ca3e9bbc91b2e30772`，工作区干净；325 passed；build/check/check:mini 均通过。
- 目标：首页高保真样板 + 全局设计规范文档；不改业务逻辑与另三页。
- 顺序：冻结设计规范 → 重排首页 WXML/WXSS → ≥6 契约测试 → 反向与全量验收 → Stable 双尺寸非破坏截图。
- 最大风险：样式重构破坏绑定/导航/小屏可达；或视觉改动误触 home.js 与白名单外文件。

## Phase 9 implementation and acceptance

- 已创建 `docs/PHASE9_DESIGN_SYSTEM.md`：色板、字号、间距、组件层级、六种首页状态、三页复用与首页特例。
- 仅重排 `home.wxml` / `home.wxss`：今日可自由花为主焦点，记一笔唯一主 CTA，计划区空态弱化，320px 纵排与断行保留；未改 `home.js` 与业务逻辑。
- 新增 6 项 `tests/phase9-home-visual-contract.test.js` 契约测试；全量 331 passed、0 failed/skipped/todo。
- 反向验证：临时移除 `{{model.todayFree}}` 绑定后定向测试 5 passed / 1 failed；还原后 6 passed / 0 failed。
- `npm run build:mini` 生成 5 个文件；`npm run check`、`npm run check:mini`、`git diff --check` 退出 0。
- Stable 双尺寸真实截图因 CLI 服务端口关闭受阻，见 `BLOCKED.md` 第九阶段；风格是否通过须领导在 Stable 人工确认。

