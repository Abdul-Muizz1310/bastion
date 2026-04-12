"""Push GitHub Actions secrets from workspace .env to Abdul-Muizz1310/bastion."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = "Abdul-Muizz1310/bastion"
WORKSPACE_ENV = Path(__file__).resolve().parents[2] / ".env"

# Maps GitHub secret name -> workspace .env key
SECRETS: dict[str, str] = {
    "DATABASE_URL": "NEON_DB_URL_SHADOW_ADMIN",
    "IRON_SESSION_PASSWORD": "IRON_SESSION_PASSWORD",
    "RESEND_API_KEY": "RESEND_API_KEY",
    "UPSTASH_REDIS_REST_URL": "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN": "UPSTASH_REDIS_REST_TOKEN",
    "BASTION_SIGNING_KEY_PRIVATE": "BASTION_SIGNING_KEY_PRIVATE",
    "BASTION_SIGNING_KEY_PUBLIC": "BASTION_SIGNING_KEY_PUBLIC",
}


def parse_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if not m:
            continue
        key = m.group(1)
        val = m.group(2)
        # strip inline comment (space + #)
        val = re.sub(r"\s+#.*$", "", val)
        # strip surrounding quotes
        val = val.strip().strip("\"'")
        env[key] = val
    return env


def main() -> None:
    if not WORKSPACE_ENV.exists():
        print(f"ERROR: {WORKSPACE_ENV} not found", file=sys.stderr)
        sys.exit(1)

    env = parse_env(WORKSPACE_ENV)
    failed: list[str] = []

    for gh_name, env_key in SECRETS.items():
        value = env.get(env_key, "")
        if not value:
            print(f"SKIP {gh_name}: {env_key} is empty in .env")
            continue
        print(f"SET  {gh_name} (from {env_key})")
        result = subprocess.run(
            ["gh", "secret", "set", gh_name, "--repo", REPO],
            input=value.encode("utf-8"),
            capture_output=True,
        )
        if result.returncode != 0:
            print(f"  FAIL: {result.stderr.decode()}", file=sys.stderr)
            failed.append(gh_name)

    if failed:
        print(f"\nFailed to set: {', '.join(failed)}", file=sys.stderr)
        sys.exit(1)
    print("\nDone.")


if __name__ == "__main__":
    main()
