# 截图链路兼容性审计

审计日期：2026-08-06（Asia/Shanghai）  
范围：核对文档门槛、安装文件、注册状态、进程快照、`miniprogram-automator` 包源码、既有最小探针产物，以及一次经授权的D盘变量隔离实验。实验只临时关闭D盘精确进程树，未升级、卸载、改设置或访问真实账本。

## 1. 一手来源矩阵

| 来源 | 原文要求 | 当前值 | 判断 |
|---|---|---|---|
| [微信自动化快速入门](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html)（2026-08-06 HTTP 200） | Node.js `>8.0`；基础库 `>=2.7.3`；开发者工具 `>=1.02.1907232`；开启 CLI/HTTP 调用 | Node `v24.16.0`；C盘注册版 `2.01.2510290`；D盘副本文件版本 `2.02.0`；基础库和开关未记录 | Node和工具数字门槛满足；其余未记录 |
| 微信 `miniProgram.screenshot`（[官方文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/miniprogram.html#miniProgram-screenshot)；2026-08-06 HTTP 200） | automator `>=0.9.0`；基础库 `>=2.9.5`；开发者工具 `>=1.02.2001082`；仅模拟器支持 | 本地包 `0.12.1`；C/D工具数字版本满足；基础库未记录；既有最小项目截图 `0/4` | 包和工具数字门槛满足；基础库未记录；现场不通过 |
| [npm `miniprogram-automator` 版本页](https://www.npmjs.com/package/miniprogram-automator?activeTab=versions)及官方 registry（2026-08-06） | 版本历史和发布信息 | 本地 `0.12.1`；官方只读查询显示 `0.12.1` 于 `2023-11-07T03:05:39.610Z` 发布；包 `package.json` 无 `engines` | 版本一致；发布时间久不等于不兼容 |

通用最低版本与截图最低版本不是同一条门槛。版本号达到门槛只说明文档条件满足，不能推出本机运行必然成功；包发布时间久也不能单独推出不兼容。

## 2. 本机矩阵

### 安装与注册

| 对象 | 只读证据 | 结论 |
|---|---|---|
| C盘注册安装 | 注册表 `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\微信开发者工具` 的 `DisplayVersion=2.01.2510290`；`cli.bat`、`cli.js`、`node.exe`、`node-18.exe` 和 `code\package.nw\js\common\cli\index.js` 存在 | CLI调用链的文件完整；外壳文件元数据为 `1.03.0`，内置 Node 为 `16.13.1/18.20.8`；外壳元数据不替代注册版本 |
| D盘副本 | `D:\微信\微信web开发者工具\微信开发者工具.exe` 文件版本 `2.02.0`；`cli.bat`、`cli.js` 存在；`cli.bat` 调用同目录 `node.exe` | 同目录 `node.exe` 不存在，递归也未发现 `node*.exe` 或 CLI `index.js`；D盘注册渠道未知，当前不能作为 `cli.bat` 候选 |
| 进程快照 | `Get-CimInstance Win32_Process` 于 `2026-08-06T17:54:42.5015870+08:00`：C盘工具族30个进程、D盘副本2个进程 | 两套工具同时存在；PID只是本次快照，不是恒定事实 |

### 包源码与既有产物

`node_modules/miniprogram-automator/out/MiniProgram.js` 的 `checkVersion()`要求基础库至少 `2.7.3`；`screenshot()`直接发送 `App.captureScreenshot`，拿到 `data` 后才在传入 `path` 时写 base64 文件，没有另一个本地截图实现可供绕过。源码SHA-256为 `b629c671a8f938b53f0b32825e661225b2496f4f2266a7eb748dbc08eada27bc`。

既有 [screenshot-diagnostic.json](../screenshot-diagnostic.json) 显示：最小空白 `touristappid` 项目、未复制业务代码；system Node 2场/0成功，Stable Node 2场/0成功。四场均完成 `connect`、`currentPage`、`evaluate`，四场 `screenshot` 均为 `TIMEOUT diagnostic screenshot after 30000ms`；四场 cleanup 均确认、残留进程0、端口关闭。决策为 `minimal-probe-not-stable`，没有进入当前项目探针。

经授权的C盘Stable严格两场实验另见 [single-instance/result.json](../single-instance/result.json)：固定使用C盘 `cli.bat` 与内置 Node `v16.13.1`，最小 `touristappid` 项目使用新端口 `54962`、`60191`；两场均完成 `connect`、`currentPage`、`evaluate`，两场 `screenshot` 均为 `TIMEOUT diagnostic screenshot after 30000ms`，两场 cleanup 均确认。实验结束D盘计数0、精确自动化残留0、两端口关闭且 `.visual-probe`已删除，过程核对见 [process-after-run.json](../single-instance/process-after-run.json)。

## 3. 结论（最多六条）

1. **[已确认事实] 官方数字门槛部分满足，整体门槛不能判定为全满足。**  Node、C/D工具数字版本和automator版本均高于对应门槛；基础库版本与CLI/HTTP开关状态没有现场记录。因此“版本满足”不能写成“环境满足”。来源：两份微信官方页面、npm registry；日期：2026-08-06；复跑：执行 `node --version`、`npm ls miniprogram-automator --depth=0`，读取C注册表并对C/D可执行文件取 `VersionInfo`，不启动工具。

2. **[已确认事实] 实际截图链路未通过。** 既有最小项目四场均在 `App.captureScreenshot` 请求处超时，成功阶段停在 `evaluate`，没有PNG成功证据；cleanup不是失败点。来源：[screenshot-diagnostic.json](../screenshot-diagnostic.json)及其日志；日期：2026-08-06；复跑：只读解析该JSON的四个session，核对五个stage、request错误和cleanup字段，禁止重跑截图。

3. **[合理推断] Node版本没有被单独排除。** 系统 Node `v24.16.0` 和 Stable 内置 Node `v16.13.1`在同一最小项目上都失败，降低了“单一调用Node版本导致失败”的解释力；但两次失败仍可能共享宿主、工具或协议层，不能宣称Node完全无关。来源：最小探针矩阵、C安装Node文件元数据；日期：2026-08-06；复跑：读取诊断JSON并核对C盘 `node.exe` 的 `VersionInfo`，不新增会话。

4. **[已确认事实/合理推断] 在D盘工具临时移除后，C盘Stable最小项目仍为0/2截图成功；D盘并存不是必要条件。** 两场使用不同端口，connect/currentPage/evaluate均成功，截图请求均30秒超时，cleanup均确认；这排除了“必须有D盘并存”这一必要条件，但不能证明唯一根因，也不能区分C盘Stable、宿主或automator协议层。来源：`single-instance/result.json`、`process-after-close.json`、`process-after-run.json`；日期：2026-08-06；复跑：本实验只运行一次，禁止追加会话。

5. **[已确认事实] D盘 CLI 当前不能作为候选入口。** D盘 `cli.bat`存在但调用的同目录 `node.exe`缺失，相关CLI `index.js`也未找到；D盘GUI可执行文件版本 `2.02.0`不等于其CLI链路可用，注册渠道也未知。来源：D盘文件元数据、`Test-Path`、注册表；日期：2026-08-06；复跑：只读读取D盘 `cli.bat`并检查其引用的文件，禁止执行该CLI。

6. **[已确认事实] 不能归罪当前首页。** 一个不含业务代码的空白项目也在相同截图请求阶段失败，故当前证据不支持“首页渲染或业务代码是必要原因”；同时证据仍不足以在宿主、C盘Stable、automator协议之间唯一归因。来源：最小项目配置和四场阶段矩阵；日期：2026-08-06；复跑：读取诊断JSON中的 `copiedBusinessCode=false`、stage顺序和四场timeout，禁止运行当前项目。

## 4. 唯一授权实验结果（2026-08-06）

已按授权临时退出D盘工具，保留C盘注册Stable单实例，用C盘内置 Node、全新端口和空白 `touristappid` 最小项目运行两场；入口为 `npm run evidence:visual -- --stable-single-instance-diagnostic`，外层只运行一次。实验保留每场阶段、原始截图错误、PNG失败字段、cleanup和端口核验，不访问真实账本。

- 实际结果为两场均失败（`0/2`）：按预先冻结的判定，D盘并存不是必要条件，问题仍落在C盘Stable/宿主/automator协议链路范围；仍不能归罪首页。
- 另两分支仅作冻结规则记录：`2/2`才是重要候选变量，`1/2`只能记为间歇性；本轮不追加实验。

证据明细和SHA-256前后清单见同目录审计附件；本轮没有修改业务代码、依赖或工具安装，严格入口及其回归测试仅改任务书允许的取证脚本与测试文件。
