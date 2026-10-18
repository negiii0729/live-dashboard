# live-dashboard

通用的观演记录网页。同一个网址载入不同的表格，就显示对应的统计。页面代码和观演数据分开：这个仓库只放代码和固定版本的第三方库。

## 本地预览

在仓库根目录运行：

```bash
python3 -m http.server
```

然后在浏览器打开 `http://127.0.0.1:8000/`。页面是纯静态文件，使用原生 ES Modules，不需要安装依赖，也不需要构建。

没有导入文件、地址里也没有 `?data=` 时，打开后会渲染 `examples/sample.csv` 这份虚构示例，并说明怎样换成自己的表。KPI、图表和表格来自 `app/render.js` 的 `render(stats, rows, participants, el)`。参与者姓名取自表头，「谁去了」按参与者生成：每位、一起（至少两位时）、仅每位。一位参与者时不出现「一起」。示例与否由这次的数据来源决定：只有落到内置示例时才标成示例。

票价卡片显示 `price_total`。默认口径是已看场次的 `price` 直接相加，并注明有几场无票价未计。页面不显示按人头再乘一次的估算。

## 载入自己的表

1. **本地文件。** 点「选择文件」，或把 CSV 拖进页面。内容存在这台浏览器的 localStorage 里，刷新后还在。点「清除数据」会删掉它，页面回到示例。
2. **链接。** `?data=` 后面接公开 CSV 的地址。GitHub raw（`raw.githubusercontent.com`）和 Gist raw 会返回允许浏览器直接读取的响应头，可以这样打开，例如 `http://127.0.0.1:8000/?data=https://raw.githubusercontent.com/<user>/<repo>/main/shows.csv`。`?config=` 接一份 JSON 配置，显示名和别名会进入统计。`?today=YYYY-MM-DD` 指定截止日期；不写则用浏览器当天。

`?data=` 和 `?fixture=` 都优先于浏览器里保存的表。没有这两项时才用已导入的文件。相对路径的 `?data=` 与 `?fixture=` 一样，只读本站文件。

链接打不开时页面留中文说明，不会变成空白：地址返回 404、浏览器拦截跨域请求，或 CSV 校验失败（日期不对、引号没有闭合等），都会写出原因。

`?fixture=` 仍用于临时查看仓库里的虚构夹具，只接受本站相对路径，例如 `http://127.0.0.1:8000/?fixture=tests/fixtures/participants-3.csv`。这不是正式导入，刷新后也不会写进 localStorage。

## 用自己的表对照数字

不要把真实观演表提交进这个仓库。把 CSV 放在仓库外，再跑：

```bash
node tools/preview_text.mjs /绝对路径/你的表.csv --today 2026-10-18
```

终端打印的 KPI、图表数字、筛选项和表格，与页面使用同一套函数。`--today` 要和对照用的截止日期相同。`--config config.json` 可选。对照时看 `price_total` 这一行，不要把它和按地区四舍五入后再加总的旧数字混在一起。

## 第三方库

`vendor/` 里的文件由本站提供。版本、来源 URL 和 sha256 记在 `vendor/VERSIONS.md`。

| 文件 | 版本 | npm 包内路径 |
| --- | --- | --- |
| `echarts-5.5.1.min.js` | 5.5.1 | `echarts` 的 `dist/echarts.min.js` |
| `papaparse-5.7.0.min.js` | 5.7.0 | `papaparse` 的 `papaparse.min.js` |

## 持续集成与部署

拉取请求会运行 CI，不限目标分支：用 Python 标准库核对 vendor 文件的 sha256 是否与 `VERSIONS.md` 一致，并执行 `node --test`。

推送到 `main` 时，部署工作流用 GitHub 官方 Pages actions 发布静态站点。Pages 的来源需要设为 GitHub Actions，这项仓库设置由管理员处理。
