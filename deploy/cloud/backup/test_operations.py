import json
import shutil
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import test_backup
from backup import create, verify
from operations import (
    DEFAULTS,
    check_health,
    copy_offsite,
    read_config,
    report,
    run_backup,
)


# Reuse the real SQLite/WAL/image fixture; no network or real provider required.
class OperationsTests(unittest.TestCase):
    setUp = test_backup.BackupTests.setUp

    def config(self, **values):
        return {**DEFAULTS, "disk_paths": [], "min_free_bytes": 1, "max_used_percent": 100, **values}

    def test_offsite_checks_content_and_never_deletes_remote_files(self):
        snapshot = create(self.backend, self.agent, self.destination)
        with patch("operations.checked_command") as command:
            receipt = copy_offsite(snapshot, self.config(remote="offsite:nutrigo"))
        self.assertEqual([c.args[0][1] for c in command.call_args_list], ["copy", "check"])
        self.assertIn("--immutable", command.call_args_list[0].args[0])
        self.assertIn("--download", command.call_args_list[1].args[0])
        self.assertEqual(receipt["snapshot"], snapshot.name)
        self.assertNotIn("remote", receipt)

    def test_remote_verification_failure_does_not_prune_or_claim_success(self):
        first = create(self.backend, self.agent, self.destination)
        state = {}

        def command(arguments, timeout):
            if arguments[0] == "docker":
                create(self.backend, self.agent, self.destination, prune_old=False)
            elif arguments[1] == "check":
                raise RuntimeError("readback failed")

        with patch("operations.checked_command", side_effect=command), self.assertRaises(RuntimeError):
            run_backup(self.root, self.config(keep=1, remote="offsite:nutrigo"), self.destination, state)
        self.assertTrue(first.exists())
        self.assertEqual(len(list(self.destination.glob("snapshot-*"))), 2)
        self.assertNotIn("offsite", state)
        self.assertFalse(state["last_run_ok"])
        verify(first)

    def test_local_only_success_and_retention(self):
        first = create(self.backend, self.agent, self.destination)
        state = {}

        def command(arguments, timeout):
            self.assertEqual(arguments[0], "docker")
            self.assertIn("--no-prune", arguments)
            create(self.backend, self.agent, self.destination, prune_old=False)

        with patch("operations.checked_command", side_effect=command):
            run_backup(self.root, self.config(keep=1), self.destination, state)
        self.assertFalse(first.exists())
        self.assertTrue(state["last_run_ok"])
        self.assertNotIn("offsite", state)
        self.assertEqual(check_health(self.root, self.config(), self.destination, state), [])

    def test_corrupt_stale_and_missing_backups_are_unhealthy(self):
        config = self.config()
        self.assertTrue(check_health(self.root, config, self.destination, {}))
        snapshot = create(self.backend, self.agent, self.destination)
        manifest = json.loads((snapshot / "manifest.json").read_text())
        manifest["created_at"] = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
        (snapshot / "manifest.json").write_text(json.dumps(manifest))
        self.assertTrue(any("stale" in i for i in check_health(self.root, config, self.destination, {})))
        (snapshot / "backend/uploads/meal.jpg").write_bytes(b"corrupt")
        self.assertTrue(any("integrity" in i for i in check_health(self.root, config, self.destination, {})))

    def test_low_disk_blocks_backup_before_any_command(self):
        create(self.backend, self.agent, self.destination)
        with (
            patch("operations.shutil.disk_usage", return_value=SimpleNamespace(total=100, used=99, free=1)),
            patch("operations.checked_command") as command,
        ):
            with self.assertRaises(RuntimeError):
                run_backup(self.root, self.config(min_free_bytes=10), self.destination, {})
            command.assert_not_called()

    def test_missing_offsite_receipt_or_changed_destination_is_unhealthy(self):
        snapshot = create(self.backend, self.agent, self.destination)
        with patch("operations.checked_command"):
            receipt = copy_offsite(snapshot, self.config(remote="offsite:old"))
        issues = check_health(
            self.root, self.config(remote="offsite:new"), self.destination, {"offsite": receipt}
        )
        self.assertTrue(any("offsite" in i for i in issues))

    def test_last_failure_remains_visible_with_recent_valid_backup(self):
        create(self.backend, self.agent, self.destination)
        issues = check_health(self.root, self.config(), self.destination, {"last_run_ok": False})
        self.assertTrue(any("Last backup" in i for i in issues))

    def test_notifications_deduplicate_and_report_recovery(self):
        config = self.config(alert_webhook="https://notify.example.test/private")
        state = {}
        with patch("operations.urllib.request.build_opener") as opener:
            opener.return_value.open.return_value.__enter__.return_value.status = 200
            report(config, state, ["Disk space low"])
            report(config, state, ["Disk space low"])
            self.assertEqual(opener.return_value.open.call_count, 1)
            report(config, state, [])
            self.assertEqual(opener.return_value.open.call_count, 2)
        self.assertNotIn("private", json.dumps(state))

    def test_notification_failure_retries(self):
        config = self.config(alert_webhook="https://notify.example.test/private")
        state = {}
        with patch("operations.urllib.request.build_opener") as opener:
            opener.return_value.open.side_effect = OSError("unreachable")
            report(config, state, ["backup failed"])
            report(config, state, ["backup failed"])
            self.assertEqual(opener.return_value.open.call_count, 2)
        self.assertNotIn("notification", state)

    def test_configuration_fails_closed(self):
        path = self.root / "config.json"
        with self.assertRaises(FileNotFoundError):
            read_config(path)
        for values in [
            {"remote": "/local/backups"},
            {"alert_webhook": "http://notify.example.test"},
            {"keep": 0},
            {"unknown": 1},
            {"max_age_hours": float("nan")},
        ]:
            path.write_text(json.dumps(values))
            with self.assertRaises(ValueError):
                read_config(path)
        example = Path(__file__).with_name("operations.example.json")
        shutil.copy2(example, path)
        self.assertEqual(read_config(path)["remote"], "")


if __name__ == "__main__":
    unittest.main()
