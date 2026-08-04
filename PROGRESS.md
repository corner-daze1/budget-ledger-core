# 当前进度

更新时间：2026-08-04

## 现役结论

- 当前分支 `master`，HEAD `7bff64f`；工作区包含尚未提交的阶段九首页候选样板、自动视觉取证和文档改动，**不是干净工作区**。
- 当前参赛版支持动态累计预算、六类账户、周期计划与小程序内提醒、三张账单分析图、JSON 完整备份/恢复预检和 CSV 导出。
- 首页候选样板已展示预算刻度、积攒或预支恢复信息、“记一笔”和最多五笔近期账单；视觉规范见 `docs/PHASE9_DESIGN_SYSTEM.md`。
- 首页视觉尚未获得产品确认；确认前不得把该样式铺到设置、记账和账单分析三页。

## 自动视觉取证

- 日常验收入口为 `npm run evidence:visual -- --compat` 和 `npm run evidence:visual`，详细机制见 `docs/VISUAL_EVIDENCE.md`。
- 取证使用 `.visual-qa`、`touristappid` 和 `miniprogram-automator@0.12.1`；不传 `--auto-account`，不读取测试 AppID 的账本。
- 每个 fixture 使用独立 CLI/automator 会话。截图或通信超时会废弃旧 runtime、确认关闭后换新端口重试；确定性数据、PNG 或应用错误不会被重试掩盖。
- 当前四态证据位于 `artifacts/visual-evidence/`：正常积攒、预支恢复、空账单、跨预算周期。四张 PNG 均为 390×753，storage 与 fixture 哈希一致。
- `manifest.json` 当前为四个不同端口、`sessionAttempt=1`；应用 error、exception、warning、timeout 和 runtimeErrors 均为 0。每个会话的五条空对象协议事件原样计入 `protocolArtifacts`。

## 2026-08-04 实测基线

- `node --test tests/visual-evidence.test.js`：16/16。
- 永久挂起 screenshot 的独立暗测：30 秒后废弃端口 58001，并由端口 58002 成功完成，证明不是在同一 runtime 内重试。
- `npm test`：356/356，fail/skip/todo 均为 0。
- `npm run check`：359 test declarations。
- `npm run build:mini`：5 generated files；`npm run check:mini` 与 `git diff --check` 通过。
- 自动取证任务交付边界的保护文件 SHA-256 为 114→114、`changed=[]`；本次知识收尾随后按授权更新了 AGENTS、README 和产品规格，因此该任务级指纹不代表知识收尾后的整个工作区仍无文档变化。

## 下一步

1. 产品方审阅 `artifacts/visual-evidence/` 的正常、预支、空账单和跨周期首页图，决定首页视觉是否通过。
2. 通过后再单独规划另外三页的视觉统一；未通过则只迭代首页样板。
3. 正式发布前另做真实账本的导出、恢复和真机冒烟。隔离 fixture 适合日常回归，但不能替代发布级数据安全验证。

## 历史说明

- `--auto-account touristappid`、同一 runtime 内重复 screenshot、成功证据先于关闭落盘等问题均已修复，不再是现役阻塞。
- Computer Use 的 NW.js 窗口归属错误仍可能存在，但自动视觉取证已不依赖它；旧 21–23 人工证据不再作为日常视觉迭代门禁。
- 早期失败证据仍保留在 `artifacts/phase9/` 和 `artifacts/visual-evidence/*-red.txt`，是否删除等待用户确认。
