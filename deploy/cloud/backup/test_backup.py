import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backup import create, restore, verify


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.backend = self.root / "backend"
        self.agent = self.root / "agent"
        self.destination = self.root / "backups"
        (self.backend / "uploads").mkdir(parents=True)
        self.agent.mkdir()
        self.live = sqlite3.connect(self.backend / "data.db")
        self.addCleanup(self.live.close)
        self.live.execute("PRAGMA journal_mode=WAL")
        self.live.execute("CREATE TABLE food_images (path TEXT)")
        self.live.execute("CREATE TABLE food_diaries (food_name TEXT)")
        self.live.execute("INSERT INTO food_images VALUES ('uploads/meal.jpg')")
        self.live.execute("INSERT INTO food_diaries VALUES ('米饭')")
        self.live.commit()
        (self.backend / "uploads/meal.jpg").write_bytes(b"photo bytes")
        with sqlite3.connect(self.agent / "agent.db") as db:
            db.execute("CREATE TABLE sessions (message TEXT)")
            db.execute("INSERT INTO sessions VALUES ('hello')")

    def test_wal_snapshot_restore_and_source_unchanged(self):
        snapshot = create(self.backend, self.agent, self.destination)
        manifest = verify(snapshot)
        self.assertEqual(manifest["databases"]["backend/data.db"]["food_diaries"], 1)
        target = self.root / "restored"
        restore(snapshot, target)
        with sqlite3.connect(target / "backend/data.db") as db:
            self.assertEqual(db.execute("SELECT food_name FROM food_diaries").fetchall(), [("米饭",)])
        self.assertEqual((target / "backend/uploads/meal.jpg").read_bytes(), b"photo bytes")
        self.assertEqual(self.live.execute("SELECT COUNT(*) FROM food_diaries").fetchone()[0], 1)
        with self.assertRaises(ValueError):
            restore(snapshot, self.backend)

    def test_corruption_rejected(self):
        snapshot = create(self.backend, self.agent, self.destination)
        (snapshot / "backend/uploads/meal.jpg").write_bytes(b"corrupt")
        with self.assertRaises(ValueError):
            restore(snapshot, self.root / "restored")
        self.assertFalse((self.root / "restored").exists())

    def test_failure_does_not_prune_existing_backup(self):
        first = create(self.backend, self.agent, self.destination, keep=1)
        (self.backend / "uploads/meal.jpg").unlink()
        with self.assertRaises(FileNotFoundError):
            create(self.backend, self.agent, self.destination, keep=1)
        self.assertTrue(first.exists())
        verify(first)
        self.assertEqual(list(self.destination.glob(".partial-*")), [])

    def test_retention_only_after_verified_success(self):
        first = create(self.backend, self.agent, self.destination, keep=1)
        second = create(self.backend, self.agent, self.destination, keep=1)
        self.assertFalse(first.exists())
        self.assertTrue(second.exists())
        verify(second)

    def test_path_traversal_rejected(self):
        snapshot = create(self.backend, self.agent, self.destination)
        manifest = json.loads((snapshot / "manifest.json").read_text())
        manifest["files"]["../../outside"] = "bad"
        (snapshot / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            verify(snapshot)


if __name__ == "__main__":
    unittest.main()
