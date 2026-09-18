"""Host-side backup runner, optional offsite copy, and backup/disk health checks."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from backup import prune, verify

DEFAULTS = {
    "keep": 14,
    "max_age_hours": 36,
    "min_free_bytes": 2 * 1024**3,
    "max_used_percent": 90,
    "disk_paths": ["/var/lib/docker"],
    "remote": "",
    "rclone_config": "/etc/nutrigo/rclone.conf",
    "alert_webhook": "",
    "timeout_seconds": 1800,
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_config(path: Path) -> dict:
    config = dict(DEFAULTS)
    # A missing configuration must fail visibly; never silently disable offsite/alerts.
    values = json.loads(path.read_text())
    if not isinstance(values, dict) or set(values) - set(DEFAULTS):
        raise ValueError("Unknown backup configuration fields")
    config.update(values)
    for key in ("keep", "min_free_bytes", "timeout_seconds"):
        if type(config[key]) is not int or config[key] < 1:
            raise ValueError(f"Invalid {key}")
    for key in ("max_age_hours", "max_used_percent"):
        value = config[key]
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"Invalid {key}")
    if config["max_used_percent"] > 100:
        raise ValueError("Invalid max_used_percent")
    if not isinstance(config["disk_paths"], list) or not all(
        isinstance(p, str) and Path(p).is_absolute() for p in config["disk_paths"]
    ):
        raise ValueError("disk_paths must contain absolute paths")
    for key in ("remote", "rclone_config", "alert_webhook"):
        if not isinstance(config[key], str):
            raise TypeError(f"Invalid {key}")
    # Only a named rclone remote: forbid local destinations and inline credentials.
    if config["remote"] and not re.fullmatch(r"[A-Za-z0-9_-]+:[^\r\n]+", config["remote"]):
        raise ValueError("remote must use a configured rclone remote:path")
    if config["remote"] and not Path(config["rclone_config"]).is_absolute():
        raise ValueError("rclone_config must be an absolute path")
    if config["alert_webhook"]:
        url = urlsplit(config["alert_webhook"])
        if url.scheme != "https" or not url.netloc or url.username or url.password:
            raise ValueError("alert_webhook must be HTTPS")
    return config


def atomic_json(path: Path, data: dict) -> None:
    descriptor, filename = tempfile.mkstemp(prefix=".status-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(data, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(filename, path)
    finally:
        if os.path.exists(filename):
            os.unlink(filename)


def state_read(destination: Path) -> dict:
    path = destination / "maintenance-status.json"
    return json.loads(path.read_text()) if path.exists() else {}


@contextmanager
def exclusive(destination: Path):
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Same lock as standalone backup.py; run() invokes create only before taking
    # this lock, then holds it throughout offsite verification and retention.
    with (destination / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def latest(destination: Path) -> Path:
    snapshots = sorted(p for p in destination.glob("snapshot-*") if p.is_dir() and not p.is_symlink())
    if not snapshots:
        raise ValueError("No completed backup exists")
    return snapshots[-1]


def disk_issues(project: Path, config: dict) -> list[str]:
    issues = []
    for path in dict.fromkeys([str(project), *config["disk_paths"]]):
        try:
            usage = shutil.disk_usage(path)
        except OSError:
            issues.append(f"Disk cannot be inspected: {path}")
            continue
        if (
            usage.free < config["min_free_bytes"]
            or 100 * usage.used / usage.total >= config["max_used_percent"]
        ):
            issues.append(f"Disk space low: {path}")
    return issues


def checked_command(arguments: list[str], timeout: int) -> None:
    # Do not print command arguments, remote credentials or provider output.
    try:
        subprocess.run(
            arguments, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise RuntimeError(f"{Path(arguments[0]).name} command failed ({type(exc).__name__})") from None


def remote_id(config: dict) -> str:
    return hashlib.sha256(config["remote"].encode()).hexdigest()


def copy_offsite(snapshot: Path, config: dict) -> dict:
    verify(snapshot)
    target = config["remote"].rstrip("/") + "/" + snapshot.name
    common = [
        "--config",
        config["rclone_config"],
        "--contimeout",
        "15s",
        "--timeout",
        "60s",
        "--retries",
        "3",
    ]
    checked_command(
        ["rclone", "copy", str(snapshot), target, "--immutable", *common], config["timeout_seconds"]
    )
    # Read remote content back, rather than relying on size or an optional server hash.
    checked_command(
        ["rclone", "check", str(snapshot), target, "--download", *common], config["timeout_seconds"]
    )
    return {"snapshot": snapshot.name, "verified_at": now(), "remote_id": remote_id(config)}


def run_backup(project: Path, config: dict, destination: Path, state: dict) -> None:
    issues = disk_issues(project, config)
    if issues:
        raise RuntimeError("; ".join(issues))
    state["last_attempt_at"] = now()
    state["last_run_ok"] = False
    state["last_error"] = "Backup in progress or interrupted"
    atomic_json(destination / "maintenance-status.json", state)
    arguments = [
        "docker",
        "compose",
        "--project-directory",
        str(project / "deploy/cloud"),
        "--env-file",
        str(project / "deploy/cloud/.env"),
        "-f",
        str(project / "deploy/cloud/compose.yml"),
        "run",
        "--rm",
        "--no-deps",
        "backup",
        "python",
        "/scripts/backup.py",
        "create",
        "--backend",
        "/source/backend",
        "--agent",
        "/source/agent",
        "--destination",
        "/backups",
        "--no-prune",
    ]
    checked_command(arguments, config["timeout_seconds"])
    with exclusive(destination):
        snapshot = latest(destination)
        manifest = verify(snapshot)
        if datetime.fromisoformat(manifest["created_at"]) < datetime.fromisoformat(state["last_attempt_at"]):
            raise RuntimeError("Backup command did not create a fresh snapshot")
        state["local_verified_at"] = manifest["created_at"]
        state["local_snapshot"] = snapshot.name
        atomic_json(destination / "maintenance-status.json", state)
        if config["remote"]:
            state["offsite"] = copy_offsite(snapshot, config)
        else:
            state.pop("offsite", None)
        # Remote failure exits before pruning; keep every local snapshot for retry.
        prune(destination, config["keep"])
        state.update(last_run_ok=True, last_error="", last_success_at=now())
        atomic_json(destination / "maintenance-status.json", state)


def check_health(project: Path, config: dict, destination: Path, state: dict) -> list[str]:
    issues = disk_issues(project, config)
    if state.get("last_run_ok") is False:
        issues.append("Last backup run failed or was interrupted")
    try:
        snapshot = latest(destination)
        manifest = verify(snapshot)
        age = (
            datetime.now(timezone.utc) - datetime.fromisoformat(manifest["created_at"])
        ).total_seconds() / 3600
        if age < -1 or age > config["max_age_hours"]:
            issues.append("Latest verified local backup is stale or has an invalid timestamp")
        if config["remote"]:
            remote = state.get("offsite", {})
            if remote.get("snapshot") != snapshot.name or remote.get("remote_id") != remote_id(config):
                issues.append("Latest backup has no verified copy at the configured offsite destination")
    except (OSError, ValueError, KeyError, TypeError):
        issues.append("Latest backup is missing, unreadable or failed integrity verification")
    return issues


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def report(config: dict, state: dict, issues: list[str]) -> None:
    message = "; ".join(issues) if issues else "Backup health recovered"
    key = hashlib.sha256(json.dumps([issues, config["alert_webhook"]]).encode()).hexdigest()
    # Healthy first runs are quiet. Repeated unchanged failures do not flood a webhook.
    previous = state.get("notification")
    if config["alert_webhook"] and key != previous and (issues or previous):
        payload = json.dumps({"text": "NutriGo backup: " + message}).encode()
        request = urllib.request.Request(
            config["alert_webhook"], data=payload, headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=10) as response:
                if not 200 <= response.status < 300:
                    raise RuntimeError("Webhook rejected notification")
        except (OSError, ValueError, RuntimeError):
            # Keep the old key so the next health check retries delivery.
            print("Backup alert delivery failed; will retry on the next check", file=sys.stderr)
            return
    state["notification"] = key
    if issues:
        print("NutriGo backup: " + message, file=sys.stderr)


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["run", "check"])
    parser.add_argument("--project", type=Path, default=Path("/opt/nutrigo"))
    parser.add_argument("--config", type=Path, default=Path("/etc/nutrigo/backup.json"))
    args = parser.parse_args()
    destination = args.project / "backups"
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Serialize host run/check; backup.py also has a separate lock shared with manual runs.
    with (destination / ".maintenance.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Backup maintenance already running")
            return 0
        config = read_config(args.config)
        state = state_read(destination)
        try:
            if args.command == "run":
                run_backup(args.project, config, destination, state)
            with exclusive(destination):
                issues = check_health(args.project, config, destination, state)
        except (OSError, ValueError, RuntimeError, KeyError, TypeError, sqlite3.Error) as exc:
            # Exceptions may contain provider URLs or tokens: persist only their type.
            issues = [
                f"Backup {args.command} failed ({type(exc).__name__}); inspect service and configuration"
            ]
            if args.command == "run":
                state.update(last_run_ok=False, last_error=issues[0])
        state["checked_at"] = now()
        state["issues"] = issues
        report(config, state, issues)
        atomic_json(destination / "maintenance-status.json", state)
        print(
            json.dumps(
                {
                    "healthy": not issues,
                    "offsite_enabled": bool(config["remote"]),
                    "notifications_enabled": bool(config["alert_webhook"]),
                    "issues": issues,
                }
            )
        )
        return 1 if issues else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, sqlite3.Error) as error:
        print(
            f"Backup maintenance could not start ({type(error).__name__}); check configuration and state files",
            file=sys.stderr,
        )
        sys.exit(1)
