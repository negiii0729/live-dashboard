"""Salt and IV must change between encryptions of the same plaintext.

Skipped when the cryptography package is not installed. CI does not install it.
"""

from __future__ import annotations

import base64
import importlib.util
import json
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
