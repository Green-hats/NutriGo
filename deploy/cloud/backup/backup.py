"""SQLite 在线快照、图片备份与隔离恢复；不写入源库或生产目录。"""
from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
import uuid
from typing import Iterator


@contextmanager
def connect_readonly(path: Path) -> Iterator[sqlite3.Connection]:
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=30)) as connection:
        yield connection


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def database_counts(path: Path) -> dict:
    with connect_readonly(path) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError(f'Database integrity check failed: {path.name}')
        names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {name: db.execute('SELECT COUNT(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name in names}


def safe_file(root: Path, relative: str) -> Path:
    path = Path(relative)
    if path.is_absolute() or not path.parts or '..' in path.parts:
        raise ValueError('Invalid snapshot path')
    result = root / path
    for item in (result, *result.parents):
        if item == root.parent:
            break
        if item.is_symlink():
            raise ValueError('Snapshot symlinks are not allowed')
    return result


def verify(snapshot: Path) -> dict:
    manifest = json.loads(safe_file(snapshot, 'manifest.json').read_text())
    if manifest.get('format') != 1:
        raise ValueError('Unsupported backup format')
    for name, expected in manifest['files'].items():
        if digest(safe_file(snapshot, name)) != expected:
            raise ValueError(f'Backup checksum mismatch: {name}')
    for name, counts in manifest['databases'].items():
        if name not in manifest['files'] or database_counts(safe_file(snapshot, name)) != counts:
            raise ValueError(f'Backup table counts mismatch: {name}')
    if set(manifest['databases']) != {'backend/data.db', 'agent/agent.db'}:
        raise ValueError('Missing database snapshot')
    return manifest


def restore(snapshot: Path, target: Path) -> dict:
    """只恢复到不存在的目录，拒绝覆盖已有生产数据。"""
    manifest = verify(snapshot)
    if target.exists() or target.is_symlink():
        raise ValueError('Restore destination must not already exist')
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.restore-', dir=target.parent))
    try:
        for name in manifest['files']:
            destination = safe_file(staging, name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(safe_file(snapshot, name), destination)
        shutil.copy2(snapshot / 'manifest.json', staging / 'manifest.json')
        verify(staging)
        staging.rename(target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return manifest


def snapshot_database(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with connect_readonly(source) as src, closing(sqlite3.connect(destination)) as dst:
        src.backup(dst, pages=256, sleep=0.05)
        dst.execute('PRAGMA journal_mode=DELETE')


def create(backend: Path, agent: Path, destination: Path, keep: int = 14) -> Path:
    if keep < 1:
        raise ValueError('Keep at least one verified backup')
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.is_symlink():
        raise ValueError('Backup destination must not be a symlink')
    with (destination / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        staging = Path(tempfile.mkdtemp(prefix='.partial-', dir=destination))
        try:
            snapshot_database(backend / 'data.db', staging / 'backend/data.db')
            snapshot_database(agent / 'agent.db', staging / 'agent/agent.db')
            # 使用快照中的图片清单。并发删除导致文件缺失时，本次备份失败，旧备份保留。
            with connect_readonly(staging / 'backend/data.db') as db:
                images = list(db.execute('SELECT path FROM food_images'))
            for (stored_path,) in images:
                name = Path(stored_path).name
                if not name or name in {'.', '..'}:
                    raise ValueError('Invalid image path')
                source = backend / 'uploads' / name
                if source.is_symlink():
                    raise ValueError('Image symlinks are not supported')
                target = staging / 'backend/uploads' / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
            databases = {name: database_counts(staging / name) for name in ['backend/data.db', 'agent/agent.db']}
            files = {str(p.relative_to(staging)): digest(p) for p in sorted(staging.rglob('*')) if p.is_file()}
            manifest = {'format': 1, 'created_at': datetime.now(timezone.utc).isoformat(), 'databases': databases, 'files': files}
            (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            # 每次备份都复制到隔离目录、打开恢复后的数据库并校验图片哈希。
            with tempfile.TemporaryDirectory(prefix='nutrigo-restore-check-') as sandbox:
                restore(staging, Path(sandbox) / 'restored')
            name = 'snapshot-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '-' + uuid.uuid4().hex[:8]
            completed = destination / name
            staging.rename(completed)
            previous = sorted(p for p in destination.glob('snapshot-*') if p.is_dir() and not p.is_symlink() and (p / 'manifest.json').is_file())
            for old in previous[:-keep]:
                shutil.rmtree(old)
            return completed
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise


def main() -> None:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    backup = commands.add_parser('create')
    backup.add_argument('--backend', type=Path, required=True)
    backup.add_argument('--agent', type=Path, required=True)
    backup.add_argument('--destination', type=Path, required=True)
    backup.add_argument('--keep', type=int, default=14)
    check = commands.add_parser('verify')
    check.add_argument('snapshot', type=Path)
    recovery = commands.add_parser('restore')
    recovery.add_argument('snapshot', type=Path)
    recovery.add_argument('--target', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'create':
        print(create(args.backend, args.agent, args.destination, args.keep))
    elif args.command == 'verify':
        verify(args.snapshot)
        print('Backup integrity verified')
    else:
        restore(args.snapshot, args.target)
        print(f'Isolated restore verified: {args.target}')


if __name__ == '__main__':
    main()
