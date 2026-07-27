第二阶段真实工具阻塞（已确认）

- `D:\微信\微信web开发者工具\cli.bat islogin --lang zh` 返回 `{"login":true}`；`open --project C:\Users\Administrator\Desktop\记账小程序 --lang zh` 退出码为 0，动态 HTTP 端口为 `51166`。
- `open --help` 和 `preview --help` 只暴露项目、AppID 和第三方 AppID 参数，没有游客/测试身份；项目只能保持空 AppID，不能猜测或伪造。
- 开发者工具真实渲染四页，但 Console 计数为 Errors 6、Warnings 2，并报告 `err_code=41002`、`webapi_getwxaasyncsecinfo:fail appid missing`。
- 因此不能诚实声称“控制台 0 错误”或完成带有效初始余额的真实保存/重启闭环；自动化应用层、生成包检查和真实页面截图仍继续完成。
- 后续安全恢复尝试：CLI `quit`→`open`、等待加载、再次 `open`、以及 `open --disable-gpu` 均退出码 0，但窗口持续白屏；未删除本地数据、未伪造 AppID、未提交私有配置。
