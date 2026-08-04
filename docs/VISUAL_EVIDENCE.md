# 首页自动视觉取证

运行兼容性探针：

```text
npm run evidence:visual -- --compat
```

探针使用 Stable 当前登录会话，复制本地小程序到被 `.gitignore` 覆盖的 `.visual-qa`，仅把副本的 `project.config.json` 设置为 `touristappid`；QA 副本关闭 API Hook，避免开发者工具把内部 hook 对象误报成无消息 error。CLI 参数只启动自动化服务，不传 `--auto-account`；该参数是自动化账号选择，不是项目 AppID。

完整取证：

```text
npm run evidence:visual
```

命令用现有 domain/application API 构造并序列化四种隔离 fixture（正常有余额、今日可花为 0 的预支、空账单、跨预算周期），写入 QA 实例的 `yongdu-ledger-v1`，调用真实 App 生命周期从 storage 恢复，再重新打开首页并读回校验后，生成四张 PNG、`console.jsonl` 和 `manifest.json`。manifest 包含场景、路由、AppID、系统信息、PNG 尺寸、字节数、SHA-256、时间范围和 storage 回读哈希；不使用 `page.setData` 或复制最终页面字段。

`artifacts/visual-evidence/` 中的 PNG 是可复核的运行产物；有消息的 console error、exception、unhandled rejection 或 timeout 会使命令失败。Stable 当前版本在 automator 路由切换时会额外发送固定形态的 `type:error, args:[{}]` 空对象协议事件；脚本不删除它们，而是在 `console.jsonl` 原样保留并计入 `protocolArtifacts`，不把它们冒充应用错误。兼容性或运行失败会保留原始 CLI/automator 错误，不能用旧截图替代。

成功产物的生命周期有明确顺序：每次运行先删除本轮拥有的旧 PNG、`manifest.json`、`four-states-green.txt`；兼容性探针另行清理 `compatibility.json`、`sample.png` 和 `compatibility-error.txt`。运行、回读、截图、运行时错误检查和关闭全部成功后，才在关闭动作结束后写入 `console.jsonl`，再原子写入 manifest 和成功标记。关闭失败会终止 CLI、以非零退出，并删除成功 JSON/PNG、manifest 和 green 文件；`console.jsonl` 会保留 `close-error` 及生命周期错误。兼容性失败会写入新的 `compatibility-error.txt`，同时保留主错误、关闭错误、CLI stdout/stderr 和事件；成功时该 error 文件不存在。

`lifecycle-red.txt` 与 `lifecycle-green.txt` 是生命周期回归测试的实际红→绿摘要，不是运行截图或业务账本数据。

截图重试按会话隔离：一次 fixture 只在一个 CLI/automator runtime 中调用一次 screenshot；截图、页面通信或 transport 超时会先 `disconnect()`、终止 CLI，并以短超时执行 Stable CLI `close --project .visual-qa`，确认旧会话退出后才用新端口重建。每个 fixture 最多 3 个独立会话，确定性的 fixture/storage、PNG、应用 runtime 或 console 错误不重试；第二个 fixture 重试不会重跑已经成功的第一个 fixture。单次 screenshot 超时为 30 秒，整条四态命令总时限为 12 分钟。

四个 fixture 的 PNG 先写入本轮 `.session-run-*` 临时目录；只有四个场景都完成、各自会话都关闭且关闭结果已确认，才提升到最终文件并写入 manifest/green。manifest 的每个 capture 记录 `sessionAttempt`、`port`、`retrySummary`、storage 回读哈希和 PNG 哈希；清理失败会保留主错误与清理错误并以非零退出，禁止启动可能重叠的旧会话。

`session-retry-red.txt` 与 `session-retry-green.txt` 是独立会话重试回归测试的实际红→绿摘要。

这些隔离证据不能替代大版本发布前的真实账本真机冒烟测试。
