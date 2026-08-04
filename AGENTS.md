# 项目级 Agent 规则

## 禁用 Coze CLI

- 本项目明确退出 `using-coze-cli` 的自动路由；小程序开发、迭代、预览、验收和部署均使用本地仓库及微信开发者工具完成。
- 禁止调用、安装、登录、配置或升级 `coze` 命令，也禁止使用 `coze code`、`coze session`、`coze generate`、`coze file` 及其远程项目能力。
- 禁止为本项目创建、关联、修改或部署任何 Coze 远程项目，也不得向 Coze 上传本项目文件。
- 仅在用户后续明确要求撤销本规则时，才可重新评估是否使用 Coze CLI；单纯提出小程序开发需求不构成授权。

## 视觉取证

- 日常首页验收使用 `npm run evidence:visual -- --compat` 和 `npm run evidence:visual`，机制以 `docs/VISUAL_EVIDENCE.md` 为准。
- 自动取证只允许使用 `.visual-qa`、`touristappid` 和独立 CLI/automator 会话；禁止传 `--auto-account`，禁止读取测试 AppID 的账本。
- Computer Use 截图不再是日常视觉迭代门禁；正式发布前的真实账本导出、恢复和真机冒烟仍需单独执行，不能由隔离 fixture 替代。
