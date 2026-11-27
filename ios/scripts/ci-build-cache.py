"""Fingerprint build settings without discarding caches for version-only bumps.

This deliberately supports only numeric, literal version settings in project.yml.
Unexpected version syntax fails closed instead of hiding build-setting changes.
"""

import hashlib
import re
import subprocess
from pathlib import Path


VERSION_SETTING = re.compile(
    r"^(?P<prefix>[ \t]+(?P<key>MARKETING_VERSION|CURRENT_PROJECT_VERSION):[ \t]*)"
    r'''(?P<value>"[^"\r\n]*"|'[^'\r\n]*'|[^#\r\n]*?)'''
    r"(?P<suffix>[ \t]*(?:#[^\r\n]*)?)$",
    re.MULTILINE,
)


def project_metadata(text):
    versions = {"MARKETING_VERSION": set(), "CURRENT_PROJECT_VERSION": set()}
    for match in VERSION_SETTING.finditer(text):
        value = match["value"].strip()
        if value.startswith(('"', "'")):
            value = value[1:-1]
        pattern = r"[0-9]+(?:\.[0-9]+){0,2}" if match["key"] == "MARKETING_VERSION" else r"[0-9]+"
        if not re.fullmatch(pattern, value):
            raise ValueError("project.yml 必须使用明确的数字版本号")
        versions[match["key"]].add(value)
    if any(len(values) != 1 for values in versions.values()):
        raise ValueError("主 App 与扩展版本必须存在且一致")
    normalized = VERSION_SETTING.sub(lambda match: match["prefix"] + "<version>" + match["suffix"], text)
    return normalized, next(iter(versions["MARKETING_VERSION"])), next(iter(versions["CURRENT_PROJECT_VERSION"]))


def cache_metadata(root):
    normalized, version, build = project_metadata((root / "ios/project.yml").read_text(encoding="utf-8"))
    paths = {
        "ios/project.yml",
        "ios/ZhiZhouCore/Package.swift",
        ".github/workflows/build-ios.yml",
        "ios/scripts/ci-build-cache.py",
        "ios/scripts/ci-source-mtimes.py",
    }
    locks = subprocess.check_output(
        ["git", "ls-files", "-z", "--", "ios/Package.resolved", "ios/**/Package.resolved"], cwd=root,
    ).decode("utf-8")
    paths.update(path for path in locks.split("\0") if path)
    digest = hashlib.sha256(b"ios-build-cache-v3\0")
    for name in sorted(paths):
        content = normalized.encode("utf-8") if name == "ios/project.yml" else (root / name).read_bytes()
        digest.update(name.encode("utf-8") + b"\0" + str(len(content)).encode("ascii") + b"\0" + content)
    return {"fingerprint": digest.hexdigest(), "marketing-version": version, "build-number": build}


if __name__ == "__main__":
    repository = Path(__file__).resolve().parents[2]
    for key, value in cache_metadata(repository).items():
        print(f"{key}={value}")
