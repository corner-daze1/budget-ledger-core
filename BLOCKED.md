第二阶段真实工具阻塞（当前仍未解除）

- `project.config.json` 已使用测试 AppID `wx9567fb4ff6336d0b`；`cli.bat islogin --lang zh` 返回 `{"login":true}`，重新 `open` 退出码为 0。
- 已实际清理当前项目/AppID 的 storage、session、file、compile 缓存，并重新编译；清空旧 Console 后，当前面板未再出现 `timeout`，错误数为 0。
- 但模拟器仍显示 `./pages/settings/settings.wxml not found`；磁盘上的 `miniprogram/pages/settings/settings.wxml` 确实存在，且本阶段白名单禁止修改设置页和 `project.config.json`。因此不能继续真实点击“设置→记账→上一笔同类→账单→关闭重开”。
- 最新 WeappLog 进一步记录 `isMiniAppProject=false`，并把编译缓存键解析到 `C:\Users\Administrator\Desktop\记账小程序/pages/...`，漏掉实际的小程序根目录 `miniprogram/`；这是开发者工具未识别 `miniprogramRoot` 的外部工具状态，不能靠白名单内源码修复。
- 重新打开根项目后，当前 RC 2.02.2607271 的 Console 仍有 `import.meta`、`pages/settings/settings.js is not defined`、`41002 appid missing` 与 `routeTo appLaunch timeout`；因此不是只剩可豁免的环境 timeout。把现有 `miniprogram` 目录单独作为入口也被 CLI 明确拒绝：`请检查 project.config.json 是否存在及是否有效 (code 10)`；随后已恢复打开根项目。
- 以 `--disable-gpu` 重启并通过项目菜单重新加载也未改变 `isMiniAppProject=false` 或页面缺失错误；当前仍不能进入设置页，未清除任何非目标数据。
- 曾出现过的 `summer-compiler miss js file`、`import.meta` 与 AppID `41002` 记录已通过重启及定向缓存清理消失；没有隐藏错误或用清空 Console 伪造零错误。
- 四张闭环截图未更新；不能用旧空账单、人工注入数据或静态截图冒充完成。自动化测试、项目检查和生成包检查均已完成。
