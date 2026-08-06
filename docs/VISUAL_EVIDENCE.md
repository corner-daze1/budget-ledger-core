# 首页自动视觉取证

运行兼容性探针：

```text
npm run evidence:visual -- --compat
```

探针使用 Stable 当前登录会话，复制本地小程序到被 `.gitignore` 覆盖的 `.visual-qa`，仅把副本的 `project.config.json` 设置为 `touristappid`；QA 副本关闭 API Hook，避免开发者工具把内部 hook 对象误报成无消息 error。CLI 参数只启动自动化服务，不传 `--auto-account`；该参数是自动化账号选择，不是项目 AppID。

完整六态取证：

```text
npm run evidence:visual
```

命令用现有 domain/application API 构造并序列化六种隔离 fixture：`normal-accumulated`、`prepaid-recovery`、`empty-bills`、`cross-budget-period`、`ledger-overview`、`ledger-expanded`。fixture 写入 QA 实例的 `yongdu-ledger-v1`，调用真实 App 生命周期从 storage 恢复，再重新打开首页并读回校验后，生成六张 PNG、`console.jsonl` 和 `manifest.json`。manifest 包含场景、路由、AppID、系统信息、PNG 尺寸、字节数、SHA-256、时间范围和 storage 回读哈希；首页当前页面、展开态和账本滚动归零统一通过 `miniProgram.evaluate()` 取得 `getCurrentPages()` 的页面实例，调用真实 `enterLedger()`/`setData()`，再读回 `path`、`ledgerMode` 和 `ledgerScrollTop`，不调用 automator 的 `page.$`、`page.callMethod`、`page.data` 或 `page.scrollTop`。

`artifacts/visual-evidence/` 中的 PNG 是可复核的运行产物；有消息的 console error、exception、unhandled rejection 或 timeout 会使命令失败。Stable 当前版本在 automator 路由切换时会额外发送固定形态的 `type:error, args:[{}]` 空对象协议事件；脚本不删除它们，而是在 `console.jsonl` 原样保留并计入 `protocolArtifacts`，不把它们冒充应用错误。兼容性或运行失败会保留原始 CLI/automator 错误，不能用旧截图替代。

成功产物的生命周期有明确顺序：每次运行先删除本轮拥有的旧 PNG、`manifest.json`、`six-states-green.txt`；兼容性探针另行清理 `compatibility.json`、`sample.png` 和 `compatibility-error.txt`。运行、回读、截图、运行时错误检查和关闭全部成功后，才在关闭动作结束后写入 `console.jsonl`，再原子写入 manifest 和成功标记。关闭动作的成功返回不等于清理确认：脚本还必须核对精确指向 `.visual-qa` 的 CLI/包装进程及 `wxfilewatcher_x64.exe` 进程树已消失、当前自动化端口不可连接、Stable CLI close 已完成；任一项残留都返回 `confirmed:false`、保留错误并禁止重试。兼容性失败会写入新的 `compatibility-error.txt`，同时保留主错误、关闭错误、CLI stdout/stderr 和事件；成功时该 error 文件不存在。

`lifecycle-red.txt` 与 `lifecycle-green.txt` 是生命周期回归测试的实际红→绿摘要，不是运行截图或业务账本数据。

截图重试按会话隔离：一次 fixture 只在一个 CLI/automator runtime 中调用一次 screenshot；截图、页面通信或 transport 超时会先 `disconnect()`、终止 CLI，并以固定核验窗口执行 Stable CLI `close --project .visual-qa`，随后反复只处理精确 `.visual-qa`/诊断副本进程树并检查端口，确认旧会话完全退出后才用新端口重建。每个 fixture 最多 3 个独立会话，确定性的 fixture/storage、PNG、应用 runtime 或 console 错误不重试；第二个 fixture 重试不会重跑已经成功的第一个 fixture。单次 screenshot 超时为 30 秒，整条六态命令总时限为 12 分钟。预启动还会清理指定的诊断副本 `C:\Users\Administrator\AppData\Local\Temp\yongdu-phase11-diag-b9f5b75e6b3743ba9ba43ddaff8c4907\.visual-qa`；不会按通用进程名关闭 Stable 主窗口或其他项目。

六个 fixture 的 PNG 先写入本轮 `.session-run-*` 临时目录；只有六个场景都完成、各自会话都关闭且进程/端口清理结果已确认，才提升到最终文件并写入 manifest/green。manifest 的每个 capture 记录 `sessionAttempt`、`port`、`retrySummary`、storage 回读哈希和 PNG 哈希；清理失败会保留主错误与清理错误并以非零退出，禁止启动可能重叠的旧会话。

`session-retry-red.txt` 与 `session-retry-green.txt` 是独立会话重试回归测试的实际红→绿摘要。

这些隔离证据不能替代大版本发布前的真实账本真机冒烟测试。

## 截图协议诊断（2026-08-06）

当六态或兼容命令在截图请求处持续超时时，先运行：

```text
npm run evidence:visual -- --screenshot-diagnostic
```

该入口生成一个只含空白页的 `.visual-probe`，使用 `touristappid`，不复制当前项目业务代码。系统 Node 与 Stable 内置 Node 分层运行；每种 Node 最多两个新端口/新会话，每场依次记录连接、`currentPage`、`evaluate(() => 7)`、截图请求和清理。结果完整性要求包括每个阶段的起止时间、端口、PNG结果字段和进程/端口/CLI close核验；缺一项即判诊断结果无效。

只有某种 Node 的最小项目达到 2/2 截图成功且两场清理均确认，决策器才允许进入当前项目对照；否则禁止运行当前项目 A–C，也禁止把现象归罪首页。2026-08-06 的实际矩阵为系统 Node v24.16.0 `2场/0成功`、Stable Node v16.13.1 `2场/0成功`；四场均在 `App.captureScreenshot` 请求30秒超时，currentPage/evaluate均成功，cleanup均确认。结论限定为宿主/Stable/automator协议链路范围，不能从该实验唯一细分层次。原始矩阵见 `artifacts/visual-evidence/screenshot-diagnostic.json`，阶段日志见 `.log`；没有成功PNG，不生成占位图。

## D盘变量隔离严格两场实验（2026-08-06）

仅在用户授权后使用 `npm run evidence:visual -- --stable-single-instance-diagnostic`；入口固定 C 盘 `cli.bat` 和内置 `node.exe`，准备一个不含业务代码的空白 `touristappid` `.visual-probe`。C盘内置 Node 串行最多两场，每场只调用一次 `screenshot`；第一场清理未确认时立即停止，不启动第二场。worker 不准备或删除 `.visual-probe`，父进程在最终进程/端口核验确认后删除它。

每次结果只写入 `artifacts/visual-evidence/single-instance/result.json`、`run.log` 和同目录PNG，不覆盖既有 `screenshot-diagnostic.json/.log`。2026-08-06 实际运行两场，端口 `54962`、`60191` 不同；两场均完成 connect/currentPage/evaluate，截图均为 `TIMEOUT diagnostic screenshot after 30000ms`，cleanup 均 `confirmed:true`。预先冻结的决策为 `0/2 = D盘并存不是必要条件`，不能据此证明唯一根因，也不能归罪首页。D盘关闭、残留、端口、探针删除及旧诊断哈希核对见 `process-after-close.json` 与 `process-after-run.json`。

## App.captureScreenshot 协议定位（2026-08-06）

唯一真实命令为 `npm run evidence:visual -- --trace-screenshot-protocol`。它使用 C 盘 Stable 固定 `cli.bat` 与内置 Node、一个只含空白页的 `touristappid` `.visual-probe`，按 connect → currentPage → evaluate → systemInfo → screenshot 串行执行；截图超时后不再调用 runtime，立即 disconnect、终止 CLI、执行 close/精确进程与端口核验。worker 只运行这一场，不准备或删除探针。

本次实际结果：`screenshotRequestCount=1`、`diagnosticCompleted=true`、`screenshotSucceeded=false`、分类为 `sent-no-matching-reply`。协议调试流共解析17条、0条解析错误；观察到 UUID `4bb59914-6d9d-4d4b-bef7-9170b659f207` 的 `SEND ► App.captureScreenshot`，没有同 UUID `RECV`，截图后处理以30秒超时结束；5条 `App.logAdded type:error args:[{}]` 是后续收到的无UUID事件，不能冒充截图回复。

SEND 只证明客户端 automator 日志发出了请求，不证明 DevTools 已收到；本次没有把它写成成功，也没有据此修改业务/UI。原始 worker stdout/stderr、CLI stdout/stderr保存在 `artifacts/visual-evidence/protocol-trace/raw-protocol.log`；结构化结果在 `result.json`，进程恢复在 `process-before.json`、`process-after.json`，事实/推断/未知分开写在 `report.md`。清理确认、`.visual-probe`删除、端口关闭、精确自动化残留0；C盘工具进程30→30，D盘0→0。该实验到此停止，不重试。

该分类的唯一下一阶段建议是：取得用户另行授权后，继续使用同一空白探针，对另一个已核实来源和版本号的 C 盘 Stable 做一次受控版本对照。当前阶段不安装或切换工具版本，也不访问真实 AppID 账本。`protocol-trace-red.txt` 与 `protocol-trace-green.txt` 只保存了人工摘要，原始测试 stdout/stderr 未留存，不得把它们表述为原始红绿日志；协议本身的原始日志仍以 `raw-protocol.log` 为准。
