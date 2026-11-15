#!/usr/bin/env python3
"""Create a private deployment env file without copying local API credentials."""

import os
from pathlib import Path
import secrets
import stat
import sys


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    destination = root / ".env.deploy"
    template = (root / ".env.production.example").read_text()
    content = template.replace("SESSION_SECRET=\n", "SESSION_SECRET=" + secrets.token_hex(32) + "\n")
    try:
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if destination.is_symlink():
            print("Refusing to use a symlink for .env.deploy.", file=sys.stderr)
            return 1
        fd = os.open(destination, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                print(".env.deploy must be a regular file.", file=sys.stderr)
                return 1
            os.fchmod(fd, 0o600)
        finally:
            os.close(fd)
        print(".env.deploy already exists; kept its settings and secret, secured permissions to 0600.")
        return 0
    with os.fdopen(fd, "w") as env_file:
        env_file.write(content)
    print("Created .env.deploy with permissions 0600 and a new session secret.")
    print("Set APP_DOMAIN, your provider key, and the matching public mode labels there.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
