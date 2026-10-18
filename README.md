# live-dashboard

通用的观演记录网页。同一个网址载入不同的表格，就显示对应的统计。页面代码和观演数据分开：这个仓库只放代码和固定版本的第三方库。

## 本地预览

在仓库根目录运行：

```bash
python3 -m http.server
```

然后在浏览器打开 `http://127.0.0.1:8000/`。页面是纯静态文件，使用原生 ES Modules，不需要安装依赖，也不需要构建。

没有导入文件、地址里也没有 `?data=` 时，打开后会渲染 `examples/sample.csv` 这份虚构示例，并说明怎样换成自己的表。KPI、图表和表格来自 `app/render.js` 的 `render(stats, rows, participants, el)`。参与者姓名取自表头，「谁去了」按参与者生成：每位、一起（至少两位时）、仅每位。一位参与者时不出现「一起」。示例与否由这次的数据来源决定：只有落到内置示例时才标成示例。

票价卡片显示合计，并注明有几场无票价未计。口径和币种见下文。页面不显示把票价再乘一次人数的估算。

## 载入自己的表

1. **本地文件。** 点「选择文件」，或把 CSV、Excel（`.xlsx` / `.xls`）拖进页面。Excel 只读第一个工作表，转成 CSV 后再走同一套校验；SheetJS 只在这时加载。内容存在这台浏览器的 localStorage 里，刷新后还在。点「清除数据」会删掉它，页面回到示例。
2. **链接。** `?data=` 后面接公开 CSV 的地址。GitHub raw（`raw.githubusercontent.com`）和 Gist raw 会返回允许浏览器直接读取的响应头，可以这样打开，例如 `http://127.0.0.1:8000/?data=https://raw.githubusercontent.com/<user>/<repo>/main/shows.csv`。`?config=` 接一份 JSON 配置，显示名和别名会进入统计。`?today=YYYY-MM-DD` 指定截止日期；不写则用浏览器当天。

`?data=` 和 `?fixture=` 都优先于浏览器里保存的表。没有这两项时才用已导入的文件。相对路径的 `?data=` 与 `?fixture=` 一样，只读本站文件。`?config=` 里的 `price_mode` 和 `currency` 会进入这次统计和票价卡片。

## 票价口径和币种

`price_mode` 决定已看场次的 `price` 怎么加总，默认 `total`：

- `total`：`price` 直接相加。
- `per_person`：每一场先乘上该场 ✅ 的人数，再相加。无票价的场次两种口径都不计，卡片写「N 场无票价未计」。

只接受这两个值。别的字符串会报「未知的 price_mode…」，不会改成 `total` 继续算。

`currency` 默认 `CNY`。一份数据只用一种币种，只换显示符号，不做汇率换算，合计数字不变。CNY 和 JPY 都显示 ¥，USD 是 $，另外还有 EUR、GBP、HKD、TWD、KRW、SGD、AUD、CAD。不在这张表里的代码会原样出现在数字前面。

`price` 单元格和 Python `float()` 的有限数字同一套写法，所以 `.5`、`5.`、`1e3`、`1_000` 都能读入。空单元格、`inf`、`nan` 和读不懂的文本记为无票价，不算校验错误。

**显示取整。** 页面和 `tools/preview_text.mjs` 上的票价合计按四舍五入取整到元：小数部分大于或等于 0.5 就进 1，负数则远离 0（2.5 显示成 3，-1.5 显示成 -2）。这和「一起」占比用的四舍六入五成双不是同一条规则。`compute()` 和 `tools/parity.mjs` 里的 `price_total` 仍是没取整的原值，方便和手算对照。虚构示例在默认 `total` 下原值是 871.5，页面显示 ¥872。已经是整数的合计没有这层差别，例如 72533 显示为 ¥72,533。

真实观演表不要提交进这个仓库。QA 在仓库外、用默认 `total` 和 `CNY` 核对时，合计应显示为 ¥72,533，并看到「17 场无票价未计」。本仓库的测试只用虚构夹具和手算值锁格式与无票价条数。

`examples/config.json` 配合同目录的虚构 `examples/sample.csv`，写明 `price_mode: per_person` 和 `currency: CNY`，并把两位参与者的显示名改成 Alice、Bob。不带配置打开页面时，示例仍按默认 `total` / CNY。要套上这份配置，打开 `?data=examples/sample.csv&config=examples/config.json`。

链接打不开时页面留中文说明，不会变成空白：地址返回 404、浏览器拦截跨域请求，或 CSV 校验失败（日期不对、引号没有闭合等），都会写出原因。

`?fixture=` 仍用于临时查看仓库里的虚构夹具，只接受本站相对路径，例如 `http://127.0.0.1:8000/?fixture=tests/fixtures/participants-3.csv`。这不是正式导入，刷新后也不会写进 localStorage。

## 加密链接

`?vault=` 指向一份 `vault.json`。页面先把这个文件取下来，再显示密码框。密码用 WebCrypto 在本地派生密钥并解密，然后走和导入明文 CSV 同一条解析、计算、绘制流程。地址里同时有 `?data=` 时，仍按公开 CSV 打开，不进入密码框。

密码不会放进任何请求。浏览器只请求 vault 的地址，以及可选的 `?config=`。勾选「记住密码」后，密码存在这台浏览器的 localStorage 里，刷新不用再输。若这份密码已经打不开当前的 vault，页面会删掉它，并重新显示密码框，说明保存的密码已经失效。点「清除数据」会删掉已导入的表，也会删掉记住的密码。

这是浅防：没有账号，也没有服务器上的密码校验，拦不住反复试密码。记住的密码以明文留在本机浏览器里。

在本地做一份 vault（密码不要写在命令后面，只放在环境变量里）：

```bash
python3 -m pip install -r tools/requirements-vault.txt
LIVE_PASSWORD='你的密码' python3 tools/encrypt_vault.py --csv data.csv --config config.json --out vault.json
```

省略 `--config` 时，vault 里的 config 是 null。要换一个环境变量名：

```bash
LIVE_DASHBOARD_PASSWORD='你的密码' python3 tools/encrypt_vault.py --csv data.csv --config config.json --out vault.json --password-env LIVE_DASHBOARD_PASSWORD
```

加密是 PBKDF2-SHA256（至少 310000 次，随机 16 字节 salt）派生 AES-256-GCM 密钥，IV 为随机 12 字节。`vault.json` 只有版本、算法、迭代次数、salt、IV 和密文。环境变量名只能是大写字母、数字和下划线，且不能以数字开头。CI 会先执行 `python3 -m pip install -r tools/requirements-vault.txt`（版本钉在该文件里），再跑 `tests/test_encrypt_vault.py`，salt / IV 检查不会跳过。本机没装这个包时，那一组仍会跳过。

## 用自己的表对照数字

不要把真实观演表提交进这个仓库。把 CSV 放在仓库外，再跑：

```bash
node tools/preview_text.mjs /绝对路径/你的表.csv --today 2026-10-18
```

终端打印的 KPI、图表数字、筛选项和表格，与页面使用同一套函数。票价那一格是取整后的显示，72533 会印成 ¥72,533，并带「N 场无票价未计」。`--today` 要和对照用的截止日期相同。`--config config.json` 可选。合计对着没取整的 `price_total` 看；按地区取整后再加总是另一套旧口径。

没取整的统计 JSON 用 `tools/parity.mjs`。不带 golden 时，JSON 打到标准输出，原来的旗标仍然可用：

```bash
node tools/parity.mjs /绝对路径/你的表.csv --today 2026-10-18
node tools/parity.mjs /绝对路径/你的表.csv --today 2026-10-18 --config /绝对路径/config.json
node tools/parity.mjs <csv> <config> <today>
```

和 golden 逐字段对照时，用设计 §6 / §8 的位置参数（第 4 个是 golden 文件）：

```bash
node tools/parity.mjs <csv> <config> <today> <golden.json>
```

每个字段都一致时退出码为 0，标准输出写「与 golden 一致」。有差异时退出码为 1，标准错误列出不一致的键路径（例如 `total`、`spend.东岸`、`city[0][0]`）。`--golden golden.json` 与第 4 个位置参数作用相同。仓库里的虚构样本可以这样跑：

```bash
node tools/parity.mjs tests/fixtures/parity-sample.csv tests/fixtures/parity-sample.config.json 2026-10-18 tests/fixtures/parity-sample.golden.json
```

真实观演表不要提交进这个仓库。

## 第三方库

`vendor/` 里的文件由本站提供。版本、来源 URL 和 sha256 记在 `vendor/VERSIONS.md`。

| 文件 | 版本 | npm 包内路径 |
| --- | --- | --- |
| `echarts-5.5.1.min.js` | 5.5.1 | `echarts` 的 `dist/echarts.min.js` |
| `papaparse-5.7.0.min.js` | 5.7.0 | `papaparse` 的 `papaparse.min.js` |
| `xlsx-0.20.3.full.min.js` | 0.20.3 | SheetJS CE 的 `xlsx.full.min.js`（cdn.sheetjs.com，不是 npm 上停在 0.18.5 的 `xlsx`） |

## 持续集成与部署

拉取请求会运行 CI，不限目标分支：用 Python 标准库核对 vendor 文件的 sha256 是否与 `VERSIONS.md` 一致，执行 `node --test`，安装 `tools/requirements-vault.txt` 里钉住的 `cryptography`，再跑 `tests/test_encrypt_vault.py`。

推送到 `main` 时，部署工作流用 GitHub 官方 Pages actions 发布静态站点。Pages 的来源需要设为 GitHub Actions，这项仓库设置由管理员处理。
