# 当前待裁决与限制

更新时间：2026-08-11

## 阶段十六收尾

- 本任务无新增代码、测试、构建或数据恢复阻塞。视觉取证协议的既有阻塞仍按上文保留，未在本阶段运行或伪装为通过。

## 21–23号证据与状态恢复只读收口（2026-08-11）

- 21号备份证明与22/23号两张真实预支态截图均已存在并通过文件哈希、尺寸复核；未使用空账单截图或占位文件。
- 备份、恢复后、编译重载后和 Stable 重开后的状态哈希均匹配；本轮只读复核未新增阻塞。
- 证据为2026-08-09测试账本记录，其中备份为 `schemaVersion=1`；不把它表述为当前 schema v2 代码的重新验收。未重跑自动门禁、未改业务代码、未提交 Git。

## 现役阻塞

- 无新增代码、测试或构建阻塞；自动截图仍阻塞于 C 盘 Stable/automator 的 `App.captureScreenshot` 一次 SEND 无同 UUID RECV，不能称为自动取证通过，也不能归罪首页。
- Computer Use 的 `sky.get_window_state` 对 Stable NW.js 窗口仍返回所有权矛盾；21–23号已改用当前可见 Stable 窗口的 Win32 手工链路完成，但该问题仍阻塞 Computer Use 自动读取。
- 应用内“清除”当前真实失败并保留原数据：Stable 中 `wx.getStorageSync` 对已删除键读回空字符串，而 `clearLocalLedger` 只把 `undefined/null` 判为删除成功。本轮按“不改业务代码”边界未修，证据中的定向控制台清除不得冒充应用功能通过。
- 首页第二版仍待产品方视觉审阅。这是产品决策事项，不是实现失败；确认前不铺开另外三页的内容重绘。
- 唯一下一阶段建议是取得用户另行授权后，用同一空白探针对另一个已核实来源和版本号的 C 盘 Stable 做受控版本对照；未授权前不安装、切换或重跑。

## 阶段十一取证修复任务（2026-08-06）

- 任务0基线已匹配：HEAD `42770e64c42dc3a826c52cc37db07d2d3ccfd9af`，`miniprogram-automator@0.12.1`，视觉脚本22项、全量389项、检查器392 declarations，`check:mini`退出0。
- 先取得真实红证据：`artifacts/visual-evidence/phase11-runtime-cleanup-red.txt`，旧实现22项中20 pass、2 fail，失败分别是缺少 evaluate 页面实例通道和清理核验。
- 页面实例通道现已改为 `miniProgram.evaluate()` 内的真实 `getCurrentPages()`、`enterLedger()`、`setData()` 与状态读回；新增测试确认页面对象没有 `page.$`/`page.callMethod`，仍读回 `ledgerMode=expanded`、`ledgerScrollTop=0`。
- 清理核验已覆盖精确 `.visual-qa`/指定诊断副本、CLI/包装进程、`wxfilewatcher_x64.exe`、当前端口和 CLI close；全六态运行的三次 normal 会话均记录 `confirmed:true` 清理，未发现残留自动化进程。
- 兼容探针本轮三次命令均未通过：每次 `empty-bills` 截图在30秒超时；原始失败保存在 `artifacts/visual-evidence/compatibility/compatibility-error.txt`。前两轮清理各有一次端口/进程未确认，第三轮 watcher 残留被真实记录；没有生成兼容成功 JSON/样图。
- 全六态命令只运行一轮；`normal-accumulated` 在3个新鲜会话均 `TIMEOUT screenshot ... after 30000ms`，命令退出1。原始 `console.jsonl` 保留，三次清理均真实确认；未生成六张 PNG、`manifest.json` 或 `six-states-green.txt`。
- 该阶段当时的阻塞为 Stable/automator 的 `App.captureScreenshot` 请求持续悬挂，不是清理成功判断；禁止增加重试、伪造截图/manifest/green 或把旧证据升格。测试账本21–23号与状态恢复后来已于2026-08-09用手工链路完成，自动截图阻塞仍独立存在。

## 发布前待完成

- 隔离自动取证不能替代真实账本的数据安全验证。正式发布前需在用户明确授权的环境中完成 JSON 导出、恢复、关闭重开和真机冒烟。
- 首版尚无正式小程序主体和生产 AppID；当前 `wx9567fb4ff6336d0b` 是测试 ID，不得把自动取证数据写入其中。
- 测试账本的21–23号证据及恢复闭环已于2026-08-09完成；正式发布环境仍需另做生产数据导出/恢复和真机冒烟，不能由本次测试 AppID 证据替代。

## 21–23号证据续做记录（2026-08-06）

- Stable 重开后，最新 `list_apps()` 与 `list_windows()` 都只返回一个项目窗口（ID `2887566`）；对两种新鲜句柄以及一次 `get_window()` 重新绑定句柄的状态读取均失败。
- 三次原始错误均为：`window id 2887566 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`。
- 由于当前状态不可验证，未执行导出、预支、恢复或清除，未访问测试 AppID 账本；`artifacts/phase9/21-private-backup-proof.txt`、`22-home-prepaid-top-iphone12-13.png`、`23-home-prepaid-top-iphone5-320.png` 继续缺失，未用占位文件补齐。
- 状态恢复仍不能声称 `match=true`；历史 `artifacts/phase9/17-state-restore-check.txt` 只作参考。本轮未重跑已完成自动门禁，未改业务代码、测试、配置或数据文件，未提交 Git。

## 21–23号证据最终收口（2026-08-06）

- Stable 重开后使用全新的桌面控制会话重新选择窗口；`list_apps()` 与 `list_windows()` 均只返回项目窗口 ID `2887566`。
- 对该新鲜窗口句柄执行 `get_window_state()`（含截图、仅文本）、直接窗口句柄读取，以及激活后重新发现再读取，全部返回同一错误：`window id 2887566 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`。
- 这是当前可验证的事实，不是对 UI 内容的推测；因此没有执行导出、预支、恢复或清除，没有访问测试 AppID 账本，也没有生成占位证据。
- `artifacts/phase9/21-private-backup-proof.txt`、`22-home-prepaid-top-iphone12-13.png`、`23-home-prepaid-top-iphone5-320.png` 仍缺失；历史 `17-state-restore-check.txt` 仍仅作参考，状态恢复 `match=true` 未验证。
- 本轮只完成文档收口；按要求未重跑已完成自动门禁，未修改业务代码、测试、配置或数据文件，未提交 Git。窗口绑定问题仍为外部阻塞。

## 阶段十一取证修复任务0复核（2026-08-06）

- 按任务书运行了全部任务0命令。HEAD 与依赖匹配：`42770e64c42dc3a826c52cc37db07d2d3ccfd9af`、`miniprogram-automator@0.12.1`；但测试数字与任务书基线不匹配，因此没有进入任务1–3。
- 原始输出摘要：

```text
node --test tests/visual-evidence.test.js
ℹ tests 22
ℹ pass 22
ℹ fail 0
ℹ skipped 0
ℹ todo 0

npm test
ℹ tests 389
ℹ pass 389
ℹ fail 0
ℹ skipped 0
ℹ todo 0

npm run check
PROJECT CHECK PASSED: 392 test declarations, required spec sections present, domain boundary clean

npm run check:mini
MINIPROGRAM CHECK PASSED: four pages, generated application bundle, and source boundary are valid

npm run evidence:visual -- --hash-protected before
{"ok":true,"path":"artifacts/visual-evidence/protected-hashes-before.txt","protectedCount":112}
```

- 任务书期望为视觉20/20、全量387/387、check390；当前为22/22、389/389、392。该差异是已存在的任务1/2成果，不回退、不覆盖。
- `git status --short --branch` 首行为 `## master`，工作区非干净；精确匹配项目路径的 `cli.js auto` 残留进程本次实测为0。未修改业务代码、未提交 Git。

## 阶段十一截图诊断任务1结果（2026-08-06）

- 最小项目探针只包含一个空白页、`touristappid` 和独立 `.visual-probe`，没有复制当前项目业务代码；输出为 `artifacts/visual-evidence/screenshot-diagnostic.json` 与 `.log`。
- 系统Node `v24.16.0` 两场端口 `64066`、`63529`；Stable内置Node `v16.13.1` 两场端口 `61029`、`59968`。每场均记录 connect、currentPage、evaluate常量、screenshot、cleanup 起止时间。
- 四场均真实读回 `pages/index/index` 与常量7，四场均在 `App.captureScreenshot` 对应的截图请求处报 `TIMEOUT diagnostic screenshot after 30000ms`；无PNG成功结果，不把timeout写成截图成功。
- 四场清理均记录 `confirmed:true`、CLI close完成、残留进程0、端口不可连接；最终`.visual-probe`已删除，`.visual-probe/.visual-qa`精确匹配自动化进程数为0。因此当前截图超时没有新证据指向残留清理。
- 决策矩阵：system `2场/0成功`，stable `2场/0成功`，`minimal-probe-not-stable`；`continueCurrentProject=false`、`canDeclareApplicationIssue=false`。当前只能归因到宿主/Stable/automator协议链路范围，不能归罪当前首页，也不能唯一细分其中一层。
- 按任务书未运行当前项目A–C或六态命令；下一步建议仅在另行裁决后，对宿主/Stable截图通道做兼容性调查，不在本任务中升级依赖、改Stable设置或修改业务/UI。

## 阶段十一截图诊断最终验收（2026-08-06）

- 视觉测试真实为 `24/24`，全量测试真实为 `391/391`；两者均 `fail=0`、`skip=0`、`todo=0`。
- `npm run check` 退出0，报告 `394 test declarations, required spec sections present, domain boundary clean`。
- `npm run check:mini` 退出0；`npm run evidence:visual -- --compare-protected` 退出0，保护文件 `112/112`、`changed=[]`、`ok=true`。
- 最终只读残留核对为 `diagnosticValidation=true`、`probeRemoved=true`、`allResidualZero=true`、`allPortsClosed=true`、`matchingAutomationProcesses=0`、`probeDirectoryExists=false`。
- 阻塞仍是最小空白项目在系统Node和Stable内置Node各两场均截图超时；因此未进入当前项目A–C或六态取证，不能归罪应用。

## 已知但不阻塞

- Stable/automator 每个会话会发送固定形态的 `type:error, args:[{}]` 空对象协议事件。脚本原样记录并单列为 `protocolArtifacts`；应用 error、exception、warning、timeout 和 runtimeErrors 仍分别判定。该事件的官方来源尚未确认，禁止扩大忽略规则。
- 日常视觉验收已经改用 `.visual-qa`、`touristappid` 和独立 CLI/automator 会话，不依赖 Computer Use。
- `artifacts/visual-evidence/lifecycle-red.txt` 与 `session-retry-red.txt` 是报警器的反向验证证据，按设计保留，不是清理残留。

## 已解除

- `touristappid` 被误传给 `--auto-account` 的账号错误。
- 截图超时后复用同一 runtime 导致重试继续超时。
- 失败后遗留旧 PNG、manifest 或 green 标记的假成功风险。
- Tab 页使用 `redirectTo` 导致的自动取证冲突；当前首页 fixture 使用单一 `switchTab` 助手。
- 启动页 home-first 契约与小程序检查器旧页面顺序冲突；当前 app、测试与检查器统一为 home、settings、entry、bills。

## 证据边界

- 阶段十三最后一次自动视觉取证已生成兼容样图和四态首页证据，命令真实退出 0。
- 随后的启动页修复只调整页面声明顺序、对应测试和检查器，没有重跑视觉取证，也没有把旧证据伪装为新运行结果。
- 详细历史错误、窗口 ID 和中间测试数字保留在 Git 历史与 `artifacts/`，不再重复堆入现役文档。

## 阶段十二截图链路兼容性审计任务0（2026-08-06）

- 无新增阻塞。任务0基线通过：视觉24/24、全量391/391、check394、check:mini退出0、保护比较 `ok=true` 且112项。
- 本轮未启动截图会话，未改变工具、包、业务代码、测试或配置；既有最小探针失败矩阵继续作为后续只读交叉核对的输入。

## 阶段十二截图链路兼容性审计任务1来源核对（2026-08-06）

- 微信官方快速入门和 `miniProgram` API 页面均通过只读HTTP请求返回200并取得正文；未新增来源阻塞。
- npm 官方版本页直接请求返回原始错误 `Response status code does not indicate success: 403 (Forbidden).`；同一官方 npm registry 的只读 `npm view` 返回版本与发布时间，故未把版本表当作不可验证事实。

## 阶段十二截图链路兼容性审计任务2核对结果（2026-08-06）

- D盘副本的CLI无法在当前静态证据下作为候选：`cli.bat`调用的同目录 `node.exe` 缺失；未执行该CLI，未启动或改变工具状态。
- 基础库当前版本、两套工具CLI/HTTP开关现场状态、D盘副本注册渠道均未能从本轮只读证据确认，保留为未知，不外推因果。

## 阶段十二截图链路兼容性审计任务3收口（2026-08-06）

- 无新增阻塞。官方页面、安装文件、进程快照、包源码和既有诊断产物均已只读交叉核对；未启动截图会话。
- `sha256-before.txt` 与 `sha256-after.txt` 实测19项、0项变化；视觉24/24、全量391/391、check394、check:mini退出0、保护比较112/112且 `changed=[]`。
- 报告已明确：基础库版本、CLI/HTTP开关和D盘注册渠道未知；D盘CLI因缺少同目录Node不作为当前候选；唯一下一实验需用户先授权。

## 阶段十三保护哈希门禁修复最终结果（2026-08-06）

- 无新增阻塞。真实红证据仅为旧报告触发受保护范围 `112→113`；移动报告后真实绿证据为 `beforeCount=112`、`afterCount=112`、`changed=[]`、`ok=true`。
- 视觉24/24、全量391/391、check394、check:mini退出0、git diff --check退出0；skip/todo均为0，三个固定SHA-256保持不变。
- 旧报告已删除，新报告存在且无旧路径引用；本轮未修改业务代码、测试、脚本、依赖、配置或工具状态，未提交Git。

## 21–23号证据与状态恢复最终重试（2026-08-06）

- Stable 重开后新鲜 `list_apps()`、`list_windows()` 各只发现项目窗口 `2887566`；实际重试与原始错误已按当次对话输出记录。
- 对同一个新鲜窗口对象执行 `get_window_state`、`get_window`、`activate_window`，均返回窗口所有权矛盾：`window id 2887566 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`。
- 因 UI 状态不能可信读取，本次没有点击导出、预支、恢复或清除，没有访问测试 AppID 账本；21–23 号三个交付文件仍不存在，没有生成占位文件。
- 状态恢复仍不能声称 `match=true`；历史 `17-state-restore-check.txt` 仅作参考。按边界未重跑已完成自动门禁，未修改业务代码、测试、配置或数据文件，未提交 Git；外部阻塞仍是 Stable 窗口绑定。

## 阶段十四D盘变量隔离任务3结果（2026-08-06）

- 无新增实验阻塞。D盘工具已按授权临时关闭；C盘Stable严格两场实验完成，结果为 `0/2` 截图成功，cleanup两场均确认，D盘并存不是必要条件。
- 截图请求仍在空白最小项目的 `App.captureScreenshot` 处各超时30秒；证据只支持宿主/C盘Stable/automator协议链路范围，不能唯一归因，也不能归罪首页。按规则不追加实验。
- 本任务书正文给出的旧诊断 JSON 字符串 `0948F7C16590E4B593CF57A880CFC721363E01F6952C8A48F61060539F13838` 长度为63，不可能是SHA-256；现场文件和任务0/PROGRESS中的有效64位基线是末尾带 `A` 的 `0948F7C16590E4B593CF57A880CFC721363E01F6952C8A48F61060539F13838A`。已在 `process-after-run.json` 按有效64位值记录，未修改旧文件。

## 阶段十五协议定位结果（2026-08-06）

- 唯一真实命令 `npm run evidence:visual -- --trace-screenshot-protocol` 已运行一次；使用 C 盘 Stable、空白 `touristappid` `.visual-probe`，未访问真实 AppID 账本、未使用 Computer Use、未重试、未修改业务代码。
- connect/currentPage/evaluate/systemInfo 均成功；唯一一次截图请求在 `App.captureScreenshot` 发出后30秒超时。协议流实际解析17条、0解析错误：观察到 SEND UUID `4bb59914-6d9d-4d4b-bef7-9170b659f207`，没有同 UUID RECV，分类冻结为 `sent-no-matching-reply`；5条无UUID `App.logAdded type:error args:[{}]` 不作为截图回复。
- 本次 `diagnosticCompleted=true`、`screenshotSucceeded=false`；清理 `confirmed=true`、CLI close完成、残留进程0、端口关闭、`.visual-probe`已删除；进程恢复为 C盘工具30→30、D盘0→0、精确自动化残留0。原始与结构化证据在 `artifacts/visual-evidence/protocol-trace/`。
- 当前阻塞仍限定为 C盘 Stable/automator 的截图协议请求无匹配回复；SEND不是DevTools已收到的证明。按任务边界停止，不把该证据扩大为业务/UI结论，不追加实验。
- 证据完整性限制：`protocol-trace-red.txt`与`protocol-trace-green.txt`仅为人工摘要，原始测试stdout/stderr未留存，不能追溯性地宣称原始红绿日志完整；这不改变`raw-protocol.log`中一次截图SEND、零条同UUID回复及清理确认的协议事实。
- 唯一下一阶段建议：取得用户另行授权后，用同一空白`touristappid`探针对另一个已核实来源和版本号的C盘Stable做受控版本对照；本轮未安装、切换或重跑。

## 21–23号证据与状态恢复完成（2026-08-09）

- 新鲜 Stable 窗口 ID 为 `396752`；`sky.get_window_state` 仍报同所有者字符串的窗口绑定错误。Win32 手工输入与窗口截屏可用，因此本轮完成了证据，但自动截图协议与 Computer Use 读取阻塞均未被修复或伪装为通过。
- 备份元数据、定向清除读回、恢复前后精确哈希与隐私清理见 `artifacts/phase9/21-private-backup-proof.txt`；恢复后和普通编译重载后的 SHA-256 均为 `b63cfc0f0dcba7c254c6b103852cd371c7126f2d42eced3a78815ed9d784a8a5`，与原状态一致。
- Stable 再次重开后，首页仍显示10笔流水与今日可自由花807.09元；存储仍为4615字符/4675字节且同一SHA-256，证明本次测试账本状态跨Stable重开保持一致。核对过程没有把原始JSON写入仓库，剪贴板已清空。
- 两张新证据为 `22-home-prepaid-top-iphone12-13.png`（428×835）和 `23-home-prepaid-top-iphone5-320.png`（320×504）；均来自当前可见模拟器的真实预支态，未使用空账单、历史图或占位文件。
- 应用内清除先真实失败并提示原数据已保留；经用户既有明确确认后，才定向移除两个用度键并通过应用 UI 恢复。该缺陷留待后续获准修改业务代码时修复，本轮未修改业务代码、测试或配置，未重跑已完成门禁，未提交 Git。
