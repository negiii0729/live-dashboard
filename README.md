# live-dashboard

通用的观演记录网页。同一个网址载入不同的表格，就显示对应的统计。页面代码和观演数据分开：这个仓库只放代码和固定版本的第三方库。

## 本地预览

在仓库根目录运行：

```bash
python3 -m http.server
```

然后在浏览器打开 `http://127.0.0.1:8000/`。页面是纯静态文件，使用原生 ES Modules，不需要安装依赖，也不需要构建。

打开后会渲染 `examples/sample.csv` 这份虚构示例。KPI、图表和表格来自 `app/render.js` 的 `render(stats, rows, participants, el)`。参与者姓名取自表头，「谁去了」按参与者生成：每位、一起（至少两位时）、仅每位。一位参与者时不出现「一起」。

票价卡片显示 `price_total`。默认口径是已看场次的 `price` 直接相加，并注明有几场无票价未计。页面不显示按人头再乘一次的估算。

仓库里的另一份虚构夹具可以用本站相对路径临时换上，例如 `http://127.0.0.1:8000/?fixture=tests/fixtures/participants-3.csv`。这只用于看 1 位或 3 位参与者的页面，不是正式的导入。本地选文件、`?data=` 和 `?today=` 还没做；页面上的截止日期是浏览器当天。

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
