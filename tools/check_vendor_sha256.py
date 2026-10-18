#!/usr/bin/env python3
"""Check vendor files against the sha256 values in vendor/VERSIONS.md."""

import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor"
VERSIONS = VENDOR / "VERSIONS.md"
ROW = re.compile(
    r"^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(\S+)\s*\|\s*`([0-9a-f]{64})`\s*\|$"
)


def main() -> int:
    rows = []
    for line in VERSIONS.read_text(encoding="utf-8").splitlines():
        match = ROW.match(line)
        if match:
            rows.append(match.groups())
    if not rows:
        print("VERSIONS.md has no vendor rows", file=sys.stderr)
        return 1

    listed = set()
    failed = False
    for filename, version, source, expected in rows:
        listed.add(filename)
        path = VENDOR / filename
        if not path.is_file():
            print(f"missing file: {path.relative_to(ROOT)}", file=sys.stderr)
            failed = True
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected:
            print(f"sha256 mismatch for {filename}", file=sys.stderr)
            print(f"  VERSIONS.md: {expected}", file=sys.stderr)
            print(f"  file:        {digest}", file=sys.stderr)
            failed = True
        else:
            print(f"ok {filename} {version.strip()} {digest}")
        if not source.startswith("https://"):
            print(f"source is not an https URL for {filename}: {source}", file=sys.stderr)
            failed = True

    extras = sorted(
        path.name
        for path in VENDOR.iterdir()
        if path.is_file() and path.name != "VERSIONS.md" and path.name not in listed
    )
    if extras:
        print(
            "vendor files missing from VERSIONS.md: " + ", ".join(extras),
            file=sys.stderr,
        )
        failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
