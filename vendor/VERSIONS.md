# 第三方库版本

本目录中的文件随站点一起提供，页面不从 CDN 加载它们。替换文件时，同时更新对应的 sha256。

| 文件 | 版本 | 来源 URL | SHA-256 |
| --- | --- | --- | --- |
| `echarts-5.5.1.min.js` | 5.5.1 | https://registry.npmjs.org/echarts/-/echarts-5.5.1.tgz | `e84270bd0cd5bdf60fefc26d00c2a391cb2e81f4d26a7a9ee16185a54773a3cf` |
| `papaparse-5.7.0.min.js` | 5.7.0 | https://registry.npmjs.org/papaparse/-/papaparse-5.7.0.tgz | `4d5d2d6e3282b66aafaa5e6de8ca3ae06f8d3440111ae99c6a30f6c00cfac33e` |
| `xlsx-0.20.3.full.min.js` | 0.20.3 | https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js | `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` |

`echarts-5.5.1.min.js` 是 npm 包 `echarts@5.5.1` 里的 `dist/echarts.min.js`。
`papaparse-5.7.0.min.js` 是 npm 包 `papaparse@5.7.0` 里的 `papaparse.min.js`。
`xlsx-0.20.3.full.min.js` 是 SheetJS CE 0.20.3 的 `xlsx.full.min.js`（从 cdn.sheetjs.com 取得）。npm 上的 `xlsx` 停在 0.18.5，不要用那个包替换这一份。页面只在用户选择或拖入 `.xlsx` / `.xls` 时才加载它。
