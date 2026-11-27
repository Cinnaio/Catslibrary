"""Regression checks for version-aware cache reuse and byte-safe mtimes."""

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
SCRIPTS = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cache = load("ci-build-cache")
mtimes = load("ci-source-mtimes")
PROJECT = """name: Example
settings:
  MARKETING_VERSION: "1.4.1"
  CURRENT_PROJECT_VERSION: 33
targets:
  Widget:
    MARKETING_VERSION: "1.4.1"
    CURRENT_PROJECT_VERSION: 33
    SWIFT_VERSION: "5.0"
"""


class BuildCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.write("ios/project.yml", PROJECT)
        for name in ["ios/ZhiZhouCore/Package.swift", ".github/workflows/build-ios.yml",
                     "ios/scripts/ci-build-cache.py", "ios/scripts/ci-source-mtimes.py"]:
            self.write(name, "fixture\n")

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def track(self, *names):
        subprocess.run(["git", "add", "--", *names], cwd=self.root, check=True, capture_output=True)

    def test_version_bump_reuses_fingerprint_but_exports_new_bundle_versions(self):
        before = cache.cache_metadata(self.root)
        self.write("ios/project.yml", PROJECT.replace('"1.4.1"', '"1.5.0"').replace(": 33", ": 34"))
        after = cache.cache_metadata(self.root)
        self.assertEqual(before["fingerprint"], after["fingerprint"])
        self.assertEqual((after["marketing-version"], after["build-number"]), ("1.5.0", "34"))

    def test_build_structure_and_cache_helpers_invalidate_fingerprint(self):
        before = cache.cache_metadata(self.root)["fingerprint"]
        for name, content in [("ios/project.yml", PROJECT.replace('"5.0"', '"6.0"')),
                              ("ios/ZhiZhouCore/Package.swift", "new dependency"),
                              (".github/workflows/build-ios.yml", "changed compiler flags"),
                              ("ios/scripts/ci-build-cache.py", "new fingerprint logic"),
                              ("ios/scripts/ci-source-mtimes.py", "new mtime logic")]:
            with self.subTest(path=name):
                original = (self.root / name).read_text(encoding="utf-8")
                self.write(name, content)
                self.assertNotEqual(before, cache.cache_metadata(self.root)["fingerprint"])
                self.write(name, original)

    def test_tracked_package_lock_addition_change_and_removal_invalidate(self):
        original = cache.cache_metadata(self.root)["fingerprint"]
        name = "ios/ZhiZhou.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
        self.write(name, '{"pins": ["v1"]}')
        self.track(name)
        first = cache.cache_metadata(self.root)["fingerprint"]
        self.assertNotEqual(original, first)
        self.write(name, '{"pins": ["v2"]}')
        second = cache.cache_metadata(self.root)["fingerprint"]
        self.assertNotEqual(first, second)
        self.track(name)
        subprocess.run(["git", "rm", "--cached", "-q", "--", name], cwd=self.root, check=True)
        self.assertEqual(original, cache.cache_metadata(self.root)["fingerprint"])

    def test_invalid_or_mismatched_versions_fail_before_cache_restore(self):
        for text in [PROJECT.replace('"1.4.1"', '"$(INJECTED)"'),
                     PROJECT.replace(": 33", ": 34", 1),
                     PROJECT.replace('"1.4.1"', '"1.4.2"', 1),
                     "name: MissingVersions\n"]:
            with self.subTest(project=text), self.assertRaises(ValueError):
                cache.project_metadata(text)

    def test_source_edits_do_not_change_cache_bucket_or_restore_stale_timestamps(self):
        names = ["ios/ZhiZhou/View.swift", "ios/ZhiZhouCore/Core.swift", "ios/ZhiZhouWidgets/Widget.swift",
                 "ios/WidgetShared/Shared.swift", "ios/project.yml"]
        for name in names[:-1]:
            self.write(name, "let value = 1\n")
        self.track(*names)
        generated = self.write("ios/ZhiZhou.xcodeproj/project.pbxproj", "generated old version")
        inputs = [self.root / name for name in names] + [generated]
        for path in inputs:
            os.utime(path, ns=(1_600_000_000_000_000_000, 1_600_000_000_000_000_000))
        old_times = {path: path.stat().st_mtime_ns for path in inputs}
        manifest = self.root / "ios/.ci-cache/source-mtimes.json"
        mtimes.synchronize("save", self.root / "ios", manifest)
        fingerprint = cache.cache_metadata(self.root)["fingerprint"]
        self.write(names[0], "let value = 2\n")
        self.write("ios/project.yml", PROJECT.replace(": 33", ": 34"))
        generated.write_text("generated new version", encoding="utf-8")
        self.assertEqual(fingerprint, cache.cache_metadata(self.root)["fingerprint"])
        for path in inputs:
            os.utime(path, ns=(1_700_000_000_000_000_000, 1_700_000_000_000_000_000))
        mtimes.synchronize("restore", self.root / "ios", manifest)
        changed = {self.root / names[0], self.root / "ios/project.yml", generated}
        for path in inputs:
            with self.subTest(path=path):
                if path in changed:
                    self.assertNotEqual(old_times[path], path.stat().st_mtime_ns)
                else:
                    self.assertEqual(old_times[path], path.stat().st_mtime_ns)


if __name__ == "__main__":
    unittest.main()
