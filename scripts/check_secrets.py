#!/usr/bin/env python3
"""Scan tracked files and optionally reachable Git history without printing secrets.

This intentionally uses high-confidence credential formats, not entropy guesses.
A clean result is not proof that every possible type of secret is absent.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys


PATTERNS = {
    "Anthropic API key": rb"\bsk-ant-(?:api03|usr)-[A-Za-z0-9_-]{20,}",
    "OpenAI API key": rb"\bsk-(?:proj-|svcacct-)[A-Za-z0-9_-]{20,}",
    "Legacy API key": rb"\bsk-[A-Za-z0-9]{40,64}\b",
    "Stripe secret key": rb"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}",
    "GitHub token": rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})",
    "AWS access key ID": rb"\bAKIA[A-Z0-9]{16}\b",
    "Private key": rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
}
CHECKS = {name: re.compile(pattern) for name, pattern in PATTERNS.items()}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


def scan(data: bytes, location: str) -> int:
    findings = 0
    for category, pattern in CHECKS.items():
        for match in pattern.finditer(data):
            line = data.count(b"\n", 0, match.start()) + 1
            # Print only file/object metadata and category, never matched text.
            print(f"{location}:{line}: {category} [REDACTED]")
            findings += 1
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true", help="also scan blobs reachable from all local Git refs")
    args = parser.parse_args()
    root = pathlib.Path(git("rev-parse", "--show-toplevel").decode().strip())
    findings = 0
    files = 0
    for name in git("ls-files", "-z", "--full-name", "--", ":/").split(b"\0"):
        if not name:
            continue
        path = root / name.decode("utf-8", errors="surrogateescape")
        # Do not follow symlinks outside the repository to read private files.
        if path.is_symlink() or not path.is_file():
            continue
        files += 1
        findings += scan(path.read_bytes(), str(path.relative_to(root)))

    blobs = 0
    if args.history:
        objects = git("rev-list", "--objects", "--all").splitlines()
        with subprocess.Popen(
            ["git", "cat-file", "--batch"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        ) as batch:
            assert batch.stdin is not None and batch.stdout is not None
            for item in objects:
                object_id, _, raw_name = item.partition(b" ")
                batch.stdin.write(object_id + b"\n")
                batch.stdin.flush()
                header = batch.stdout.readline().split()
                if len(header) != 3:
                    raise ValueError("unreadable Git object")
                size = int(header[2])
                data = batch.stdout.read(size)
                if len(data) != size or batch.stdout.read(1) != b"\n":
                    raise ValueError("incomplete Git object")
                if header[1] != b"blob":
                    continue
                blobs += 1
                name = raw_name.decode("utf-8", errors="replace") or "(unnamed blob)"
                findings += scan(data, f"history {object_id[:12].decode()} {name}")
            batch.stdin.close()
            if batch.wait() != 0:
                raise ValueError("Git object scan failed")

    print(f"Scanned {files} tracked files and {blobs} historical blobs; {findings} credential-format findings.")
    return 1 if findings else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, subprocess.SubprocessError, ValueError):
        # Exceptions may contain filesystem or process input; keep failure safe.
        print("Secret scan could not finish. Run it from an accessible Git working tree.", file=sys.stderr)
        sys.exit(2)
