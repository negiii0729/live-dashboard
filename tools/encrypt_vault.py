#!/usr/bin/env python3
"""Encrypt a CSV and optional config into vault.json.

The password is read from the environment (LIVE_PASSWORD by default, or the
variable named by --password-env). It is never accepted as a command-line
argument. Abbreviations are off, so --pass is not --password-env. The variable
name must match [A-Z_][A-Z0-9_]*. Error text never includes the password or
that name.

vault.json is {"v":1,"kdf":"PBKDF2-SHA256","iter":N,"salt":b64,"iv":b64,"ct":b64}.
The plaintext is UTF-8 JSON {"csv":"<csv text>","config":<object or null>}.
The key is PBKDF2-SHA256 (at least 310000 iterations, random 16-byte salt)
and the cipher is AES-256-GCM with a random 12-byte IV.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

MIN_ITERATIONS = 310_000
SALT_LEN = 16
IV_LEN = 12
KEY_LEN = 32
KDF_NAME = "PBKDF2-SHA256"
VERSION = 1

USAGE = """\
示例：
  LIVE_PASSWORD='你的密码' python3 tools/encrypt_vault.py --csv data.csv --config config.json --out vault.json

密码只从环境变量读取。默认变量名是 LIVE_PASSWORD，可以用 --password-env 换成别的名字。
不要把密码写在命令行参数里。
"""


class EncryptError(Exception):
    """A user-facing encryption failure. The message does not include the password."""


# fullmatch, not `$`, so a trailing newline cannot slip through.
ENV_NAME_RE = re.compile(r"\A[A-Z_][A-Z0-9_]*\Z")


class VaultArgumentParser(argparse.ArgumentParser):
    """Long-option errors must not repeat values the user typed."""

    def __init__(self, *args, **kwargs):
        kwargs["allow_abbrev"] = False
        super().__init__(*args, **kwargs)
        self.supplied_values: tuple[str, ...] = ()

    def error(self, message: str) -> None:
        if any(value and value in message for value in self.supplied_values):
            message = "参数不正确。密码只从环境变量读取，不要写在命令行参数里。"
        self.print_usage(sys.stderr)
        self.exit(2, f"{self.prog}: error: {message}\n")


def read_password(env_name: str) -> str:
    if not isinstance(env_name, str) or ENV_NAME_RE.fullmatch(env_name) is None:
        raise EncryptError("环境变量名不合法。")
    if env_name not in os.environ:
        raise EncryptError("环境变量没有设置。密码只从环境变量读取，不要写在命令行参数里。")
    password = os.environ[env_name]
    if password == "":
        raise EncryptError("环境变量是空的。")
    return password


def load_csv(path: Path) -> str:
    data = path.read_bytes()
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EncryptError(f"CSV 不是 UTF-8：{path}") from exc


def load_config(path: Path | None):
    if path is None:
        return None
    raw = path.read_text(encoding="utf-8")
    if raw.startswith("\ufeff"):
        raw = raw[1:]
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise EncryptError(f"配置文件不是合法的 JSON：{path}") from exc
    if not isinstance(value, dict):
        raise EncryptError("配置必须是 JSON 对象。")
    return value


def encrypt_document(csv_text: str, config, password: str, iterations: int = MIN_ITERATIONS) -> dict:
    if not isinstance(csv_text, str):
        raise EncryptError("CSV 必须是字符串。")
    if config is not None and not isinstance(config, dict):
        raise EncryptError("配置必须是 JSON 对象。")
    if not isinstance(password, str) or password == "":
        raise EncryptError("密码是空的。")
    if not isinstance(iterations, int) or iterations < MIN_ITERATIONS:
        raise EncryptError(f"迭代次数至少要 {MIN_ITERATIONS}。")

    try:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    except ImportError as exc:
        raise EncryptError(
            "需要安装 cryptography。请运行：python3 -m pip install -r tools/requirements-vault.txt"
        ) from exc

    salt = os.urandom(SALT_LEN)
    iv = os.urandom(IV_LEN)
    key = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=KEY_LEN,
        salt=salt,
        iterations=iterations,
    ).derive(password.encode("utf-8"))
    plain = json.dumps(
        {"csv": csv_text, "config": config},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(iv, plain, None)
    return {
        "v": VERSION,
        "kdf": KDF_NAME,
        "iter": iterations,
        "salt": base64.b64encode(salt).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "ct": base64.b64encode(ciphertext).decode("ascii"),
    }


def dump_vault(vault: dict) -> str:
    return json.dumps(vault, ensure_ascii=True, separators=(",", ":")) + "\n"


def build_parser() -> VaultArgumentParser:
    parser = VaultArgumentParser(
        description="把 CSV 和可选配置加密成 vault.json。密码从环境变量读取，不会从命令行参数读取。",
        epilog=USAGE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        allow_abbrev=False,
    )
    parser.add_argument("--csv", required=True, help="明文 CSV 路径，例如 data.csv")
    parser.add_argument("--config", help="可选的 config.json。省略时 vault 里的 config 为 null")
    parser.add_argument("--out", required=True, help="写出的 vault.json 路径")
    parser.add_argument(
        "--password-env",
        default="LIVE_PASSWORD",
        help="读取密码的环境变量名，默认 LIVE_PASSWORD。只能是大写字母、数字和下划线，且不能以数字开头",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=MIN_ITERATIONS,
        help=f"PBKDF2-SHA256 迭代次数，至少 {MIN_ITERATIONS}",
    )
    return parser


def option_name(arg: str) -> str:
    if arg.startswith("--"):
        return arg.split("=", 1)[0]
    return ""


def command_values(argv: list[str]) -> tuple[str, ...]:
    values: list[str] = []
    for arg in argv:
        if arg.startswith("--") and "=" in arg:
            values.append(arg.split("=", 1)[1])
        elif not arg.startswith("-"):
            values.append(arg)
    return tuple(values)


def password_on_argv(argv: list[str]) -> bool:
    """True when a flag is trying to pass the password, including --pass abbreviations."""
    for arg in argv:
        name = option_name(arg)
        if not name.startswith("--pass") or name == "--password-env":
            continue
        return True
    return False


def main(argv: list[str] | None = None) -> int:
    args_in = list(sys.argv[1:] if argv is None else argv)
    if password_on_argv(args_in):
        print(
            "不要把密码写在命令行参数里。请使用环境变量 LIVE_PASSWORD，或用 --password-env 指定变量名。",
            file=sys.stderr,
        )
        return 2
    parser = build_parser()
    parser.supplied_values = command_values(args_in)
    try:
        args = parser.parse_args(args_in)
    except SystemExit as exc:
        code = exc.code
        return int(code) if isinstance(code, int) else 2

    try:
        password = read_password(args.password_env)
        csv_text = load_csv(Path(args.csv))
        config = load_config(Path(args.config) if args.config else None)
        vault = encrypt_document(csv_text, config, password, args.iterations)
        Path(args.out).write_text(dump_vault(vault), encoding="utf-8")
    except FileNotFoundError as exc:
        print(f"找不到文件：{exc.filename}", file=sys.stderr)
        return 1
    except EncryptError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"没有写完输出文件：{exc}", file=sys.stderr)
        return 1
    print(f"已写出 {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
