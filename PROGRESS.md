# 当前进度

更新时间：2026-08-06

## 现役结论

- 当前分支为 `master`；阶段十一至十五的首页、取证、测试、文档和证据改动已纳入 2026-08-07 收口提交，不再把旧提交 `1411267` 当作现役实现基线。
- 当前参赛版支持动态累计预算、六类账户、周期计划与小程序内提醒、三张账单分析图、JSON 完整备份与恢复预检、CSV 账单导出。
- 小程序固定四页顺序为 home、settings、entry、bills。已初始化用户默认进入账本；首次无账本时由 `home.onShow` 切换到我的完成设置。
- 底部视觉导航固定为“账本｜记一笔｜我的”。只有账本和我的是 Tab；中央“记一笔”是动作入口，完整账单与分析从账本页“全部”进入。
- 首页第二版采用暖灰、松绿和预算刻度带，保留真实预算、积攒/预支、计划事件、错误、空状态及最多五笔近期账单。现役规范为 `docs/PHASE10_TDESIGN_UI_SPEC.md`。
- 自动截图尚未修复：空白 `touristappid` 协议定位只观察到一次 `App.captureScreenshot` SEND，没有同 UUID RECV，冻结分类为 `sent-no-matching-reply`；不得归罪首页或表述为自动取证通过。

## 已验证基线

- 视觉基础设施测试：33/33，fail/skip/todo 均为 0。
- 全量测试：400/400，fail/skip/todo 均为 0。
- `npm run check`：403 test declarations。
- `npm run check:mini`：退出 0。
- 保护比较：112→112、`changed=[]`；`git diff --check`退出 0，仅保留既有 LF/CRLF 转换提示。
- 协议原始日志与结构化结果一致：截图请求1次、匹配回复0次、清理确认、端口关闭、自动化残留0、`.visual-probe`删除。`protocol-trace-red.txt`与`protocol-trace-green.txt`仅为摘要，原始测试stdout/stderr未保留。

## 文档权威顺序

1. `docs/PRODUCT_SPEC.md`：现役产品与业务规则。
2. `docs/PHASE10_TDESIGN_UI_SPEC.md`：现役首页视觉与导航契约。
3. `docs/VISUAL_EVIDENCE.md`：自动视觉取证机制。
4. `docs/PHASE8_RELEASE_CHECKLIST.md`：发布前非破坏验收入口。
5. 其余阶段文档保留当时的决策背景；与现役文档冲突时不得覆盖上述现役口径。

## 下一步

1. 取得用户另行授权后，用同一空白探针对另一个已核实来源和版本号的 C 盘 Stable 做受控版本对照；未授权前不安装、切换或重跑。
2. 自动截图链路恢复后，由产品方审阅当前首页第二版；风格确认前不把内容重绘铺到我的、记账和账单分析三页。
3. 正式发布前另做真实账本 JSON 导出/恢复、关闭重开和真机冒烟；隔离 fixture 不能替代发布级数据安全验证。

## 已知限制

- 首页实现和静态门禁已通过；自动截图运行未通过，视觉细节也尚未获得产品方最终确认。
- 旧任务要求的 21–23 号真实 UI 证据仍未形成可信闭环；详情见 `BLOCKED.md`。它不再是日常视觉迭代门禁，但对应的发布级真实数据验证仍待完成。
- Computer Use 对 Stable NW.js 窗口仍返回所有权矛盾，不能作为自动截图替代方案。
- Stable/automator 在截图 SEND 后返回5条无UUID的 `App.logAdded type:error args:[{}]` 事件；它们不是截图回复，空参数也不足以识别错误原因。

## 阶段十一账本首页任务基线（2026-08-06）
- 目标：把首页收敛为预算概览态与全屏账本态两个停靠状态，展开后连续浏览全部流水。
- 顺序：先冻结契约并取得旧首页红证据，再实现首页状态/分组，最后修复取证滚动归零并做六图验收。
- 最大风险：展开滚动、返回与重复点账本不能破坏预算、提醒、结算和既有底栏导航。
- 约束：只改任务书白名单；领域、存储、设置/账单页、依赖、真实数据和既有视觉证据保持只读。

## 阶段十一契约红证据（2026-08-06）
- 已冻结两停靠态、全部流水、日期分组、日汇总、状态恢复、重复点账本和小屏契约。
- 旧首页按新目标真实变红：目标集合共69项，47 pass、22 fail，skip/todo均为0；失败集中在缺少账本分组、双停靠状态和新首页结构。
- 完整原始输出已保存为 `artifacts/visual-evidence/phase11-ledger-sheet-red.txt`；自此不放松断言。

## 历史任务2：21–23号证据与状态恢复最终收口（2026-08-06）
- Stable 已重新打开；新鲜 `list_apps()` 与随后 `list_windows()` 都只返回同一个项目窗口 `2887566`。
- 对 `list_apps()` 句柄、`list_windows()` 句柄以及 `get_window()` 重新绑定后的句柄分别读取状态，均复现同一原始错误：`window id 2887566 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`。
- 因没有可信的当前 UI 状态，本轮未点击导出、预支、恢复或清除，未访问测试 AppID 账本，未创建 `21-private-backup-proof.txt`、`22-home-prepaid-top-iphone12-13.png` 或 `23-home-prepaid-top-iphone5-320.png`，也未把历史 `17-state-restore-check.txt` 升格为本轮证据。
- 状态恢复仍为未验证；本轮未重跑已完成自动门禁，未修改业务代码、测试、配置或数据文件，未提交 Git；阻塞已同步到 `BLOCKED.md`。

## 阶段十一首页账本原型实现（2026-08-06）
- 首页已按冻结契约实现预算概览态与全屏账本态：全部流水由 `core.listRecentTransactions` 进入同一日期分组列表，概览固定可用空间，展开态接管滚动。
- 已覆盖收入、退款、固定/可控支出、转账、还款、借贷、投资的日汇总边界；保留结算、计划、逾期、待处理、错误和空状态入口。
- 目标测试完整绿证据已保存为 `artifacts/visual-evidence/phase11-ledger-sheet-green.txt`：69/69，fail/skip/todo 均为 0。

## 阶段十一取证滚动红证据（2026-08-06）
- 已先增加截图前页面与账本滚动归零、并读回为0的回归测试；旧脚本真实变红：`tests/visual-evidence.test.js` 共18项，17 pass、1 fail，skip/todo均为0。
- 完整原始输出已保存为 `artifacts/visual-evidence/phase11-visual-scroll-red.txt`；失败明确为尚未提供 `resetPageScrollForEvidence`，未放宽断言。

## 阶段十一取证滚动实现（2026-08-06）
- 已保留现有 `miniprogram-automator@0.12.1` 的 `pageScrollTo(0)` 与 `page.scrollTop()`；Stable 对 `Page.getWindowProperties` 无响应时，脚本改用小程序原生 `selectViewport().scrollOffset` 真实读回页面 viewport，账本仍用 `.ledger-scroll` 的 `scrollTo(0, 0)`。
- 新增账本概览/全屏两个真实 fixture；每个均包含三天、支出、收入、退款和转账。`tests/visual-evidence.test.js` 当前为20/20，fail/skip/todo均为0。
- 兼容探针已生成真实 `compatibility.json`：`ok:true`、390×753 样图、viewport 读回0、runtimeErrors为0；外层 npm 调用在产物落盘后仍被工具超时截断，未把它记为命令退出0。
- 六图自动取证已运行三轮但均失败；不把旧四图、旧 manifest 或旧 green 计为本轮证据。静态门禁继续执行不受影响的部分。

## 阶段十一取证 viewport 兜底（2026-08-06）
- 为不把 Stable 的固定协议超时误判为截图成功，取证脚本现在先通过真实 `wx.createSelectorQuery().selectViewport().scrollOffset` 读回页面滚动；只有该读回不可用时才调用 `page.scrollTop()`，两者都必须读回0。
- `node --test tests/visual-evidence.test.js`：20/20，fail/skip/todo均为0；兼容样图与六图运行结果分别按后续记录保存，未把脚本测试当作六图运行时通过。

## 阶段十一取证路由收口（2026-08-06）
- 三轮六图运行中，空流水兼容 fixture 已成功，但有流水的 `normal-accumulated` 每轮均连续三次截图超时；每次会话均确认清理。
- `writeAndReadFixture` 已通过唯一 `switchTab(HOME_ROUTE)` 完成首页路由，截图阶段不再重复 `reLaunch`，只读取当前页并断言路径；原因和替换已记录，未改页面业务代码。

## 阶段十一取证原生滚动样式收口（2026-08-06）
- 第二、三次六图运行在移除重复 `reLaunch`、删除子控件冗余 `overflow:hidden` 后仍于 `normal-accumulated` 截图超时；按三轮上限停止，不再用猜测继续改 UI。

## 阶段十一静态门禁结果（2026-08-06）
- `npm test`：386/386，fail/skip/todo均为0。
- `npm run check`：389 test declarations，退出0；`npm run check:mini`退出0；`git diff --check`退出0（仅换行符提示）。
- 保护范围核对 `git diff --exit-code 42770e6 -- src miniprogram/lib miniprogram/pages/bills miniprogram/pages/settings package.json package-lock.json project.config.json` 退出0。
- 兼容样图虽已真实生成，三轮六图命令均以 `TIMEOUT screenshot normal-accumulated after 30000ms` 退出1；无六张 PNG、manifest 或 green，因此任务3未满足，不能创建提交或宣称阶段十一完成。

## 阶段十一取证修复任务基线（2026-08-06）
- 目标：修复页面实例取证通道与严格 QA 进程/端口清理，不改业务代码、不提交 Git。
- 顺序：先补回归测试并取得旧实现红证据，再实现 evaluate 读回和清理核验，最后只跑规定的视觉与静态门禁。
- 最大风险：close/disconnect 表面成功但 `.visual-qa` 进程或端口残留，造成假绿或重试污染；残留时必须失败且不重试。
- 基线：HEAD `42770e64c42dc3a826c52cc37db07d2d3ccfd9af`，automator `0.12.1`，视觉20/20，全量387/387，check 390 declarations。

## 阶段十一取证修复结果（2026-08-06）
- 已先保存旧实现红证据 `artifacts/visual-evidence/phase11-runtime-cleanup-red.txt`：22项中20 pass、2 fail；现有视觉测试22/22，`npm test`为389/389，`npm run check`为392 declarations，`npm run check:mini`退出0。
- 取证滚动和展开现通过 `miniProgram.evaluate()` 的真实页面实例通道完成，测试覆盖无 `page.$`、`page.callMethod`、`page.data` automator API 时读回 `ledgerMode=expanded`、`ledgerScrollTop=0`。
- 清理逻辑已核对精确 `.visual-qa`/诊断副本、CLI包装进程、`wxfilewatcher_x64.exe`、端口与 CLI close；全六态本轮三次 normal 会话清理均 `confirmed:true`，结束后无匹配自动化进程。
- 兼容探针本轮三次命令均因 `empty-bills` 截图30秒超时退出1；全六态命令运行一轮，`normal-accumulated`三次新鲜会话均截图超时退出1。原始失败保留在 `artifacts/visual-evidence/compatibility/compatibility-error.txt` 与 `artifacts/visual-evidence/console.jsonl`。
- 未生成本轮六张PNG、`manifest.json`、`six-states-green.txt`或兼容成功JSON/样图；未把旧证据升格，未重跑21–23状态恢复，未改业务代码，未提交Git。当前阻塞与处理边界已同步至 `BLOCKED.md` 和 `docs/VISUAL_EVIDENCE.md`。

## 历史任务2：21–23号最终文档收口（2026-08-06）
- Stable 重开后重新建立了全新的桌面控制会话；`list_apps()` 与 `list_windows()` 均只发现项目窗口 `2887566`。
- 新鲜句柄的 `get_window_state()`、直接窗口句柄读取、仅文本读取，以及激活后重新发现再读取，均返回同一原始错误：`window id 2887566 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`。
- 因当前 UI 状态仍不可验证，本轮没有点击导出、预支、恢复或清除，没有访问测试 AppID 账本；21–23 号证据文件仍未创建，历史 `17-state-restore-check.txt` 未升格，`match=true` 仍不能声称。
- 按用户边界未重跑已完成自动门禁，未修改业务代码、测试、配置或数据文件，未提交 Git；本次真实阻塞已同步至 `BLOCKED.md`。

## 阶段十一取证修复任务0复核（2026-08-06）
- 目标仍是只修取证基础设施：先红证据，再 evaluate 页面实例与精确清理，最后六态真实验收；最大风险是把 close/disconnect 成功误报为清理完成。
- `git status --short --branch`：`## master`，工作区有既有阶段十一及文档/证据改动；`npm ls miniprogram-automator --depth=0`：`miniprogram-automator@0.12.1`。
- 任务书基线要求视觉20/20、全量387/387、check390；当前真实输出为视觉22/22、全量389/389、check392，测试数字不符，按任务书停止在任务0。
- 实测 `npm run check:mini` 退出0；`npm run evidence:visual -- --hash-protected before` 退出0，`protectedCount=112`；精确 `cli.js auto` 残留进程数为0（动态值）。
- 本轮未进入任务1–3，未改业务代码、测试或配置，未提交 Git；原始任务0输出已追加至 `BLOCKED.md`。

## 阶段十一截图诊断任务0（2026-08-06）
- 目标：用最小空白小程序分层判断 `App.captureScreenshot` 超时属于宿主 Node、Stable/automator 协议、启动链路还是现有取证步骤，不把失败归罪首页。
- 顺序：先补诊断入口与结果完整性报警器，再用系统 Node 最多两场；未达2/2时改用Stable内置Node最多两场；只有2/2稳定才进入当前项目A–C对照。
- 最大风险：复用挂起runtime、把单次成功写成稳定成功，或把清理命令成功误判成进程/端口已消失。
- 任务0实测：视觉22/22、全量389/389、check392、check:mini退出0；HEAD与automator依赖匹配，保护哈希前置`ok:true`且112项。
- 开始诊断时精确匹配本项目`cli.js auto`进程为0；本轮不改业务/UI、依赖或配置，不提交Git。

## 阶段十一截图诊断任务1实现（2026-08-06）
- 已新增最小截图探针结果完整性校验与2/2决策器；未满足最小项目稳定2/2时，决策器明确禁止继续当前项目探针或归罪应用。
- 先跑旧实现取得真实红证据：`artifacts/visual-evidence/phase11-screenshot-diagnostic-red.txt`，24项中22 pass、2 fail、skip/todo均为0。
- 实现后 `node --test tests/visual-evidence.test.js` 为24/24，fail/skip/todo均为0；最小探针随后按规定分层运行，每个Node最多两场。

## 阶段十一截图诊断任务1结果（2026-08-06）
- `npm run evidence:visual -- --screenshot-diagnostic` 真实退出0，生成 `artifacts/visual-evidence/screenshot-diagnostic.json` 与 `.log`；结果校验`validation.ok=true`。
- 系统Node `v24.16.0` 使用端口 `64066`、`63529` 两个新会话；Stable内置Node `v16.13.1` 使用端口 `61029`、`59968` 两个新会话。
- 四场均成功连接最小空白页 `pages/index/index`，`evaluate(() => 7)`真实读回7；四场截图请求均为 `TIMEOUT diagnostic screenshot after 30000ms`，没有生成或伪造PNG。
- 四场cleanup均`confirmed:true`、CLI close完成、残留进程0、端口不可连接；最终`.visual-probe`已删除，精确匹配`.visual-probe/.visual-qa cli.js auto`进程为0。
- 决策为`minimal-probe-not-stable`、`continueCurrentProject=false`、`canDeclareApplicationIssue=false`；按分支规则不运行当前项目A–C，结论限定为宿主/Stable/automator协议链路不稳定，不能归罪首页。

## 阶段十一截图诊断最终静态验收（2026-08-06）
- 已有真实自动化结果：视觉测试 `24/24`，全量 `391/391`，均 `fail=0`、`skip=0`、`todo=0`。
- `npm run check` 真实退出0：`394 test declarations, required spec sections present, domain boundary clean`。
- `npm run check:mini` 真实退出0：四页面、生成应用包和源码边界检查通过。
- `npm run evidence:visual -- --compare-protected` 真实退出0：`beforeCount=112`、`afterCount=112`、`changed=[]`、`ok=true`。
- 最终只读残留核对：`diagnosticValidation=true`、`probeRemoved=true`、`allResidualZero=true`、`allPortsClosed=true`、`matchingAutomationProcesses=0`、`probeDirectoryExists=false`；`git status --short --branch` 仅显示既有工作区改动与本轮白名单文件，未提交Git。
- 诊断分支已按最小探针不稳定结论闭合；未运行当前项目A–C或六态截图，不改业务代码、依赖、配置，不提交Git。

## 阶段十二截图链路兼容性审计任务0（2026-08-06）
- 已读取本文件与 `BLOCKED.md` 后续跑；未重启截图会话，未触碰两套开发者工具。
- 基线命令实测：`HEAD=42770e64c42dc3a826c52cc37db07d2d3ccfd9af`；Node `v24.16.0`；npm `11.9.0`；`miniprogram-automator@0.12.1`。
- `node --test tests/visual-evidence.test.js`：24/24；`npm test`：391/391；两者 fail/skip/todo 均为0。
- `npm run check`：394 declarations、domain boundary clean；`npm run check:mini` 退出0。
- `npm run evidence:visual -- --compare-protected`：`beforeCount=112`、`afterCount=112`、`changed=[]`、`ok=true`。
- 既有诊断结论保持：系统Node与Stable Node各2场，currentPage/evaluate成功，截图0/4，cleanup4/4；本轮只做只读兼容性审计，不修代码、不提交Git。

## 阶段十二截图链路兼容性审计任务1（2026-08-06）
- 微信官方快速入门 `https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html` 实测HTTP 200：通用门槛为 Node.js `>8.0`、基础库 `>=2.7.3`、开发者工具 `>=1.02.1907232`，并要求开启 CLI/HTTP 调用。
- 微信官方 `https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/miniprogram.html` 实测HTTP 200：截图专属门槛为 automator `>=0.9.0`、基础库 `>=2.9.5`、开发者工具 `>=1.02.2001082`；仅开发者工具模拟器支持，客户端不可用。
- npm 官方版本数据 `npm view miniprogram-automator version time --json`：当前版本 `0.12.1`，最后发布 `2023-11-07T03:05:39.610Z`；本地安装同为 `0.12.1`。版本页未给出额外 Node/工具最低版本。
- 当前 Node `v24.16.0` 满足通用 Node 门槛；C盘注册工具 `2.01.2510290`、D盘副本文件版本 `2.02.0` 均高于数字版工具门槛，但基础库当前值与CLI/HTTP开关现场状态未记录。
- 版本门槛满足只证明文档条件，不证明本机截图运行通过；npm包发布时间久也不单独证明不兼容。既有最小项目截图实际仍为0/4。

## 阶段十二截图链路兼容性审计任务2（2026-08-06）
- C盘注册安装证据：卸载注册表 `DisplayVersion=2.01.2510290`、图标指向 `C:\Program Files (x86)\Tencent\微信web开发者工具\微信开发者工具.exe`；该目录 `cli.bat`、`cli.js`、`node.exe`、`node-18.exe` 和 `code\package.nw\js\common\cli\index.js` 均存在，文件版本分别为外壳 `1.03.0`、内置 Node `16.13.1/18.20.8`。
- D盘副本证据：`D:\微信\微信web开发者工具\微信开发者工具.exe` 文件版本 `2.02.0`，`cli.bat` 与 `cli.js` 存在；`cli.bat` 明确调用同目录 `node.exe`，但该文件不存在，递归也未找到 `node*.exe` 或 CLI `index.js`。D盘注册渠道未知，不能把文件版本等同为已注册安装。
- 进程快照 `2026-08-06T17:54:42.5015870+08:00`：C盘工具族30个进程、D盘副本2个进程同时存在；PID只代表该次快照，不写成恒定事实。
- 包源码 `node_modules/miniprogram-automator/out/MiniProgram.js` 实际为 `checkVersion()` 要求基础库至少2.7.3；`screenshot()` 无中间截图实现，直接 `send("App.captureScreenshot")`，成功后才按base64写入指定路径。
- 既有诊断JSON复核：最小 `touristappid` 空白页，system/stable各2场；四场 connect/currentPage/evaluate成功，screenshot均30秒TIMEOUT，cleanup均确认、残留0、端口关闭；决策 `minimal-probe-not-stable`，不能归罪首页。

## 阶段十二截图链路兼容性审计任务3收口（2026-08-06）
- 已新增 [artifacts/visual-evidence/compatibility-audit/report.md](artifacts/visual-evidence/compatibility-audit/report.md)，包含三份一手来源矩阵、C/D安装与进程矩阵、源码映射、最多六条带标签结论和唯一授权后下一实验。
- 已生成 `artifacts/visual-evidence/compatibility-audit/source-matrix.txt`、`local-matrix.txt`、`sha256-before.txt`、`sha256-after.txt`、`sha256-compare.txt`。
- SHA-256只读核对实测：`beforeCount=19`、`afterCount=19`、`changedCount=0`、`ok=true`；两份既有 `screenshot-diagnostic.json/.log`均在清单且前后一致。
- 收口门禁：`npm run check` 394 declarations通过；`npm run check:mini`退出0；`git diff --check`退出0（仅LF/CRLF提示）。视觉24/24、全量391/391及保护112/112来自任务0基线，因本轮未改代码/测试/依赖，未重跑截图或全量测试。
- 本轮仅新增白名单内兼容性报告与审计附件；开工时已存在的阶段十一工作区改动保留未碰；工具两套继续并存，未关闭、未升级、未执行D盘CLI，不提交Git。

## 阶段十三保护哈希门禁修复任务0（2026-08-06）
- 复核 `git status --short --branch`：`## master`，保留既有阶段十一工作区改动；未发现本轮任务开始前的其他新范围变化。
- 三个固定SHA-256实测一致：`protected-hashes-before.txt=D92A3918A1DC9EDA1E2C8B3DD2CCCD549275B34E89E716B8A7EF84BE8DD5E038`；诊断JSON=`0948F7C16590E4B593CF57A880CFC721363E01F6952C8A48F61060539F13838A`；诊断log=`58E69E9B8E8D47413285BB848A365D775491938D34FE6A2D16CD5FA1CD19689C`。
- `npm run evidence:visual -- --compare-protected`真实退出1，JSON为 `beforeCount=112`、`afterCount=113`、`changed=["docs/VISUAL_COMPATIBILITY_AUDIT.md"]`、`ok=false`；完整红证据已保存为 `artifacts/visual-evidence/compatibility-audit/protected-scope-red.txt`。

## 阶段十三保护哈希门禁修复任务1（2026-08-06）
- 已用 `apply_patch` 完成报告移动：旧 `docs/VISUAL_COMPATIBILITY_AUDIT.md` 删除，新 `artifacts/visual-evidence/compatibility-audit/report.md` 建立；正文结论未重写，仅修正诊断JSON相对链接和末尾附件引用。

## 阶段十三保护哈希门禁修复任务2最终验收（2026-08-06）
- 移动后真实保护比较退出0：`beforeCount=112`、`afterCount=112`、`changed=[]`、`ok=true`；完整绿证据已保存为 `artifacts/visual-evidence/compatibility-audit/protected-scope-green.txt`。
- `node --test tests/visual-evidence.test.js`：24/24，fail/skip/todo均为0；`npm test`：391/391，fail/skip/todo均为0。
- `npm run check`：394 declarations通过；`npm run check:mini`退出0；`git diff --check`退出0，仅有LF/CRLF提示。
- 最终路径核对：旧报告`oldExists=false`，新报告`newExists=true`，报告旧路径匹配0，诊断JSON相对链接2处；三个固定SHA-256再次一致。未启动截图、未关闭工具、未提交Git。

## 阶段十四D盘变量隔离任务0（2026-08-06）
- 目标：只通过临时关闭D盘工具，判断D盘并存是否是C盘Stable截图超时的必要条件；顺序为基线→严格两场入口→关闭D盘精确进程树→唯一一次实验→收口，最大风险是误杀C盘进程或在清理未确认时继续。
- 基线实测：视觉 `24/24`、全量 `391/391`、check `394`、check:mini退出0、保护比较 `beforeCount=112`、`afterCount=112`、`changed=[]`、`ok=true`。
- 旧诊断JSON/log固定SHA-256仍为 `0948F7C16590E4B593CF57A880CFC721363E01F6952C8A48F61060539F13838A`、`58E69E9B8E8D47413285BB848A365D775491938D34FE6A2D16CD5FA1CD19689C`。
- 进程快照已保存 `artifacts/visual-evidence/single-instance/process-before.json`：`2026-08-06T20:22:50.3985833+08:00`，C盘相关进程30、D盘相关进程2、精确 `.visual-probe/.visual-qa cli.js auto` 残留0；PID仅作快照。
- 任务0未关闭工具、未启动截图、未访问账本、未提交Git；D盘关闭动作留到任务2，严格两场入口先做红测。

## 历史任务2：21–23号证据与状态恢复最终重试（2026-08-06）
- Stable 重开后，新鲜 `list_apps()` 和 `list_windows()` 均只发现项目窗口 `2887566`；现场事实与原始错误已按当次对话输出记录。
- 对新鲜窗口分别执行 `get_window_state`、`get_window` 和 `activate_window` 的只读尝试，三次均返回同一窗口所有权矛盾错误；没有可信的 UI 状态可供操作或复核。
- 因此没有执行导出、预支、恢复或清除，没有访问测试 AppID 账本；21–23 号证据文件仍缺失，历史 `17-state-restore-check.txt` 未升格，状态恢复 `match=true` 仍未验证。
- 本轮仅完成重试记录与文档收口；未重跑已完成自动门禁，未修改业务代码、测试、配置或数据文件，未提交 Git。

## 阶段十四D盘变量隔离任务1（2026-08-06）
- 已先取得真实红证据 `artifacts/visual-evidence/single-instance/single-instance-red.txt`：严格入口新增4项前，视觉测试28项为24 pass、4 fail，失败均为尚未导出的入口/判定函数。
- 已实现固定 C 盘 `cli.bat` 与内置 `node.exe`、最小 `touristappid` 探针、独立 `single-instance` 输出目录、不同端口保护、清理未确认即停止和2/2、0/2、1/2判定；worker 不准备或删除 `.visual-probe`。
- 单测绿证据 `artifacts/visual-evidence/single-instance/single-instance-green.txt`：视觉测试28/28，fail/skip/todo均为0；尚未启动严格真实入口，D盘工具尚未关闭。

## 阶段十四D盘变量隔离任务2（2026-08-06）
- 关闭前重新解析到 D 盘相关进程2个：PID 33024 为明确调用 D 盘 `cli.bat` 的 `cmd.exe` 包装进程，PID 32716 为 D 盘工具本体；两者 `MainWindowHandle=0`，无可见窗口可正常关闭。
- 仅对上述已核实 PID 执行精确 `taskkill /PID /T /F`；33024 的树实际终止32716与33024，随后对已消失的32716得到“not found”，没有按进程名批量结束，也未触碰 C 盘。
- `artifacts/visual-evidence/single-instance/process-after-close.json` 已保存连续复核：D盘计数在 `20:38:22`、`20:38:25`、`20:38:27` 均为0；精确自动化残留均为0；C盘 CLI、内置 Node 和工具本体仍存在。
- D盘工具保持关闭；任务2通过，下一步只运行一次严格两场实验。

## 阶段十四D盘变量隔离任务3（2026-08-06）
- 唯一真实命令 `npm run evidence:visual -- --stable-single-instance-diagnostic` 外层运行一次并退出0；结果写入 `artifacts/visual-evidence/single-instance/result.json`，原始过程写入 `run.log`。
- C盘内置 Node `v16.13.1` 串行完成2场，端口为 `54962`、`60191`；两场 connect/currentPage/evaluate成功，截图均为 `TIMEOUT diagnostic screenshot after 30000ms`，没有生成PNG，cleanup均确认。
- 冻结判定严格落在 `stable-single-instance-0-of-2` / `d-coexistence-not-necessary`；不能据此证明唯一根因，也未运行当前项目A–C或六态取证。
- `process-after-run.json` 核对D盘0、精确自动化残留0、两端口关闭、`.visual-probe`不存在、C盘工具文件存在；旧诊断JSON/log的实际64位SHA-256保持为 `0948F7C16590E4B593CF57A880CFC721363E01F6952C8A48F61060539F13838A`、`58E69E9B8E8D47413285BB848A365D775491938D34FE6A2D16CD5FA1CD19689C`。
- 实验已闭合，D盘保持关闭；下一步只做规定的静态门禁与残留核对。

## 阶段十四最终静态收口（2026-08-06）
- 视觉测试 `node --test tests/visual-evidence.test.js`：28/28，fail/skip/todo均为0；`npm test`：395/395，fail/skip/todo均为0。
- `npm run check`：398 test declarations，退出0；`npm run check:mini`退出0。
- `npm run evidence:visual -- --compare-protected`：`beforeCount=112`、`afterCount=112`、`changed=[]`、`ok=true`；`git diff --check`退出0，仅有换行符提示。
- 最终产物核对：结果 `ok=true`、严格判定0/2、两场cleanup确认、PNG成功数0、总清理确认、探针删除；D盘保持关闭。未提交Git；工作区仍保留开工前既有改动及本任务白名单内改动。

## 阶段十五协议定位任务0（2026-08-06）
- 目标：只用一个全新 C 盘 Stable/空白 `touristappid` 会话追踪 `App.captureScreenshot` 的协议请求与响应，分类后停止，不修复截图。
- 顺序：静态门禁/六哈希/进程基线 → 协议解析测试红绿 → 唯一一次真实会话 → 原始与结构化证据、文档和最终门禁。
- 最大风险：把调试 SEND 当成工具已收到、超时后复用 runtime，或清理未确认仍继续；任一清理/匹配失败即 `trace-inconclusive` 并停止。
- 任务0基线：视觉28/28、全量395/395、check398、check:mini退出0、保护112/112且`changed=[]`。
- 六个固定SHA-256全部匹配；D盘进程0、精确自动化残留0、`.visual-probe`不存在；基线文件见 `artifacts/visual-evidence/protocol-trace/`。
- 任务1已完成：新增5项协议定位测试；现有`protocol-trace-red.txt`与`protocol-trace-green.txt`只保留人工摘要，原始测试stdout/stderr未留存，不能称为原始红绿证据。管理验收已独立复跑当前绿态为33/33，fail/skip/todo均为0。
- 任务2待做：仅运行一次真实协议会话并保存原始stdout/stderr、结构化结果、进程恢复和事实/推断/未知报告；未访问真实账本、未使用Computer Use、未提交Git。

## 阶段十五协议定位任务2（2026-08-06）
- 唯一真实命令 `npm run evidence:visual -- --trace-screenshot-protocol` 退出0；C盘 Stable 空白 `touristappid` 探针依次完成 connect/currentPage/evaluate/systemInfo，唯一一次截图请求在30秒处超时。
- 协议流实际解析17条、0解析错误；`App.captureScreenshot` SEND UUID `4bb59914-6d9d-4d4b-bef7-9170b659f207` 已观察到，同UUID RECV未观察到；5条无UUID `App.logAdded type:error args:[{}]` 未冒充截图回复。冻结分类：`sent-no-matching-reply`；`diagnosticCompleted=true`、`screenshotSucceeded=false`。
- 截图超时后未继续调用 runtime；cleanup `confirmed=true`、CLI close完成、残留0、端口关闭、`.visual-probe`删除。原始协议/worker stdout/stderr/CLI输出、结构化结果、process-before/after及报告均在`artifacts/visual-evidence/protocol-trace/`。

## 阶段十五协议定位任务3最终收口（2026-08-06）
- `npm test`：400/400，fail/skip/todo均为0；`npm run check`：403 declarations通过；`npm run check:mini`退出0。
- `npm run evidence:visual -- --compare-protected`：before112、after112、`changed=[]`、`ok=true`；`git diff --check`退出0，仅有既有LF/CRLF转换提示。
- 六项固定SHA-256再次全部Match=true：package.json、package-lock.json、`node_modules/miniprogram-automator/out/Connection.js`、`out/MiniProgram.js`、旧诊断JSON、旧诊断log；当前只读进程核对为C盘工具30、D盘0、精确自动化残留0、`.visual-probe=false`。
- Git仅保留既有工作区改动与本阶段白名单改动，分支`master`；未提交Git。协议定位到此停止，不修业务、不重试真实会话。
- 文档复核修正：协议报告已补记截图SEND后5条无UUID的`App.logAdded type:error args:[{}]`事件，并明确它们既不是截图回复，也不足以识别错误原因；唯一下一阶段建议为用户另行授权后使用同一空白探针对另一个已核实来源和版本号的C盘Stable做受控版本对照。本轮不重跑真实会话。

## 阶段十五知识收口（2026-08-06）

- 已纠正现役文档中的旧提交、旧测试数、干净工作区和“自动取证已通过”表述；`README.md`、`docs/PRODUCT_SPEC.md`、`AGENTS.md`、本文件与`BLOCKED.md`现统一为静态门禁通过、自动截图未修复。
- 全量测试400/400、check403、check:mini退出0、Markdown本地链接14份/0断链、`git diff --check`退出0。
- 首次保护比较按设计检出本轮获准修改的`AGENTS.md`、`README.md`、`docs/PRODUCT_SPEC.md`；验证内容后已刷新获准基线，再比较为112→112、`changed=[]`。
- `.visual-qa`曾包含70个文件、约758636字节且无匹配自动化进程；用户于2026-08-07明确确认清理后，已移入Windows回收站并复核项目路径不存在，可从回收站恢复。本轮未写长期记忆。
- 阶段十一至十五的现役实现、自动化测试、诊断证据和知识收口文件已在本次收口提交中统一归档。
