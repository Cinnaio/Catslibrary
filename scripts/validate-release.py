#!/usr/bin/env python3
"""Root-owned release gate: extract only regular files and verify the complete inventory."""
import hashlib
import json
import pathlib
import platform
import shutil
import sys
import tarfile

MAX_BYTES = 1024 * 1024 * 1024
MAX_FILES = 25000


def validate_archive(archive, destination, sha, node_version):
    destination = pathlib.Path(destination)
    if any(destination.iterdir()):
        raise ValueError('解包目标必须为空')
    if pathlib.Path(archive).stat().st_size > 512 * 1024 * 1024:
        raise ValueError('压缩发布包超过 512 MiB')
    with tarfile.open(archive, 'r:gz') as source:
        members = []
        paths = set()
        total = 0
        for item in source:
            name = item.name.rstrip('/')
            path = pathlib.PurePosixPath(name)
            if (not name or name.startswith('/') or '\\' in name or ':' in name
                    or any(part in ('', '.', '..') for part in name.split('/'))):
                raise ValueError('发布包包含非法路径')
            permitted_directory = name in ('api', 'api/dist', 'web', 'web/dist')
            if not (name.startswith(('api/dist/', 'web/dist/')) or permitted_directory):
                raise ValueError('发布包含有 dist 之外的路径')
            if not (item.isdir() or item.isfile()) or name in paths:
                raise ValueError('发布包含有链接、特殊文件或重复路径')
            if permitted_directory and not item.isdir():
                raise ValueError('发布包根路径必须是目录')
            paths.add(name)
            total += item.size
            if total > MAX_BYTES or len(paths) > MAX_FILES:
                raise ValueError('发布包解压体积或文件数量超限')
            members.append((item, destination.joinpath(*path.parts)))
        # 完整审查成员后才写盘；无软链接、硬链接、设备文件，也不沿用所有权。
        for item, target in members:
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True)
                target.chmod(0o755)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(item) as reader, target.open('xb') as writer:
                    shutil.copyfileobj(reader, writer, 1024 * 1024)
                target.chmod(0o755 if item.mode & 0o111 else 0o644)
    metadata = destination / 'api/dist/release.json'
    if metadata.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('发布清单过大')
    manifest = json.loads(metadata.read_text('utf-8'))
    arch = {'x86_64': 'x64', 'AMD64': 'x64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(platform.machine())
    if manifest.get('format') != 2 or manifest.get('releaseSha') != sha:
        raise ValueError('发布协议或源码 SHA 不匹配')
    if manifest.get('platform') != 'linux' or not arch or manifest.get('arch') != arch:
        raise ValueError('发布包操作系统或 CPU 架构与服务器不匹配')
    if manifest.get('nodeVersion') != node_version or manifest.get('executable') != 'api/dist/runtime/node':
        raise ValueError('发布包 Node 版本或入口与已安装发布策略不匹配')
    required = ['api/dist/index.js', 'api/dist/build-info.js', 'api/dist/check-release-runtime.mjs',
                'api/dist/runtime/node', 'api/dist/release-lock.json', 'web/dist/index.html']
    if any(not (destination / name).is_file() for name in required):
        raise ValueError('发布包缺少启动文件')
    migrations = manifest.get('migrations')
    if not migrations or any(not (destination / 'api/dist/migrations' / row['name']).is_file() for row in migrations):
        raise ValueError('发布包缺少必要迁移文件')
    actual = {}
    for file in destination.rglob('*'):
        if file.is_file() and file != metadata:
            with file.open('rb') as reader:
                actual[file.relative_to(destination).as_posix()] = hashlib.file_digest(reader, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else hash_stream(reader)
    if actual != manifest.get('files'):
        raise ValueError('发布包文件清单或 SHA-256 校验失败')
    if actual['api/dist/release-lock.json'] != manifest.get('lockHash'):
        raise ValueError('锁文件摘要不匹配')
    return manifest


def hash_stream(reader):
    digest = hashlib.sha256()
    for chunk in iter(lambda: reader.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()


if __name__ == '__main__':
    try:
        archive, stage, sha = sys.argv[1:]
        pinned = pathlib.Path(__file__).with_name('node-version').read_text('utf-8').strip()
        validate_archive(archive, stage, sha, pinned)
        print('发布清单、平台、完整文件摘要与运行时策略校验通过')
    except Exception as error:
        print(f'发布包拒绝：{error}', file=sys.stderr)
        sys.exit(4)
