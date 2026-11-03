"""Preserve timestamps only for byte-identical Xcode inputs across CI checkouts."""

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path


def inputs(root):
    tracked = subprocess.check_output(
        ["git", "ls-files", "-z", "--", "ZhiZhou", "ZhiZhouCore", "project.yml"],
        cwd=root,
    ).decode("utf-8").split("\0")
    paths = {root / name for name in tracked if name}
    paths.update((root / "ZhiZhou.xcodeproj").rglob("*"))
    return sorted(path for path in paths if path.is_file() and not path.is_symlink())


def synchronize(mode, root, manifest):
    previous = json.loads(manifest.read_text(encoding="utf-8")) if mode == "restore" and manifest.exists() else {}
    snapshot = {}
    restored = 0
    for path in inputs(root):
        name = path.relative_to(root).as_posix()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        stat = path.stat()
        record = previous.get(name)
        if mode == "restore" and record and record["sha256"] == digest:
            os.utime(path, ns=(stat.st_atime_ns, record["mtime_ns"]))
            restored += 1
        snapshot[name] = {"sha256": digest, "mtime_ns": path.stat().st_mtime_ns}
    if mode == "save":
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(snapshot, sort_keys=True), encoding="utf-8")
    print(f"Source timestamps: {mode}, {restored} restored, {len(snapshot)} inputs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("restore", "save"))
    args = parser.parse_args()
    workspace = Path.cwd()
    synchronize(args.mode, workspace, workspace / ".ci-cache" / "source-mtimes.json")
