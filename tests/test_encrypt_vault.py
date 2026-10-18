"""Salt and IV must change between encryptions of the same plaintext.

CI installs tools/requirements-vault.txt before this file, so the salt and IV
tests run there. Without the cryptography package they are skipped; the CLI
checks below still run.
"""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "encrypt_vault.py"


def cryptography_available() -> bool:
    try:
        import cryptography  # noqa: F401
    except ImportError:
        return False
    return True


def load_encrypt():
    spec = importlib.util.spec_from_file_location("encrypt_vault", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def decrypt_vault(vault: dict, password: str) -> dict:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    key = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=base64.b64decode(vault["salt"]),
        iterations=vault["iter"],
    ).derive(password.encode("utf-8"))
    plain = AESGCM(key).decrypt(base64.b64decode(vault["iv"]), base64.b64decode(vault["ct"]), None)
    return json.loads(plain.decode("utf-8"))


def run_cli(args, env=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )


class EncryptVaultCliTests(unittest.TestCase):
    def test_help_uses_a_generic_csv_name(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--help"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("data.csv", result.stdout)
        self.assertIn("LIVE_PASSWORD", result.stdout)
        self.assertIn("--password-env", result.stdout)
        banned = "liv" + "es.csv"
        self.assertNotIn(banned, result.stdout.lower())

    def test_password_flag_is_rejected(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--password", "secret", "--csv", "data.csv", "--out", "vault.json"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("不要把密码写在命令行参数里", result.stderr)
        self.assertNotIn("secret", result.stderr)
        self.assertNotIn("secret", result.stdout)

    def test_abbreviated_pass_flag_does_not_echo_secret(self):
        secret = "SECRETX"
        cases = (
            ["--pass", secret, "--csv", "data.csv", "--out", "vault.json"],
            ["--pass=" + secret, "--csv", "data.csv", "--out", "vault.json"],
        )
        for args in cases:
            with self.subTest(args=args):
                result = run_cli(args)
                self.assertEqual(result.returncode, 2)
                self.assertIn("不要把密码写在命令行参数里", result.stderr)
                self.assertNotIn(secret, result.stderr)
                self.assertNotIn(secret, result.stdout)

    def test_invalid_env_name_is_not_echoed(self):
        secret = "bad-secret"
        result = run_cli(
            ["--csv", "data.csv", "--out", "vault.json", "--password-env", secret],
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("环境变量名不合法", result.stderr)
        self.assertNotIn(secret, result.stderr)
        self.assertNotIn(secret, result.stdout)

    def test_missing_env_does_not_print_secret(self):
        secret = "SECRETX"
        env = os.environ.copy()
        env.pop(secret, None)
        result = run_cli(
            ["--csv", "data.csv", "--out", "vault.json", "--password-env", secret],
            env=env,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("没有设置", result.stderr)
        self.assertNotIn(secret, result.stderr)
        self.assertNotIn(secret, result.stdout)

    def test_empty_env_does_not_print_secret(self):
        secret = "SECRETX"
        env = os.environ.copy()
        env[secret] = ""
        result = run_cli(
            ["--csv", "data.csv", "--out", "vault.json", "--password-env", secret],
            env=env,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("是空的", result.stderr)
        self.assertNotIn(secret, result.stderr)
        self.assertNotIn(secret, result.stdout)

    def test_invalid_iterations_do_not_echo_the_value(self):
        secret = "SECRETX"
        result = run_cli(["--csv", "data.csv", "--out", "vault.json", "--iterations", secret])
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(secret, result.stderr)
        self.assertNotIn(secret, result.stdout)

    def test_password_env_option_is_not_a_password_flag(self):
        module = load_encrypt()
        self.assertFalse(
            module.password_on_argv(
                ["--password-env", "LIVE_PASSWORD", "--csv", "data.csv", "--out", "out.json"]
            )
        )
        self.assertFalse(module.password_on_argv(["--password-env=LIVE_PASSWORD"]))
        self.assertTrue(module.password_on_argv(["--pass", "SECRETX"]))
        self.assertTrue(module.password_on_argv(["--pass=SECRETX"]))
        self.assertIsNone(module.ENV_NAME_RE.fullmatch("bad-secret"))
        self.assertIsNotNone(module.ENV_NAME_RE.fullmatch("LIVE_PASSWORD"))
        self.assertIsNotNone(module.ENV_NAME_RE.fullmatch("SECRETX"))
        with self.assertRaises(module.EncryptError) as invalid:
            module.read_password("bad-secret")
        self.assertEqual(str(invalid.exception), "环境变量名不合法。")
        self.assertNotIn("bad-secret", str(invalid.exception))


@unittest.skipUnless(cryptography_available(), "cryptography is not installed")
class EncryptVaultUniquenessTests(unittest.TestCase):
    def test_same_password_uses_a_fresh_salt_and_iv(self):
        module = load_encrypt()
        csv_text = "date,event,artist\n2024-01-01,Lantern,Northwind\n"
        config = {"schema": 1, "title": "Desk", "price_mode": "total"}
        password = "test-pass"
        first = module.encrypt_document(csv_text, config, password)
        second = module.encrypt_document(csv_text, config, password)
        self.assertNotEqual(first["salt"], second["salt"])
        self.assertNotEqual(first["iv"], second["iv"])
        self.assertNotEqual(first["ct"], second["ct"])
        self.assertGreaterEqual(first["iter"], 310000)
        self.assertGreaterEqual(second["iter"], 310000)
        self.assertEqual(first["v"], 1)
        self.assertEqual(first["kdf"], "PBKDF2-SHA256")
        self.assertEqual(len(base64.b64decode(first["salt"])), 16)
        self.assertEqual(len(base64.b64decode(first["iv"])), 12)
        self.assertEqual(decrypt_vault(first, password), {"csv": csv_text, "config": config})
        self.assertEqual(decrypt_vault(second, password), {"csv": csv_text, "config": config})

    def test_iterations_below_the_minimum_are_rejected(self):
        module = load_encrypt()
        with self.assertRaises(module.EncryptError):
            module.encrypt_document("date,event\n", None, "test-pass", 1000)


if __name__ == "__main__":
    unittest.main()
