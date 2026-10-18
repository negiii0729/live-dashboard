# live-dashboard

通用的观演记录网页。同一个网址载入不同的表格，就显示对应的统计。页面代码和观演数据分开：这个仓库只放代码和固定版本的第三方库。

## 本地预览

在仓库根目录运行：

```bash
python3 -m http.server
```

然后在浏览器打开 `http://127.0.0.1:8000/`。页面是纯静态文件，使用原生 ES Modules，不需要安装依赖，也不需要构建。

## 第三方库

`vendor/` 里的文件由本站提供。版本、来源 URL 和 sha256 记在 `vendor/VERSIONS.md`。

| 文件 | 版本 | npm 包内路径 |
| --- | --- | --- |
| `echarts-5.5.1.min.js` | 5.5.1 | `echarts` 的 `dist/echarts.min.js` |
| `papaparse-5.7.0.min.js` | 5.7.0 | `papaparse` 的 `papaparse.min.js` |

## 持续集成与部署

拉取请求会运行 CI，不限目标分支：用 Python 标准库核对 vendor 文件的 sha256 是否与 `VERSIONS.md` 一致，并执行 `node --test`。

推送到 `main` 时，部署工作流用 GitHub 官方 Pages actions 发布静态站点。Pages 的来源需要设为 GitHub Actions，这项仓库设置由管理员处理。
