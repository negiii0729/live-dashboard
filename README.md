# live-dashboard

通用的观演记录网页。同一个网址载入不同的表格，就显示对应的统计。页面代码和观演数据分开：这个仓库只放代码、虚构示例，以及固定版本的第三方库。

真实观演表不要提交进这个仓库。

## 隐私

> **放在公开链接里的数据任何人都能看到。**

- 用 `?data=` 打开的 CSV，地址本身就是公开的。谁拿到链接，谁就能看到表里的全部内容。
- 用 `?vault=` 时，网上放的是密文，不是明文。能不能看懂，取决于密码够不够强。链接和密码都有的人，可以看到里面的一切。
- 不要把密码写进链接。`?vault=` 只放 `vault.json` 的地址，密码在页面里输入。
- 在自己电脑上选文件导入时，文件不会上传。内容只留在这台浏览器里。

## 表格长什么样

准备一份 CSV（Excel 的第一个工作表也可以，页面会按同样的规则读）。第一行是表头。

虚构示例在 [`examples/sample.csv`](examples/sample.csv)，配套配置在 [`examples/config.json`](examples/config.json)。里面的人是 Alice、Bob，乐队（Northwind、Paper Moon、Glass Harbor、Amberline 等）和场馆都是虚构的。

### 列

| 列名 | 要不要 | 怎么填 |
| --- | --- | --- |
| `date` | 可空 | 日期，格式必须是 `YYYY-MM-DD`，例如 `2024-03-03`。空着表示日期还没定。写错格式整份表都不能用。晚于截止日期的场次算「即将」，不进已看统计。 |
| `event` | 和 `artist` 至少要有一列 | 演出名称。 |
| `artist` | 和 `event` 至少要有一列 | 艺人。一个格子里可以写多行，一行一个名字。行首的 `/` 或 `／` 会去掉。 |
| `venue` | 可空 | 场地。 |
| `city` | 可空 | 城市。 |
| `type` | 可空，整列都可以不写 | 场次类型，例如 `ワンマン`、`対バン`、`フェス`。不写这一列也可以。 |
| `price` | 可空 | 这场的票价。空着表示没有票价，不算错误，统计里会单独写出有几场没计票价。 |
| `no` | 可空 | 序号，不参加统计。 |
| `region` | 可空 | 地区。不写时，按城市归到中国大陆、日本或港台澳。 |

### 参与者：一列一个人

除了上面这些列，**剩下的每一列就是一个人**。列名是这个人的代号，例如 `alice`、`bob`。

格子里写 `✅` 表示这个人去了这场，空着表示没去。`✔`、`✓`、`○`、`1`、`y`、`yes`、`true` 也算去了，大小写不限。

**「一起」怎么算：** 至少有两位参与者时才有这项。在已经看过的场次里，每一位参与者都标了去，这场才算「一起」。少一位就不算。只有一位参与者时，页面上不出现「一起」。

配置里的 `people` 可以给列换显示名，并指定顺序。示例把 `alice` 显示成 Alice，把 `bob` 显示成 Bob。没写 `people` 时，显示名就是表头。

### 票价口径 `price` / `price_mode`

`price` 是表里的数字。怎么加总由配置里的 `price_mode` 决定，默认是 `total`：

- `total`：把各场的 `price` 直接相加。
- `per_person`：每一场先乘上这场标了「去了」的人数，再相加。

只接受这两个值。写成别的会报错，不会悄悄改成 `total`。没有票价的场次两种口径都不加进去，卡片上会写「N 场无票价未计」。

`currency` 只换显示符号，不换算汇率。默认 `CNY`（显示 ¥）。一份数据只用一种币种。

示例配置是 `per_person` 和 `CNY`。不带配置打开内置示例时，仍按默认的 `total` / `CNY`。

### 艺人别名 `artist_aliases`

写在配置 JSON 里，不写在 CSV 里。键是表里的原文，值是统计时用的名字。写法不同、其实是同一组的，可以并成一个。没有 `artist_aliases` 时，也可以用 `aliases`，两份都写时以 `artist_aliases` 为准。

示例配置里把 `Glass Harbor` 记成 `Paper Moon`。

## 三种打开方式

先在仓库根目录预览：

```bash
python3 -m http.server
```

浏览器打开 `http://127.0.0.1:8000/`。纯静态页面，不用安装依赖，也不用构建。

### 1. 在自己电脑上选文件

点「选择文件」，或把 CSV、Excel（`.xlsx` / `.xls`）拖进页面。Excel 只读第一个工作表。

文件不会上传。内容存在这台浏览器的 localStorage 里，刷新还在。点「清除数据」会删掉它。

如果当时的地址里已经有 `?config=`，导入时会先把这份配置读下来，校验和绘制都用它，和用 `?data=` 打开时一样。导入成功后，地址里的 `?data=`、`?fixture=`、`?vault=` 会去掉，`?config=` 还留着。

### 2. 公开链接 `?data=`

在地址后面加上 `?data=`，值是 CSV 的地址。可选再加 `?config=`（一份 JSON）和 `?today=YYYY-MM-DD`（截止日期；不写就用浏览器当天）。

数据必须放在浏览器能直接读取的公开地址上。跨域时，对方要允许网页来读（CORS）。GitHub 上的 raw 文件（`raw.githubusercontent.com`）可以。本站自己的相对路径也可以，例如仓库里的示例。

相对路径的 `?data=` 只读本站文件。页面把它当成你指定的数据，**不叫夹具，也不叫虚构示例**。只有下面说的内置示例才会标成示例。

地址打不开时，页面用中文写出原因（404、跨域被拦、CSV 校验失败等），不会变成空白。这时下面没有示例表，说明文字也不会说「下面是一份虚构示例」。

**虚构示例**（Alice / Bob）：

```
?data=examples/sample.csv&config=examples/config.json
```

本地是：

`http://127.0.0.1:8000/?data=examples/sample.csv&config=examples/config.json`

部署到 GitHub Pages 之后，站点地址类似 `https://<用户名>.github.io/live-dashboard/`。在这个地址后面接上同一段 `?data=examples/sample.csv&config=examples/config.json` 即可。这两个文件会随页面一起发布，链接打开的是本站上的示例，不是别人的观演记录。

不带任何参数时，页面也会渲染 `examples/sample.csv`，并说明怎样换成自己的表。这是内置示例，顶上会标明。一旦用了 `?data=`、`?fixture=` 或导入了文件，就不再标成示例。

`?fixture=` 只用来临时看仓库里的虚构夹具，只接受本站相对路径，例如 `http://127.0.0.1:8000/?fixture=tests/fixtures/participants-3.csv`。刷新后不会写进 localStorage。它和 `?data=` 不是同一类来源。

### 3. 加密链接 `?vault=`

`?vault=` 指向一份 `vault.json`。页面把这个文件取下来，再显示密码框。密码用 WebCrypto 在浏览器里解密（PBKDF2-SHA256 派生密钥，AES-256-GCM 解密），然后走和明文 CSV 一样的解析、计算、绘制。地址里同时有 `?data=` 时，仍按公开 CSV 打开，不进入密码框。

密码不会放进任何请求。浏览器只请求 vault 的地址，以及可选的 `?config=`。有 `?config=` 时用地址里的配置；没有时用 vault 里附带的配置。

网上能下载到的是密文。密码强度不够的话，别人可以慢慢试。这不是账号系统，服务器上也不核对密码。

在本地做一份 vault。密码只放在环境变量里，不要写在命令后面。`--password-env` 是可选项，用来指定读取密码的环境变量名；省略时默认是 `LIVE_PASSWORD`（`tools/encrypt_vault.py` 里该参数的默认值）。

```bash
python3 -m pip install -r tools/requirements-vault.txt
LIVE_PASSWORD='你的密码' python3 tools/encrypt_vault.py --csv data.csv --config config.json --out vault.json
```

这条命令省略了 `--password-env`，密码从 `LIVE_PASSWORD` 读取。省略 `--config` 时，vault 里的 config 是 null。要改用别的环境变量名，再加上 `--password-env`：

```bash
LIVE_DASHBOARD_PASSWORD='你的密码' python3 tools/encrypt_vault.py --csv data.csv --config config.json --out vault.json --password-env LIVE_DASHBOARD_PASSWORD
```

环境变量名只能是大写字母、数字和下划线，且不能以数字开头。加密是 PBKDF2-SHA256（至少 310000 次，随机 16 字节 salt）派生 AES-256-GCM 密钥，IV 为随机 12 字节。`vault.json` 里只有版本、算法、迭代次数、salt、IV 和密文。

**记住密码：** 勾选「记住密码」后，密码存在这台浏览器的 localStorage 里，刷新不用再输。它以明文留在本机，换一台电脑或换一个浏览器就没有了。

点「清除数据」会删掉已导入的表，也会删掉记住的密码。

如果记住的密码已经打不开当前这份 vault，页面会删掉这条记录，重新显示密码框，并说明之前记住的密码已经失效。密码框是空的，「记住密码」不会勾上。

## 自己部署

可以把这个仓库 fork 出去，用 GitHub Pages 发布你自己的一份页面。Fork 之后有两项要在网页上自己打开，推送代码不会替你打开：

1. **Actions。** 打开 fork 仓库的 **Actions** 标签页，按页面提示启用工作流。GitHub 对 fork 默认不跑 Actions。
2. **Pages 来源。** 在仓库 Settings 的 Pages 里，把来源设为 **GitHub Actions**。

部署工作流（`.github/workflows/deploy.yml`，名称是 Deploy GitHub Pages）会在推送到 `main` 时，用 GitHub 官方的 Pages actions 发布静态文件。同一份工作流写了 `workflow_dispatch:`，所以第一次发布可以手动跑：打开 **Actions** 标签页，选中 **Deploy GitHub Pages**，点 **Run workflow**，在分支上再点一次 **Run workflow**。

页面和数据仍然分开。观演表不要放进这个代码仓库。

如果表不能公开，可以用两个仓库配合，名字随你自己起：

1. **私有的数据仓库**只放 CSV 和配置，不对外。
2. **公开的仓库**只放加密好的 `vault.json`，不放明文。
3. 私有仓库的 CI 用 `tools/encrypt_vault.py` 加密。密码放在 CI 的密钥里，不写进仓库，也不写进命令行。CI 再把生成的 `vault.json` 推到那个公开仓库。
4. 打开 live-dashboard（本仓库，或你 fork 出去的 Pages），地址用 `?vault=` 指向那份公开的 `vault.json`。

公开的仍然只是密文。链接加密码就能看到全部内容，所以密码要单独保管，不要放进链接。

## 票价在页面上怎么显示

页面和 `tools/preview_text.mjs` 上的票价合计按四舍五入取整到元：小数部分大于或等于 0.5 就进 1，负数则远离 0（2.5 显示成 3，-1.5 显示成 -2）。这和「一起」占比用的四舍六入五成双不是同一条规则。`compute()` 和 `tools/parity.mjs` 里的 `price_total` 仍是没取整的原值。

虚构示例在默认 `total` 下原值是 871.5，页面显示 ¥872。套上 `examples/config.json` 的 `per_person` 后，合计按人数乘过再显示。

`price` 单元格和 Python `float()` 的有限数字同一套写法，所以 `.5`、`5.`、`1e3`、`1_000` 都能读入。空单元格、`inf`、`nan` 和读不懂的文本记为无票价。

已知币种先去掉首尾空白再改成大写，然后换成符号，符号紧贴取整后的金额：CNY 和 JPY 是 ¥，USD 是 $，EUR 是 €，GBP 是 £，HKD 是 HK$，TWD 是 NT$，KRW 是 ₩，SGD 是 S$，AUD 是 A$，CAD 是 C$。例如 `¥1,234`。不在这张表里的代码同样去掉首尾空白并改成大写，再空一格写在金额前面；金额用逗号作千分位。币种写成 `xyz`、合计取整后是 1234 时，卡片显示 `XYZ 1,234`。空白的币种按默认 `CNY` 显示。

## 用自己的表对照数字

把 CSV 放在仓库外，再跑：

```bash
node tools/preview_text.mjs /绝对路径/你的表.csv --today 2026-10-18
```

终端打印的 KPI、图表数字、筛选项和表格，与页面使用同一套函数。`--today` 要和对照用的截止日期相同。`--config config.json` 可选。合计对着没取整的 `price_total` 看。

没取整的统计 JSON 用 `tools/parity.mjs`：

```bash
node tools/parity.mjs /绝对路径/你的表.csv --today 2026-10-18
node tools/parity.mjs /绝对路径/你的表.csv --today 2026-10-18 --config /绝对路径/config.json
node tools/parity.mjs <csv> <config> <today>
node tools/parity.mjs <csv> <config> <today> <golden.json>
```

每个字段都一致时退出码为 0，标准输出写「与 golden 一致」。有差异时退出码为 1，标准错误列出不一致的键路径。仓库里的虚构样本可以这样跑：

```bash
node tools/parity.mjs tests/fixtures/parity-sample.csv tests/fixtures/parity-sample.config.json 2026-10-18 tests/fixtures/parity-sample.golden.json
```

## 第三方库

`vendor/` 里的文件由本站提供。版本、来源 URL 和 sha256 记在 `vendor/VERSIONS.md`。

| 文件 | 版本 | npm 包内路径 |
| --- | --- | --- |
| `echarts-5.5.1.min.js` | 5.5.1 | `echarts` 的 `dist/echarts.min.js` |
| `papaparse-5.7.0.min.js` | 5.7.0 | `papaparse` 的 `papaparse.min.js` |
| `xlsx-0.20.3.full.min.js` | 0.20.3 | SheetJS CE 的 `xlsx.full.min.js`（cdn.sheetjs.com，不是 npm 上停在 0.18.5 的 `xlsx`） |

## 持续集成与部署

拉取请求会运行 CI，不限目标分支：核对 vendor 文件的 sha256 是否与 `VERSIONS.md` 一致，执行 `node --test`，并先安装 `tools/requirements-vault.txt` 再跑 `tests/test_encrypt_vault.py`。本机没装 `cryptography` 时，那一组测试会跳过。
