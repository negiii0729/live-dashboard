# 测试

## 计算口径的基准文件

`tests/fixtures/compute-two.golden.json` 不是手写的。它由一份**不在这个仓库里**的参考脚本生成：原来的观演 dashboard 构建脚本，用 `--json` 打印统计。

生成时用的输入是虚构夹具 `tests/fixtures/compute-two.csv`，截止日期 `--today 2026-10-18`。参考脚本只认它写死的两个参与者列名，所以当时在本机把夹具的参与者列临时改成那两个列名再跑脚本，然后把列名和 JSON 里对应的字段**等价**换成 `alice` / `bob`，才提交进仓库。仓库里的夹具和 golden 使用换过之后的名字。

`tests/compute.test.mjs` 要求 `app/compute.js` 的输出和这份 golden 逐项相等，**票价合计除外**。票价合计用现在的口径：`price_mode` 为 `total` 时，把已看场次的 `price` 直接相加；为 `per_person` 时，乘上该场到场人数。这和参考脚本里按人头把票价再乘一遍的算法不是同一个数，单测用手算值核对，故意不对齐。`price_total` 保留没取整的原值。页面上的合计另按四舍五入显示到整数元（一半时远离 0），所以 871.5 的卡片是 ¥872，JSON 里仍是 871.5。

票价单元格和 Python `float()` 的有限数字对齐（`.5`、`5.`、`1e3` 等）。`inf` / `nan` 仍算无票价。未知的 `price_mode` 要报中文错误，不能当成 `total`。

`tests/fixtures/compute-three.csv` 是另一份虚构数据，有三列参与者，用来测「一起」（三人都到场）和「仅某人」。参考脚本不能算三个人，所以这份不产生 golden。

夹具里的艺人、乐队、场馆都是虚构的。别名用例也用虚构名字，不用参考脚本里原来的别名表。

`tests/fixtures/vault-source.csv` 和 `vault-source.config.json` 是另一组虚构数据。`vault-test.json` 由 `tools/encrypt_vault.py` 用密码 `test-pass` 加密这两份文件得到。Node 测试用 WebCrypto 解开，要求 CSV 字节和配置对象与源文件一致，并且 `compute()` 的结果与直接导入明文相同。错密码要走到「密码不对」。记住的密码若打不开同一份 vault，要删掉保存的记录，并返回「之前记住的密码已经打不开」这段提示，提示里不能带密码本身。

`tests/test_encrypt_vault.py` 用 Python 标准库的 unittest。没安装 `cryptography` 时，检查 salt / IV 的那组会跳过，帮助文本和命令行检查仍会跑。CI 先安装 `tools/requirements-vault.txt`，因此 salt / IV 那组会执行。`--pass` 不能当成 `--password-env`，非法的环境变量名、没设置的变量，以及参数错误，都不能把传入的值打到标准输出或标准错误。

`tests/fixtures/parity-sample.csv` 和同目录的 `parity-sample.config.json` 是另一组虚构数据，专给 `tools/parity.mjs` 用。`parity-sample.golden.json` 是这份夹具在 `2026-10-18` 的完整统计，要求每个字段都相等（含 `price_total`）。`parity-sample.mismatch.json` 故意改了 `total`、`spend.东岸`、`city[0][0]`，删掉 `price_total`，并多写了 `spend_heads`，用来确认对不上时退出码为 1，并列出这些路径。
