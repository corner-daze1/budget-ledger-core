# 当前待裁决与限制

更新时间：2026-08-11

## P0：本地清除功能缺陷

- Stable 已确认：删除不存在的微信存储键后，`wx.getStorageSync` 读回空字符串。当前 `clearLocalLedger` 只把 `undefined` / `null` 判为空，因此会把真实删除误判为失败并尝试恢复原数据。
- 影响：用户无法可靠完成应用内本地数据清除；控制台定向删除只是一份历史取证手段，不能冒充产品功能通过。
- 修复边界：统一规范缺键语义，只删除 `yongdu-ledger-v1`、恢复临时键和本应用生成文件；失败时原子回滚，不得调用全局 `clearStorage`，不得碰无关键。
- 验收：增加空字符串缺键回归测试，运行完整静态门禁，并在隔离账本中完成一次 Stable 清除验证。真实账本不在自动验收范围内。

## 外部工具阻塞

- 自动截图仍阻塞于 C 盘 Stable/automator：空白 `touristappid` 只观察到一次 `App.captureScreenshot` SEND，没有同 UUID RECV，冻结分类为 `sent-no-matching-reply`。这不能证明 DevTools 已收到请求，也不能归罪首页。
- Computer Use 对 Stable NW.js 窗口仍出现所有权矛盾。2026-08-09 的 21–23 号证据使用 Win32 手工链路完成，不代表 Computer Use 或 automator 截图恢复。
- 截图链路阻塞期间，不重复把 `npm run evidence:visual -- --compat` 或 `npm run evidence:visual` 当作日常门禁。机制与原始证据见 `docs/VISUAL_EVIDENCE.md` 和 `artifacts/visual-evidence/`。

## 发布前待完成

- 当前没有正式小程序主体和生产 AppID；`wx9567fb4ff6336d0b` 只是测试 ID。
- 正式发布前需在用户明确授权的环境中完成 schema v2 JSON 导出/恢复、关闭重开、真机冒烟和产品视觉确认。
- 隔离自动取证不能替代真实账本的数据安全验证；2026-08-09 的 21–23 号证据使用 schema v1，只能作为历史记录。

## 已知但不阻塞

- Stable/automator 会产生固定形态的无 UUID `App.logAdded type:error args:[{}]` 事件。现有脚本原样记录并单列，不能扩大忽略范围，也不能把它当作截图回复。
- 首页第二版尚未完成产品视觉终验。按当前战略，先完成剩余功能和已知缺陷，再继续另外三页的高保真重绘。
- `artifacts/visual-evidence/` 中名称含 `red` 的文件是报警器或红绿流程证据，不是待删除的失败残留。

## 已解除

- 账单修改、分次退款、退款撤销、普通撤销、历史调整、分析重述、CSV 与 schema v2 审计关系已经实现并通过 467/467 自动测试。
- 详情页已接入普通点击与左滑快捷入口，且保持唯一非 Tab 页。
- 版本 0 和版本 1 的恢复与迁移路径已删除；当前恢复只接受 schema v2。

详细历史错误、旧窗口 ID、中间测试数字和已经结束的阶段过程以 Git 历史及 `artifacts/` 为准，不再在本文件重复维护。
