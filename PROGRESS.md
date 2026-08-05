# 当前进度

更新时间：2026-08-05

## 现役结论

- 当前分支 `master`；实测 HEAD 为 `9f8ad8e`，阶段十改动仍在工作区，任务书记录的 `ff89517` 差异见 `BLOCKED.md`，不能把工作区称为干净。
- 当前参赛版支持动态累计预算、六类账户、周期计划与小程序内提醒、三张账单分析图、JSON 完整备份/恢复预检和 CSV 导出。
- 首页第二版已展示预算刻度、积攒或预支恢复信息和最多五笔近期账单；规范见 `docs/PHASE10_TDESIGN_UI_SPEC.md`。
- 阶段十三已修通首页 Tab 取证路径：兼容性与四态自动取证均真实退出 0，四张新版首页 PNG、manifest 和 green 标记已生成。

## 自动视觉取证

- 日常验收入口为 `npm run evidence:visual -- --compat` 和 `npm run evidence:visual`，详细机制见 `docs/VISUAL_EVIDENCE.md`。
- 取证使用 `.visual-qa`、`touristappid` 和 `miniprogram-automator@0.12.1`；不传 `--auto-account`，不读取测试 AppID 的账本。
- 每个 fixture 使用独立 CLI/automator 会话。截图或通信超时会废弃旧 runtime、确认关闭后换新端口重试；确定性数据、PNG 或应用错误不会被重试掩盖。
- 上一轮失败后的旧成功 PNG/manifest 由标准脚本清除；本轮使用新 `.visual-qa`、`touristappid` 和独立端口真实生成四态证据，`manifest.json` 记录 4 个 fixture。
- 本轮协议空对象事件仍原样计入 `protocolArtifacts`，应用 error、exception、warning、timeout 和 runtimeErrors 均为 0；首页 fixture 使用单一 `switchTab('/pages/home/home')` 助手。

## 2026-08-04 实测基线

- `node --test tests/visual-evidence.test.js`：16/16。
- 永久挂起 screenshot 的独立暗测：30 秒后废弃端口 58001，并由端口 58002 成功完成，证明不是在同一 runtime 内重试。
- `npm test`：356/356，fail/skip/todo 均为 0。
- `npm run check`：359 test declarations。
- `npm run build:mini`：5 generated files；`npm run check:mini` 与 `git diff --check` 通过。
- 自动取证任务交付边界的保护文件 SHA-256 为 114→114、`changed=[]`；本次知识收尾随后按授权更新了 AGENTS、README 和产品规格，因此该任务级指纹不代表知识收尾后的整个工作区仍无文档变化。

## 下一步

1. 完成阶段十三要求的最终自动门禁、保护范围核对和 Git 提交。
2. 通过后再由产品方审阅首页视觉；本阶段不铺开另外三页的内容重绘。
3. 正式发布前另做真实账本的导出、恢复和真机冒烟；隔离 fixture 不能替代发布级数据安全验证。

## 历史说明

- `--auto-account touristappid`、同一 runtime 内重复 screenshot、成功证据先于关闭落盘等问题均已修复，不再是现役阻塞。
- Computer Use 的 NW.js 窗口归属错误仍可能存在，但自动视觉取证已不依赖它；旧 21–23 人工证据不再作为日常视觉迭代门禁。
- 2026-08-05 已按用户确认删除一次性会话残留、可重建的 `.visual-qa/` 和被替代的阶段九中间证据；`artifacts/visual-evidence/lifecycle-red.txt` 与 `session-retry-red.txt` 作为现役报警器的反向验证证据继续保留。

## 阶段十任务0基线（2026-08-05）

- 实测工作区干净，但 HEAD 为 `9f8ad8e`，与任务书记录的 `ff89517` 不同；该差异已写入 `BLOCKED.md`，不把未经核对的提交当作事实。
- `npm ci` 成功安装 77 packages；npm 报告 10 个依赖审计告警，未执行升级或修复。
- `npm run build:mini` 通过并生成5个文件；`npm test` 为356/356，fail/skip/todo均为0。
- `npm run check && npm run check:mini` 通过，check为359 declarations；基线满足进入阶段十白名单开发的门槛。
- 顺序：先冻结 PHASE10 规范，再建立 custom-tab-bar 与路由契约，随后重做首页并补测试，最后执行反向红→绿和视觉/保护核对。
- 最大风险：custom-tab-bar 与首次设置/恢复去向可能破坏既有导航；所有业务模型、fixture、取证脚本和存储格式保持只读。

## 阶段十实施进度（2026-08-05）

- 已冻结 `docs/PHASE10_TDESIGN_UI_SPEC.md`，建立本地 custom-tab-bar、暖灰/松绿首页第二版，并保留首页真实预算、计划、错误、空账单和最近五笔账单绑定。
- `app.json` 的 `tabBar.list` 只有首页、账单、管理；中央“记一笔”使用 `navigateTo`，tab 目的地使用 `switchTab`，entry 不进入 tab 列表。
- 页面数组保留既有阶段二固定顺序，是因为未授权的 `scripts/check-miniprogram.js` 明确校验该顺序；这不改变三项 tab 列表或首页入口行为。
- 中间目标回归：`node --test tests/phase9-home-visual-contract.test.js tests/phase10-navigation.test.js tests/miniprogram.test.js` 为 34/34；`npm run build:mini` 生成 5 个文件。
- 中间全量回归为 365/365、`check` 为 368 declarations；组件入口补齐后的最终数字见下方最终验收记录。
- 待做：阶段十导航真实路由反向红→绿、四态新版首页自动取证、`git diff --check`、`src/**`/`scripts/**` 基线保护核对和最终工作区审计。

## 阶段十最终验收记录（2026-08-05）

- 组件入口补充 `component: true` 后，最终 `npm test` 为 366/366，fail/skip/todo 均为 0；`npm run check` 为 369 declarations，`check:mini` 通过。
- `git diff --check` 和 `git diff --exit-code ff89517 -- src scripts` 均退出 0；未修改 `src/**` 或 `scripts/**`。
- `npm run evidence:visual -- --compat` 与 `npm run evidence:visual` 均以实际 `Uncaught [object Object]` 失败，失败输出保存在 `artifacts/visual-evidence/`；旧成功图已由标准清理删除，未冒充阶段十证据。
- 失败会话均确认关闭，临时 `.visual-qa/` 已在确认无进程使用后删除；当前唯一未满足项是自动视觉取证的 tab 页 `redirectTo` 兼容冲突。

## 历史任务2：21–23号证据续做（2026-08-05）

- 已重新读取本文件与 `BLOCKED.md`；本轮只处理真实 UI 备份、预支态两张图、UI 恢复核对和文档收尾，不重跑已完成门禁。
- Stable 唯一窗口可显示真实设置页截图（窗口 ID `4131396`），但可访问树为空；重绑定/激活反复出现窗口归属错误，输入后的状态无法形成可信闭环。
- 因此未点击导出、预支、恢复或清除；未访问测试 AppID 账本；未创建占位的 21/22/23 证据，也未修改业务代码、测试或配置。
- 21–23 与本轮恢复前后对照仍未完成，真实阻塞及原始错误保存在 `BLOCKED.md`；历史 `17-state-restore-check.txt` 不被冒充为本轮证据。

## 历史任务2：Stable 重开后复核（2026-08-05）

- 为排除旧句柄，已重启已核实的 Stable 主进程并以原用户数据目录重新打开项目；新项目窗可见，Computer Use 重新发现窗口 ID `2887566`。
- 新窗口的 `get_window_state(include_screenshot=true, include_text=true)` 仍原样返回：`window id 2887566 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`；改用 `wechatdevtools.exe` 进程标识后控制会话断开并返回 `node_repl exec context not found`。
- 本次没有点击导出、预支、恢复或清除，没有访问测试 AppID 账本；21/22/23 证据文件仍未创建，状态恢复仍只能判定为未验证，不能把历史 `17-state-restore-check.txt` 记为本轮通过。
- 本轮只更新进度与阻塞记录；未改业务代码、测试、配置或数据文件，未提交 Git。

## 历史任务2：21–23最终核对（2026-08-05）

- 按要求未重跑已完成的自动门禁；重新用 `list_apps()` 选择到唯一 Stable 窗口，返回窗口 ID `2887566`。
- 用该次返回的窗口对象读取状态仍失败，原始错误为：`window id 2887566 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`。
- 因没有可信的当前状态，本轮没有点击导出、预支、恢复或清除，没有访问测试 AppID 账本；21/22/23 仍无证据文件，状态恢复 `match=true` 仍未验证。
- 本轮只更新 `PROGRESS.md` 与 `BLOCKED.md`；未改业务代码、测试、配置或数据文件，未提交 Git。

## 历史任务2：21–23最终收尾（2026-08-05）

- Stable 重开后再次由 `list_apps()` 唯一选出项目窗口 `2887566`；按恢复规程重新绑定并读取状态仍返回同一 NW.js 所有权错误，第二次新鲜重选后重试也未改变结果。
- 因无法取得可信的当前 UI 状态，本轮没有点击导出、预支、恢复或清除，没有访问测试 AppID 账本；21/22/23 三个目标证据文件仍不存在。
- `artifacts/phase9/17-state-restore-check.txt` 的 `match=true` 明确保留为历史参考，不替代本轮恢复前后核对；本轮状态恢复仍为未验证。
- 本轮只收尾进度与阻塞文档；未重跑已完成自动门禁、未改业务代码/测试/配置/数据、未提交 Git。

## 阶段十导航收敛任务基线（2026-08-05）

- 新任务基线实测符合：HEAD `9f8ad8e`；上一轮阶段十改动仍在工作区；导航单测 10/10、视觉单测 16/16、全量 366/366，skip/todo 均为 0。
- 目标：把底栏收敛为“账本｜记一笔｜我的”，Tab 仅保留 home 与 settings，并让 bills 作为非 Tab 页面从账本进入。
- 顺序：先锁定三入口测试并留红证据，再改底栏/home 路由，随后修复取证首页 Tab 助手，最后做真实取证、全量门禁和一次提交。
- 最大风险：Tab 数量和来源栈改变可能破坏首次设置、恢复、返回路径；不改业务模型、存储、entry/bills/settings 页面内容。

## 阶段十三入口契约红证据（2026-08-05）

- 已先改 `tests/phase10-navigation.test.js`、`tests/miniprogram.test.js`、`tests/phase9-home-visual-contract.test.js` 与 PHASE10 规范，尚未改导航实现。
- 旧实现按要求真实变红：`node --test tests/phase10-navigation.test.js` 为 10 项、5 pass、5 fail、skip/todo 均为 0。
- 原始输出已保存为 `artifacts/visual-evidence/phase10-three-entry-red.txt`；失败覆盖 Tab 数量/文案、bills 中性选中、来源栈、三图标和 home 全部入口类型。

## 阶段十三入口契约实现（2026-08-05）

- `app.json` Tab 已收敛为 `home=账本`、`settings=我的`；bills 与 entry 保留为非 Tab 页面。
- custom-tab-bar 仅渲染账本、记一笔、我的三个图标/文字；我的页记账先 `switchTab` 账本并在成功回调中 `navigateTo` entry，账本页直接进入。
- home 的“全部”已改为 `navigateTo('/pages/bills/bills')`，既有预算、账单和页面业务绑定未改。
- 真实绿证据：`node --test tests/phase10-navigation.test.js` 为 10/10，fail/skip/todo 均为 0；原始输出已保存为 `artifacts/visual-evidence/phase10-three-entry-green.txt`。

## 阶段十三视觉路由红证据（2026-08-05）

- 已在 `tests/visual-evidence.test.js` 增加唯一回归：要求首页 fixture 路由只调用一次 `switchTab('/pages/home/home')`，禁止 `redirectTo`，并实际走 fixture 读回流程。
- 旧脚本真实变红：`node --test tests/visual-evidence.test.js` 为 17 项、16 pass、1 fail、skip/todo 均为 0，失败为缺少首页 Tab 助手。
- 原始输出已保存为 `artifacts/visual-evidence/phase10-visual-route-red.txt`。

## 阶段十三视觉路由实现（2026-08-05）

- 取证脚本新增并导出单一职责 `switchToHomeTab`，沿用 `withSessionTimeout`；fixture 读回流程已改为唯一的 `switchTab(HOME_ROUTE)`，不再调用首页 `redirectTo`。
- 视觉单测真实转绿：`node --test tests/visual-evidence.test.js` 为 17/17，fail/skip/todo 均为 0；原始输出已保存为 `artifacts/visual-evidence/phase10-visual-route-green.txt`。

## 阶段十三最终验收待提交（2026-08-05）

- `npm run evidence:visual -- --compat` 与 `npm run evidence:visual` 均真实退出 0；manifest 为 4 个 fixture，console errors/exceptions/warnings/timeouts/runtimeErrors 均为 0。
- 四张 PNG 已逐张查看，底栏严格为“账本｜记一笔｜我的”，账本选中，安全区完整，无第四图标、裁切或遮挡。
- 最终目标测试：导航 10/10、视觉 17/17；`npm test` 为 367/367，fail/skip/todo 均为 0。
- `npm run check`：370 test declarations；`npm run check:mini` 通过；`git diff --check` 退出 0（仅 CRLF 提示）。
- 保护审计：`git diff --exit-code 9f8ad8e -- src` 无输出；`git diff --name-only 9f8ad8e -- scripts` 仅 `scripts/visual-evidence.mjs`；依赖与项目配置无差异。
- 当前只剩按任务书创建 `feat: finish phase ten ledger navigation` 提交，提交后复核 Git 工作区状态。

## 启动页修复任务基线与红证据（2026-08-05）

- 任务 0 实测符合：HEAD `c604e8a`、工作区干净；目标测试 20/20；全量 367/367，skip/todo 均为 0。
- 目标：将 `app.json.pages` 固定为 home、settings、entry、bills；保留 home 无账本时 `switchTab` 到 settings 的首次设置流程。
- 顺序：先修改测试并验证旧配置变红，再改 app.json 与规范，最后做四个白名单文件验收和新提交。
- 最大风险：默认启动调整不能改变 Tab、视觉证据或首次设置行为；本轮不运行视觉取证。
- 红证据：目标测试 21 项、18 pass、3 fail、skip/todo 均为 0；失败为旧页面顺序与默认启动页断言，未改 app.json。

## 启动页修复已转绿（2026-08-05）

- `app.json.pages` 已改为 home、settings、entry、bills；TabBar内容、窗口配置和其他字段未改。
- 规范已补充：初始化用户默认从账本启动；首次无账本仍由 `home.onShow` 跳转到我的完成设置。
- 目标测试真实转绿：21/21，fail/skip/todo 均为 0；独立断言输出“默认启动页为账本”。

## 启动页总验收阻塞（2026-08-05）

- `npm test` 已真实达到 368/368，fail/skip/todo 均为 0；`npm run check` 已达到 371 declarations。
- `npm run check:mini` 确定性失败，原始输出：`MINIPROGRAM CHECK FAILED`、`app.json must declare the four phase-two pages in order`。
- 不可修改的 `scripts/check-miniprogram.js:47` 硬编码旧顺序 settings、home、entry、bills；本任务要求同一 `app.json` 为 home、settings、entry、bills，二者无法同时通过同一 `JSON.parse`。
- 按任务规矩停止，不修改脚本、不回滚启动契约、不提交 Git；真实阻塞已写入 `BLOCKED.md`。
- 不受影响的只读审计已通过：`git diff --check` 退出 0；相对 `c604e8a` 的 src/scripts/dependency/project config 与 `artifacts/visual-evidence/**` 均无差异；工作区仅有六个白名单文件改动。

## 启动页检查器同步任务基线（2026-08-05）
- 目标：让默认启动、导航测试与小程序检查器统一认定 home、settings、entry、bills。
- 顺序：只同步检查器两处口径，先绿检查，再用旧顺序反向变红并恢复。
- 最大风险：误改既有六文件成果或削弱严格页面顺序校验；视觉取证保持只读。

## 启动页检查器同步完成（2026-08-05）

- 检查器已严格改为 home、settings、entry、bills，并将失败文案改为 `ledger-first four-page order`；反向旧顺序真实退出 1，恢复后退出 0。
- 目标测试 `node --test tests/miniprogram.test.js tests/phase10-navigation.test.js`：21/21，fail/skip/todo 均为 0。
- `npm test`：368/368，fail/skip/todo 均为 0；`npm run check`：371 test declarations；`npm run check:mini`：退出 0。
- `git diff --check`：退出 0；相对 `c604e8a` 的 src、依赖、项目配置和视觉证据无差异，scripts 仅为 `scripts/check-miniprogram.js`。
- 本轮未运行视觉取证，既有六文件成果均保留；检查器冲突已解除，无新增未解决阻塞。
